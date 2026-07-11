import { randomUUID } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1_000;

export class MomentError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MomentError';
    this.code = code;
  }
}

export function createMomentService(db) {
  const insertMoment = db.prepare(
    `INSERT INTO MOMENTS (ID, PLACE_ID, PHONE_NUMBER, MEDIA_ID, CAPTION)
     VALUES (@id, @placeId, @phoneNumber, @mediaId, @caption)`,
  );
  const getMedia = db.prepare('SELECT ID, TYPE FROM MEDIA WHERE ID = ?');
  const findExistingLive = db.prepare(
    `SELECT ID
     FROM MOMENTS
     WHERE PLACE_ID = ? AND PHONE_NUMBER = ? AND MEDIA_ID = ? AND STATUS = 'live'
     ORDER BY CREATED_AT DESC
     LIMIT 1`,
  );
  // Same wire shape as place_state.liveMoments, plus mediaId so the client
  // can reconcile its optimistic capture bubble with the server copy.
  const getMomentQuery = db.prepare(
    `SELECT
       m.ID AS id,
       m.PLACE_ID AS placeId,
       m.MEDIA_ID AS mediaId,
       m.CAPTION AS caption,
       m.PRESENCE_COUNT AS presenceCount,
       m.STATUS AS status,
       m.CREATED_AT AS createdAt,
       u.NICKNAME AS nickname,
       media.DOMINANT_COLOR AS dominantColor,
       media.THUMB_URL AS thumbUrl,
       media.MEDIUM_URL AS mediumUrl
     FROM MOMENTS m
     JOIN USERS u ON u.PHONE_NUMBER = m.PHONE_NUMBER
     JOIN MEDIA media ON media.ID = m.MEDIA_ID
     WHERE m.ID = ?`,
  );
  const listLiveByMedia = db.prepare(
    `SELECT ID
     FROM MOMENTS
     WHERE MEDIA_ID = ? AND STATUS = 'live'
     ORDER BY CREATED_AT ASC`,
  );
  const insertPresence = db.prepare(
    `INSERT INTO MOMENT_PRESENCE (MOMENT_ID, PHONE_NUMBER, IS_SEED)
     VALUES (?, ?, 0)
     ON CONFLICT (MOMENT_ID, PHONE_NUMBER) DO NOTHING`,
  );
  const bumpPresenceCount = db.prepare(
    'UPDATE MOMENTS SET PRESENCE_COUNT = PRESENCE_COUNT + 1 WHERE ID = ?',
  );
  const listConfirmedIds = db.prepare(
    `SELECT mp.MOMENT_ID AS momentId
     FROM MOMENT_PRESENCE mp
     JOIN MOMENTS m ON m.ID = mp.MOMENT_ID
     WHERE mp.PHONE_NUMBER = ?`,
  );

  function getMoment(momentId) {
    return getMomentQuery.get(momentId) ?? null;
  }

  const confirmTransaction = db.transaction((momentId, phoneNumber) => {
    const inserted = insertPresence.run(momentId, phoneNumber).changes === 1;
    if (inserted) bumpPresenceCount.run(momentId);
    return inserted;
  });

  return {
    getMoment,

    findLive({ placeId, phoneNumber, mediaId }) {
      const existing = findExistingLive.get(placeId, phoneNumber, mediaId);
      return existing ? getMoment(existing.ID) : null;
    },

    create({ placeId, phoneNumber, mediaId, caption }) {
      if (typeof mediaId !== 'string' || !mediaId) throw new MomentError('media_required');
      const media = getMedia.get(mediaId);
      if (!media || media.TYPE !== 'image') throw new MomentError('invalid_media');

      let normalizedCaption = null;
      if (caption !== undefined && caption !== null) {
        if (typeof caption !== 'string' || caption.trim().length > 100) {
          throw new MomentError('invalid_caption');
        }
        normalizedCaption = caption.trim() || null;
      }

      const existing = findExistingLive.get(placeId, phoneNumber, mediaId);
      if (existing) return getMoment(existing.ID);

      const id = randomUUID();
      insertMoment.run({ id, placeId, phoneNumber, mediaId, caption: normalizedCaption });
      return getMoment(id);
    },

    // Returns the fresh moment (with the bumped count) or throws MomentError.
    // Place gating (the caller must be inside the moment's place) is enforced
    // by the websocket layer, which knows the socket's subscription set.
    confirmPresence({ momentId, phoneNumber }) {
      const moment = getMoment(momentId);
      if (!moment) throw new MomentError('unknown_moment');
      if (moment.status !== 'live') throw new MomentError('not_live');
      if (Date.now() - Date.parse(moment.createdAt) > DAY_MS) throw new MomentError('expired');
      const inserted = confirmTransaction(momentId, phoneNumber);
      return { moment: getMoment(momentId), alreadyConfirmed: !inserted };
    },

    listLiveByMediaId(mediaId) {
      return listLiveByMedia.all(mediaId).map((row) => getMoment(row.ID));
    },

    listConfirmedMomentIds(phoneNumber) {
      return listConfirmedIds.all(phoneNumber).map((row) => row.momentId);
    },
  };
}
