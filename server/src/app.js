import { timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { createDatabase, getJournalMode } from './db/database.js';
import { createRealtimeServer } from './realtime/websocket.js';
import { createKnockService } from './services/knocks.js';
import { createMediaService } from './services/media.js';
import { createMemoryService } from './services/memories.js';
import { createMomentService } from './services/moments.js';
import { createPlaceService } from './services/places.js';
import { createSeedService } from './services/seed-content.js';
import { registerStage5Routes } from './routes/stage5.js';
import { renderStage1Harness } from './stage1-harness.js';
import {
  bearerToken,
  createSessionService,
  NicknameError,
} from './services/sessions.js';

function passwordMatches(received, expected) {
  if (!expected || typeof received !== 'string') return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function setClientCacheHeaders(response, filePath, clientDistPath) {
  const relativePath = path.relative(clientDistPath, filePath);
  const isHashedAsset = relativePath.startsWith(`assets${path.sep}`);
  response.setHeader(
    'cache-control',
    isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
}

function isAllowedMediaPath(pathName, media) {
  const filename = pathName.replace(/^[/\\]+/, '');
  if (!filename || filename.includes('/') || filename.includes('\\')) return false;
  return Boolean(media.resolvePublicFile(filename));
}

export function buildApp({ config, tlsOptions = null, database = null, logger } = {}) {
  if (!config) throw new Error('buildApp requires config');

  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 5 * 1_024 * 1_024,
    https: tlsOptions ?? undefined,
  });
  const ownsDatabase = database === null;
  const db = database ?? createDatabase(config);
  const sessions = createSessionService(db);
  const places = createPlaceService(db);
  const knocks = createKnockService(db);
  const media = createMediaService({ db, mediaPath: config.mediaPath, logger: app.log });
  const moments = createMomentService(db);
  const memories = createMemoryService(db);
  const seed = createSeedService({ db, mediaPath: config.mediaPath });
  const realtime = createRealtimeServer({ app, db, config, sessions, places, knocks, moments });
  media.setReadyHandler((mediaId) => {
    for (const knock of knocks.listByMediaId(mediaId)) {
      realtime.broadcastToPlace(knock.placeId, 'knock_new', { knock });
    }
    for (const moment of moments.listLiveByMediaId(mediaId)) {
      realtime.broadcastToPlace(moment.placeId, 'moment_new', { dig: moment });
    }
  });

  app.decorate('db', db);
  app.decorate('services', { sessions, places, knocks, media, moments, memories, seed });
  app.decorate('realtime', realtime);

  registerStage5Routes(app, {
    config, db, sessions, places, media, moments, memories, seed, realtime,
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    database: {
      journalMode: getJournalMode(db),
      foreignKeys: db.pragma('foreign_keys', { simple: true }) === 1,
    },
    forcePlaceId: places.getForcePlaceId(),
  }));

  if (config.enableStage1Harness && config.nodeEnv === 'development') {
    app.get('/stage1-test', async (_request, reply) => reply
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(renderStage1Harness(config.nodeEnv)));
  }

  app.post('/api/register', async (request, reply) => {
    try {
      const result = sessions.register(request.body?.nickname);
      if (result.conflict) {
        return reply.code(409).send({
          error: 'nickname_taken',
          suggestion: result.suggestion,
        });
      }
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NicknameError) {
        return reply.code(400).send({ error: 'invalid_nickname', message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/session', async (request, reply) => {
    const session = sessions.validate(bearerToken(request.headers.authorization));
    if (!session) return reply.code(401).send({ error: 'invalid_session' });
    return { user: { nickname: session.nickname } };
  });

  app.addContentTypeParser(
    'image/webp',
    { parseAs: 'buffer', bodyLimit: 5 * 1_024 * 1_024 },
    (_request, body, done) => done(null, body),
  );

  app.post('/api/media', async (request, reply) => {
    const session = sessions.validate(bearerToken(request.headers.authorization));
    if (!session) return reply.code(401).send({ error: 'invalid_session' });
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return reply.code(400).send({ error: 'image_required' });
    }
    const accepted = await media.accept(request.body);
    return reply.code(202).send({ mediaId: accepted.id });
  });

  if (config.nodeEnv === 'development') {
    app.get('/media/:filename', async (request, reply) => {
      const filePath = media.resolvePublicFile(request.params.filename);
      if (!filePath) return reply.code(404).send({ error: 'not_found' });
      try {
        await fs.access(filePath);
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply
        .header('cache-control', 'public, max-age=31536000, immutable')
        .type('image/webp')
        .send(createReadStream(filePath));
    });
  }

  if (config.nodeEnv === 'production') {
    if (config.clientDistPath) {
      app.register(fastifyStatic, {
        root: config.clientDistPath,
        prefix: '/',
        cacheControl: false,
        setHeaders: (response, filePath) => {
          setClientCacheHeaders(response, filePath, config.clientDistPath);
        },
      });

      const sendClientIndex = (_request, reply) => reply
        .header('cache-control', 'no-cache')
        .sendFile('index.html');
      app.get('/admin', sendClientIndex);
      app.get('/admin/*', sendClientIndex);
    }

    app.register(fastifyStatic, {
      root: config.mediaPath,
      prefix: '/media/',
      decorateReply: !config.clientDistPath,
      cacheControl: false,
      allowedPath: (pathName) => isAllowedMediaPath(pathName, media),
      setHeaders: (response) => {
        response.setHeader('cache-control', 'public, max-age=31536000, immutable');
        response.setHeader('x-content-type-options', 'nosniff');
      },
    });
  }

  async function requireAdmin(request, reply) {
    if (!passwordMatches(request.headers['x-admin-password'], config.adminPassword)) {
      await reply.code(401).send({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  app.get('/api/admin/force-location', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const forcePlaceId = places.getForcePlaceId();
    return {
      forcePlaceId,
      place: forcePlaceId ? places.getPlace(forcePlaceId) : null,
    };
  });

  app.put('/api/admin/force-location', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!request.body || !Object.hasOwn(request.body, 'forcePlaceId')) {
      return reply.code(400).send({ error: 'forcePlaceId_required' });
    }

    const nextPlaceId = request.body.forcePlaceId === null
      ? null
      : String(request.body.forcePlaceId);
    const previousPlaceId = places.getForcePlaceId();
    if (previousPlaceId === nextPlaceId) {
      return {
        forcePlaceId: nextPlaceId,
        place: nextPlaceId ? places.getPlace(nextPlaceId) : null,
        changed: false,
      };
    }

    try {
      const place = places.setForcePlaceId(nextPlaceId);
      realtime.relocateAll(nextPlaceId);
      return { forcePlaceId: nextPlaceId, place, changed: true };
    } catch (error) {
      if (error.message === 'Unknown place') {
        return reply.code(400).send({ error: 'unknown_place' });
      }
      throw error;
    }
  });

  app.addHook('preClose', async () => {
    await media.close();
    await realtime.close();
  });
  app.addHook('onClose', async () => {
    if (ownsDatabase) db.close();
  });

  return app;
}
