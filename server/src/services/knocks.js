import { randomUUID } from 'node:crypto';

export class KnockError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KnockError';
    this.code = code;
  }
}

export function createKnockService(db) {
  const insertKnock = db.prepare(
    `INSERT INTO KNOCKS (ID, PLACE_ID, PHONE_NUMBER, TYPE, CONTENT, MEDIA_ID)
     VALUES (@id, @placeId, @phoneNumber, @type, @content, @mediaId)`,
  );
  const getMedia = db.prepare('SELECT ID, TYPE FROM MEDIA WHERE ID = ?');
  const findExistingImage = db.prepare(
    `SELECT ID
     FROM KNOCKS
     WHERE PLACE_ID = ? AND PHONE_NUMBER = ? AND TYPE = 'image' AND MEDIA_ID = ?
     ORDER BY CREATED_AT DESC
     LIMIT 1`,
  );
  const getKnock = db.prepare(
    `SELECT
       k.ID AS id,
       k.PLACE_ID AS placeId,
       p.NAME AS placeName,
       k.TYPE AS type,
       k.CONTENT AS content,
       k.MEDIA_ID AS mediaId,
       k.CREATED_AT AS createdAt,
       u.NICKNAME AS nickname,
       media.DOMINANT_COLOR AS dominantColor,
       media.THUMB_URL AS thumbUrl,
       media.MEDIUM_URL AS mediumUrl,
       media.ORIGINAL_URL AS originalUrl
     FROM KNOCKS k
     JOIN USERS u ON u.PHONE_NUMBER = k.PHONE_NUMBER
     JOIN PLACES p ON p.ID = k.PLACE_ID
     LEFT JOIN MEDIA media ON media.ID = k.MEDIA_ID
     WHERE k.ID = ?`,
  );
  const listByMedia = db.prepare(
    `SELECT k.ID
     FROM KNOCKS k
     WHERE k.MEDIA_ID = ?
     ORDER BY k.CREATED_AT ASC`,
  );

  return {
    create({ placeId, phoneNumber, type, content, mediaId }) {
      if (type === 'video') throw new KnockError('video_not_supported');
      if (type !== 'text' && type !== 'image') throw new KnockError('invalid_type');

      let normalizedContent = null;
      let normalizedMediaId = null;

      if (type === 'text') {
        if (typeof content !== 'string' || !content.trim()) {
          throw new KnockError('content_required');
        }
        normalizedContent = content.trim();
      } else {
        if (typeof mediaId !== 'string' || !mediaId) {
          throw new KnockError('media_required');
        }
        const media = getMedia.get(mediaId);
        if (!media || media.TYPE !== 'image') throw new KnockError('invalid_media');
        if (content !== undefined && content !== null) {
          if (typeof content !== 'string' || content.trim().length > 80) {
            throw new KnockError('invalid_caption');
          }
          normalizedContent = content.trim() || null;
        }
        normalizedMediaId = mediaId;
        const existing = findExistingImage.get(placeId, phoneNumber, normalizedMediaId);
        if (existing) return getKnock.get(existing.ID);
      }

      const id = randomUUID();
      insertKnock.run({
        id,
        placeId,
        phoneNumber,
        type,
        content: normalizedContent,
        mediaId: normalizedMediaId,
      });
      return getKnock.get(id);
    },

    listByMediaId(mediaId) {
      return listByMedia.all(mediaId).map((row) => getKnock.get(row.ID));
    },
  };
}
