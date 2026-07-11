import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';

function publicPlace(row) {
  if (!row) return null;
  return {
    id: row.ID,
    name: row.NAME,
    slug: row.SLUG,
    parentPlaceId: row.PARENT_PLACE_ID,
  };
}

export function createPlaceService(db) {
  const getPlaceRow = db.prepare('SELECT * FROM PLACES WHERE ID = ?');
  const listForResolution = db.prepare(
    `SELECT p.*,
       COALESCE((
         SELECT MAX(ph.DEPTH)
         FROM PLACE_HIERARCHY ph
         WHERE ph.DESCENDANT_PLACE_ID = p.ID
       ), 0) AS NESTING_DEPTH
     FROM PLACES p
     ORDER BY NESTING_DEPTH DESC, p.ID`,
  );
  const layerRows = db.prepare(
    `SELECT p.*, ph.DEPTH
     FROM PLACE_HIERARCHY ph
     JOIN PLACES p ON p.ID = ph.ANCESTOR_PLACE_ID
     WHERE ph.DESCENDANT_PLACE_ID = ?
     ORDER BY ph.DEPTH ASC`,
  );
  const containedRows = db.prepare(
    `SELECT DESCENDANT_PLACE_ID AS id
     FROM PLACE_HIERARCHY
     WHERE ANCESTOR_PLACE_ID = ?
     ORDER BY DEPTH ASC`,
  );
  const getForce = db.prepare('SELECT FORCE_PLACE_ID AS forcePlaceId FROM SETTINGS WHERE ID = 1');
  const setForce = db.prepare(
    `UPDATE SETTINGS
     SET FORCE_PLACE_ID = ?, UPDATED_AT = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE ID = 1`,
  );

  const selectKnocks = db.prepare(
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
     WHERE k.PLACE_ID IN (
       SELECT ANCESTOR_PLACE_ID
       FROM PLACE_HIERARCHY
       WHERE DESCENDANT_PLACE_ID = @placeId
     )
       AND k.CREATED_AT > @cutoff
     ORDER BY k.CREATED_AT ASC`,
  );
  const selectMoments = db.prepare(
    `SELECT
       m.ID AS id,
       m.PLACE_ID AS placeId,
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
     WHERE m.PLACE_ID = @placeId
       AND m.STATUS = 'live'
       AND m.CREATED_AT > @cutoff
     ORDER BY m.CREATED_AT DESC`,
  );
  const selectMemories = db.prepare(
    `SELECT
       memory.ID AS id,
       memory.PLACE_ID AS placeId,
       memory.TITLE AS title,
       memory.PRESENCE_TOTAL AS presenceTotal,
       memory.PHOTO_COUNT AS photoCount,
       memory.ENGRAVED_AT AS engravedAt,
       media.DOMINANT_COLOR AS dominantColor,
       media.THUMB_URL AS thumbUrl
     FROM MEMORIES memory
     JOIN MEDIA media ON media.ID = memory.COVER_MEDIA_ID
     WHERE memory.PLACE_ID = ?
     ORDER BY memory.ENGRAVED_AT DESC
     LIMIT 10`,
  );

  function getPlace(placeId) {
    return publicPlace(getPlaceRow.get(placeId));
  }

  function getLayerStack(placeId, getPresenceCount = () => 0) {
    return layerRows.all(placeId).map((row) => ({
      ...publicPlace(row),
      presenceCount: getPresenceCount(row.ID),
    }));
  }

  return {
    getPlace,

    resolve(lat, lng) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      const location = point([lng, lat]);
      for (const row of listForResolution.all()) {
        if (booleanPointInPolygon(location, JSON.parse(row.GEOJSON))) {
          return publicPlace(row);
        }
      }
      return null;
    },

    getLayerStack,

    getAncestorIds(placeId) {
      return layerRows.all(placeId).map((row) => row.ID);
    },

    getContainedIds(placeId) {
      return containedRows.all(placeId).map((row) => row.id);
    },

    getForcePlaceId() {
      return getForce.get()?.forcePlaceId ?? null;
    },

    setForcePlaceId(placeId) {
      if (placeId !== null && !getPlaceRow.get(placeId)) {
        throw new Error('Unknown place');
      }
      setForce.run(placeId);
      return placeId === null ? null : getPlace(placeId);
    },

    buildPlaceState(placeId, getPresenceCount = () => 0) {
      const place = getPlace(placeId);
      if (!place) return null;
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
      const layerStack = getLayerStack(placeId, getPresenceCount);
      return {
        place,
        layerStack,
        presenceCount: getPresenceCount(placeId),
        knocks: selectKnocks.all({ placeId, cutoff }),
        liveMoments: selectMoments.all({ placeId, cutoff }),
        memories: selectMemories.all(placeId),
        nextMemoriesCursor: null,
      };
    },
  };
}
