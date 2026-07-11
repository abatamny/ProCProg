import { randomUUID } from 'node:crypto';

export class MemoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MemoryError';
    this.code = code;
  }
}

const DAYPARTS = [
  { from: 5, to: 12, label: 'morning' },
  { from: 12, to: 17, label: 'afternoon' },
  { from: 17, to: 22, label: 'evening' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// SPEC §4 fallback chain, rule 2: "{Weekday} {daypart}" from local time.
export function timeTemplateTitle(dateLike) {
  const date = new Date(dateLike);
  const hour = date.getHours();
  const daypart = DAYPARTS.find((part) => hour >= part.from && hour < part.to)?.label ?? 'night';
  return `${WEEKDAYS[date.getDay()]} ${daypart}`;
}

const MEMORY_CARD_SELECT = `
  SELECT
    memory.ID AS id,
    memory.PLACE_ID AS placeId,
    memory.TITLE AS title,
    memory.PRESENCE_TOTAL AS presenceTotal,
    memory.PHOTO_COUNT AS photoCount,
    memory.ENGRAVED_AT AS engravedAt,
    media.DOMINANT_COLOR AS dominantColor,
    media.THUMB_URL AS thumbUrl,
    media.MEDIUM_URL AS coverMediumUrl
  FROM MEMORIES memory
  JOIN MEDIA media ON media.ID = memory.COVER_MEDIA_ID`;

export function createMemoryService(db) {
  const getCard = db.prepare(`${MEMORY_CARD_SELECT} WHERE memory.ID = ?`);
  const firstPage = db.prepare(
    `${MEMORY_CARD_SELECT}
     WHERE memory.PLACE_ID = @placeId
     ORDER BY memory.ENGRAVED_AT DESC, memory.ID DESC
     LIMIT @limit`,
  );
  const nextPage = db.prepare(
    `${MEMORY_CARD_SELECT}
     WHERE memory.PLACE_ID = @placeId
       AND (memory.ENGRAVED_AT < @beforeEngravedAt
         OR (memory.ENGRAVED_AT = @beforeEngravedAt AND memory.ID < @beforeId))
     ORDER BY memory.ENGRAVED_AT DESC, memory.ID DESC
     LIMIT @limit`,
  );
  const albumItems = db.prepare(
    `SELECT
       mm.ORDER_INDEX AS orderIndex,
       media.ID AS mediaId,
       media.DOMINANT_COLOR AS dominantColor,
       media.THUMB_URL AS thumbUrl,
       media.MEDIUM_URL AS mediumUrl,
       media.ORIGINAL_URL AS originalUrl
     FROM MEMORY_MEDIA mm
     JOIN MEDIA media ON media.ID = mm.MEDIA_ID
     WHERE mm.MOMENT_ID = ?
     ORDER BY mm.ORDER_INDEX ASC`,
  );
  const selectMomentsForEngrave = db.prepare(
    `SELECT
       m.ID AS id,
       m.PLACE_ID AS placeId,
       m.PHONE_NUMBER AS phoneNumber,
       m.MEDIA_ID AS mediaId,
       m.CAPTION AS caption,
       m.PRESENCE_COUNT AS presenceCount,
       m.STATUS AS status,
       m.CREATED_AT AS createdAt,
       u.NICKNAME AS nickname
     FROM MOMENTS m
     JOIN USERS u ON u.PHONE_NUMBER = m.PHONE_NUMBER
     WHERE m.ID = ?`,
  );
  const confirmersForMoment = db.prepare(
    `SELECT mp.PHONE_NUMBER AS phoneNumber, u.NICKNAME AS nickname
     FROM MOMENT_PRESENCE mp
     JOIN USERS u ON u.PHONE_NUMBER = mp.PHONE_NUMBER
     WHERE mp.MOMENT_ID = ?`,
  );
  const isAncestor = db.prepare(
    `SELECT 1 FROM PLACE_HIERARCHY
     WHERE DESCENDANT_PLACE_ID = ? AND ANCESTOR_PLACE_ID = ?`,
  );
  const insertMemory = db.prepare(
    `INSERT INTO MEMORIES (ID, PLACE_ID, TITLE, COVER_MEDIA_ID, PRESENCE_TOTAL, PHOTO_COUNT)
     VALUES (@id, @placeId, @title, @coverMediaId, @presenceTotal, @photoCount)`,
  );
  const insertMemoryMedia = db.prepare(
    'INSERT INTO MEMORY_MEDIA (MOMENT_ID, MEDIA_ID, ORDER_INDEX) VALUES (?, ?, ?)',
  );
  const insertParticipant = db.prepare(
    'INSERT INTO MEMORY_PARTICIPANTS (MOMENT_ID, PHONE_NUMBER, ROLE) VALUES (?, ?, ?)',
  );
  const markEngraved = db.prepare(
    "UPDATE MOMENTS SET STATUS = 'engraved' WHERE ID = ?",
  );

  const engraveTransaction = db.transaction(({ momentIds, title, targetPlaceId }) => {
    const moments = momentIds.map((id) => selectMomentsForEngrave.get(id));
    if (moments.some((moment) => !moment)) throw new MemoryError('unknown_moment');
    if (moments.some((moment) => moment.status !== 'live')) throw new MemoryError('not_live');

    const homePlaceId = moments[0].placeId;
    if (moments.some((moment) => moment.placeId !== homePlaceId)) {
      throw new MemoryError('mixed_places');
    }
    // The console may engrave into the moments' own place or one level up.
    const placeId = targetPlaceId ?? homePlaceId;
    if (placeId !== homePlaceId && !isAncestor.get(homePlaceId, placeId)) {
      throw new MemoryError('invalid_target_place');
    }

    const byCreation = [...moments].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );

    // SPEC §4 fallback chain, rule 1: caption of the highest-presence moment.
    let resolvedTitle = typeof title === 'string' ? title.trim().slice(0, 80) : '';
    if (!resolvedTitle) {
      const captioned = moments
        .filter((moment) => moment.caption)
        .sort((a, b) => b.presenceCount - a.presenceCount);
      resolvedTitle = captioned.length > 0
        ? captioned[0].caption.slice(0, 40)
        : timeTemplateTitle(byCreation.at(-1).createdAt);
    }

    const cover = [...moments].sort((a, b) => (
      b.presenceCount - a.presenceCount
      || Date.parse(a.createdAt) - Date.parse(b.createdAt)
    ))[0];

    const seenMedia = new Set();
    const orderedMedia = [];
    for (const moment of byCreation) {
      if (seenMedia.has(moment.mediaId)) continue;
      seenMedia.add(moment.mediaId);
      orderedMedia.push(moment.mediaId);
    }

    // PRESENCE_TOTAL = union of confirming users across the selected moments.
    const confirmers = new Map();
    for (const moment of moments) {
      for (const row of confirmersForMoment.all(moment.id)) {
        confirmers.set(row.phoneNumber, row.nickname);
      }
    }

    // Participants: contributor = authored a moment; witness = confirmed
    // "I was here"; contributor wins when both.
    const participants = new Map();
    for (const [phoneNumber, nickname] of confirmers) {
      participants.set(phoneNumber, { nickname, role: 'witness' });
    }
    for (const moment of moments) {
      participants.set(moment.phoneNumber, { nickname: moment.nickname, role: 'contributor' });
    }

    const memoryId = randomUUID();
    insertMemory.run({
      id: memoryId,
      placeId,
      title: resolvedTitle,
      coverMediaId: cover.mediaId,
      presenceTotal: confirmers.size,
      photoCount: orderedMedia.length,
    });
    orderedMedia.forEach((mediaId, index) => insertMemoryMedia.run(memoryId, mediaId, index));
    for (const [phoneNumber, entry] of participants) {
      insertParticipant.run(memoryId, phoneNumber, entry.role);
    }
    for (const moment of moments) markEngraved.run(moment.id);

    return {
      memory: getCard.get(memoryId),
      removedDigIds: moments.map((moment) => moment.id),
      participants: [...participants.values()],
    };
  });

  return {
    getCard(memoryId) {
      return getCard.get(memoryId) ?? null;
    },

    listPage({ placeId, beforeEngravedAt = null, beforeId = null, limit = 10 }) {
      const boundedLimit = Math.max(1, Math.min(30, limit));
      const memories = beforeEngravedAt && beforeId
        ? nextPage.all({ placeId, beforeEngravedAt, beforeId, limit: boundedLimit })
        : firstPage.all({ placeId, limit: boundedLimit });
      const last = memories.at(-1);
      return {
        memories,
        nextCursor: memories.length === boundedLimit && last
          ? { beforeEngravedAt: last.engravedAt, beforeId: last.id }
          : null,
      };
    },

    getAlbum(memoryId) {
      const memory = getCard.get(memoryId);
      if (!memory) return null;
      return { memory, items: albumItems.all(memoryId) };
    },

    engrave({ momentIds, title = null, targetPlaceId = null }) {
      if (!Array.isArray(momentIds) || momentIds.length === 0
        || momentIds.some((id) => typeof id !== 'string')) {
        throw new MemoryError('moments_required');
      }
      return engraveTransaction({ momentIds: [...new Set(momentIds)], title, targetPlaceId });
    },
  };
}
