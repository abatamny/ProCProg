import { timingSafeEqual } from 'node:crypto';
import { MomentError } from '../services/moments.js';
import { MemoryError } from '../services/memories.js';
import { bearerToken } from '../services/sessions.js';

const CAPTURE_INTERVAL_MS = 5_000;

function adminPasswordMatches(received, expected) {
  if (!expected || typeof received !== 'string') return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function registerStage5Routes(app, {
  config, db, sessions, places, media, moments, memories, seed, realtime,
}) {
  const lastCaptureAt = new Map();

  const profilePlaces = db.prepare(
    `SELECT r.PLACE_ID AS id, p.NAME AS name, r.RANK AS rank, r.VISIT_COUNT AS visitCount
     FROM USER_PLACE_RANK r
     JOIN PLACES p ON p.ID = r.PLACE_ID
     WHERE r.PHONE_NUMBER = ?
     ORDER BY r.UPDATED_AT DESC`,
  );
  const profileMemories = db.prepare(
    `SELECT
       memory.ID AS id,
       memory.PLACE_ID AS placeId,
       p.NAME AS placeName,
       memory.TITLE AS title,
       memory.PRESENCE_TOTAL AS presenceTotal,
       memory.PHOTO_COUNT AS photoCount,
       memory.ENGRAVED_AT AS engravedAt,
       media.DOMINANT_COLOR AS dominantColor,
       media.THUMB_URL AS thumbUrl,
       mp.ROLE AS role
     FROM MEMORY_PARTICIPANTS mp
     JOIN MEMORIES memory ON memory.ID = mp.MOMENT_ID
     JOIN MEDIA media ON media.ID = memory.COVER_MEDIA_ID
     JOIN PLACES p ON p.ID = memory.PLACE_ID
     WHERE mp.PHONE_NUMBER = ?
     ORDER BY memory.ENGRAVED_AT DESC`,
  );
  const adminMoments = db.prepare(
    `SELECT
       m.ID AS id,
       m.PLACE_ID AS placeId,
       m.CAPTION AS caption,
       m.PRESENCE_COUNT AS presenceCount,
       m.STATUS AS status,
       m.CREATED_AT AS createdAt,
       m.IS_SEED AS isSeed,
       u.NICKNAME AS nickname,
       media.DOMINANT_COLOR AS dominantColor,
       media.THUMB_URL AS thumbUrl
     FROM MOMENTS m
     JOIN USERS u ON u.PHONE_NUMBER = m.PHONE_NUMBER
     JOIN MEDIA media ON media.ID = m.MEDIA_ID
     WHERE (@placeId IS NULL OR m.PLACE_ID = @placeId)
       AND (@status IS NULL OR m.STATUS = @status)
     ORDER BY m.CREATED_AT DESC
     LIMIT 200`,
  );
  const adminKnocks = db.prepare(
    `SELECT
       k.ID AS id, k.PLACE_ID AS placeId, k.TYPE AS type, k.CONTENT AS content,
       k.CREATED_AT AS createdAt, k.IS_SEED AS isSeed,
       u.NICKNAME AS nickname, media.THUMB_URL AS thumbUrl
     FROM KNOCKS k
     JOIN USERS u ON u.PHONE_NUMBER = k.PHONE_NUMBER
     LEFT JOIN MEDIA media ON media.ID = k.MEDIA_ID
     WHERE (@placeId IS NULL OR k.PLACE_ID = @placeId)
     ORDER BY k.CREATED_AT DESC
     LIMIT 200`,
  );
  const adminMemories = db.prepare(
    `SELECT
       memory.ID AS id, memory.PLACE_ID AS placeId, memory.TITLE AS title,
       memory.PRESENCE_TOTAL AS presenceTotal, memory.PHOTO_COUNT AS photoCount,
       memory.ENGRAVED_AT AS engravedAt, memory.IS_SEED AS isSeed,
       media.THUMB_URL AS thumbUrl
     FROM MEMORIES memory
     JOIN MEDIA media ON media.ID = memory.COVER_MEDIA_ID
     WHERE (@placeId IS NULL OR memory.PLACE_ID = @placeId)
     ORDER BY memory.ENGRAVED_AT DESC
     LIMIT 200`,
  );
  const adminUsers = db.prepare(
    `SELECT PHONE_NUMBER AS phoneNumber, NICKNAME AS nickname,
            CREATED_AT AS createdAt, IS_SEED AS isSeed
     FROM USERS
     ORDER BY CREATED_AT DESC
     LIMIT 500`,
  );
  const allPlaces = db.prepare('SELECT ID AS id, NAME AS name, PARENT_PLACE_ID AS parentPlaceId FROM PLACES');
  const deleteKnock = db.prepare('DELETE FROM KNOCKS WHERE ID = ?');
  const deleteMoment = db.prepare('DELETE FROM MOMENTS WHERE ID = ?');
  const deleteMemory = db.prepare('DELETE FROM MEMORIES WHERE ID = ?');
  const deleteUser = db.prepare('DELETE FROM USERS WHERE PHONE_NUMBER = ?');

  function requireSession(request, reply) {
    const session = sessions.validate(bearerToken(request.headers.authorization));
    if (!session) {
      reply.code(401).send({ error: 'invalid_session' });
      return null;
    }
    return session;
  }

  function requireAdmin(request, reply) {
    if (!adminPasswordMatches(request.headers['x-admin-password'], config.adminPassword)) {
      reply.code(401).send({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // ---- Capture: turns an uploaded media id into a live Moment -------------

  app.post('/api/moments', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;

    const placeId = realtime.presence.getUserState(session.phoneNumber)?.placeId;
    if (!placeId) return reply.code(409).send({ error: 'not_in_place' });

    const { mediaId, caption } = request.body ?? {};

    // 1 capture / 5 s per user (SPEC §8) — idempotent retries are exempt.
    if (typeof mediaId === 'string') {
      const existing = moments.findLive({ placeId, phoneNumber: session.phoneNumber, mediaId });
      if (existing) return reply.code(200).send({ moment: existing });
    }
    const last = lastCaptureAt.get(session.phoneNumber) ?? 0;
    if (Date.now() - last < CAPTURE_INTERVAL_MS) {
      return reply.code(429).send({ error: 'capture_rate_limited' });
    }

    try {
      const moment = moments.create({
        placeId,
        phoneNumber: session.phoneNumber,
        mediaId,
        caption,
      });
      lastCaptureAt.set(session.phoneNumber, Date.now());
      // Broadcast now if the media variants already exist; otherwise the
      // media-ready handler in app.js emits moment_new when they land.
      if (media.get(moment.mediaId)?.ready) {
        realtime.broadcastToPlace(moment.placeId, 'moment_new', { dig: moment });
      }
      return reply.code(201).send({ moment });
    } catch (error) {
      if (error instanceof MomentError) {
        return reply.code(400).send({ error: error.code });
      }
      throw error;
    }
  });

  // Which live moments has this user already confirmed ("You were here").
  app.get('/api/moments/confirmed', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return { momentIds: moments.listConfirmedMomentIds(session.phoneNumber) };
  });

  // ---- Memories: cursor pagination + album contents -----------------------

  app.get('/api/memories', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const { placeId, beforeEngravedAt, beforeId, limit } = request.query;
    if (typeof placeId !== 'string' || !placeId) {
      return reply.code(400).send({ error: 'placeId_required' });
    }
    return memories.listPage({
      placeId,
      beforeEngravedAt: beforeEngravedAt || null,
      beforeId: beforeId || null,
      limit: Number.parseInt(limit, 10) || 10,
    });
  });

  app.get('/api/memories/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const album = memories.getAlbum(request.params.id);
    if (!album) return reply.code(404).send({ error: 'not_found' });
    return album;
  });

  // ---- Profile: places + memories the user is part of ---------------------

  app.get('/api/profile', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return {
      user: { nickname: session.nickname },
      places: profilePlaces.all(session.phoneNumber),
      memories: profileMemories.all(session.phoneNumber),
    };
  });

  // ---- Admin console (x-admin-password) ------------------------------------

  app.get('/api/admin/places', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return {
      places: allPlaces.all().map((place) => ({
        ...place,
        presenceCount: realtime.presence.getCount(place.id),
      })),
    };
  });

  app.get('/api/admin/moments', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { placeId, status } = request.query;
    return {
      moments: adminMoments.all({ placeId: placeId || null, status: status || null }),
    };
  });

  app.post('/api/admin/engrave', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { momentIds, title, targetPlaceId } = request.body ?? {};
    try {
      const result = memories.engrave({
        momentIds,
        title: title ?? null,
        targetPlaceId: targetPlaceId ?? null,
      });
      realtime.broadcastToPlace(result.memory.placeId, 'memory_engraved', {
        moment: result.memory,
        removedDigIds: result.removedDigIds,
        participants: result.participants.map(({ nickname, role }) => ({ nickname, role })),
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof MemoryError) {
        return reply.code(400).send({ error: error.code });
      }
      throw error;
    }
  });

  app.get('/api/admin/content', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const placeId = request.query.placeId || null;
    return {
      knocks: adminKnocks.all({ placeId }),
      moments: adminMoments.all({ placeId, status: null }),
      memories: adminMemories.all({ placeId }),
    };
  });

  app.delete('/api/admin/content/:kind/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { kind, id } = request.params;
    const statements = { knock: deleteKnock, moment: deleteMoment, memory: deleteMemory };
    const statement = statements[kind];
    if (!statement) return reply.code(400).send({ error: 'unknown_kind' });
    const removed = statement.run(id).changes === 1;
    if (!removed) return reply.code(404).send({ error: 'not_found' });
    realtime.broadcastToAll('content_removed', { kind, id });
    return { removed: true };
  });

  app.get('/api/admin/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return { users: adminUsers.all() };
  });

  app.delete('/api/admin/users/:phoneNumber', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const removed = deleteUser.run(request.params.phoneNumber).changes === 1;
    if (!removed) return reply.code(404).send({ error: 'not_found' });
    realtime.refreshAll();
    return { removed: true };
  });

  app.post('/api/admin/seed', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const result = await seed.loadSeed();
    realtime.refreshAll();
    return { loaded: true, ...result };
  });

  app.delete('/api/admin/seed', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    seed.wipeSeed();
    realtime.refreshAll();
    return { wiped: 'seed' };
  });

  app.post('/api/admin/wipe-everything', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    if (request.body?.confirm !== 'ERASE') {
      return reply.code(400).send({ error: 'confirmation_required', expected: 'ERASE' });
    }
    seed.wipeEverything();
    realtime.refreshAll();
    return { wiped: 'everything' };
  });
}
