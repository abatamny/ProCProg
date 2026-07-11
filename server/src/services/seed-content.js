import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PLACE_ID = 'faculty-data-decision-sciences';

const SEED_USERS = [
  ['seed:1', 'maya_r'],
  ['seed:2', 'tomer_k'],
  ['seed:3', 'noa_lev'],
  ['seed:4', 'idan_b'],
  ['seed:5', 'shira_m'],
  ['seed:6', 'yonatan'],
  ['seed:7', 'tal_or'],
  ['seed:8', 'dana_zh'],
];

// Abstract, campus-neutral gradient scenes. Rendered once by sharp into the
// same <hash>-{original,thumb,medium}.webp layout the live pipeline produces.
const SEED_IMAGES = [
  { base: '#B8886B', accent: '#EAD9C4', shape: 'circle' },
  { base: '#7C8B74', accent: '#D9E2CE', shape: 'arch' },
  { base: '#8A93A6', accent: '#E3E7EF', shape: 'bars' },
  { base: '#B3776A', accent: '#F0DED2', shape: 'circle' },
  { base: '#9A8C6E', accent: '#EFE6CF', shape: 'arch' },
  { base: '#6E8B8A', accent: '#DBEAE9', shape: 'bars' },
  { base: '#A4776F', accent: '#ECD9D0', shape: 'arch' },
  { base: '#77808F', accent: '#DFE4EC', shape: 'circle' },
  { base: '#8F9B7A', accent: '#E7EEDA', shape: 'bars' },
  { base: '#B08A5E', accent: '#F1E3CC', shape: 'arch' },
];

function sceneSvg({ base, accent, shape }, index) {
  const marks = {
    circle: `<circle cx="${520 + index * 37}" cy="${430 - index * 21}" r="270" fill="${accent}" opacity="0.55"/>
             <circle cx="${1080 - index * 23}" cy="${640 + index * 11}" r="150" fill="#141414" opacity="0.08"/>`,
    arch: `<path d="M 260 1100 L 260 520 Q 800 ${140 + index * 20} 1340 520 L 1340 1100 Z" fill="${accent}" opacity="0.6"/>
           <rect x="700" y="640" width="200" height="460" fill="#141414" opacity="0.10"/>`,
    bars: `<rect x="180" y="${240 + index * 15}" width="220" height="860" fill="${accent}" opacity="0.6"/>
           <rect x="520" y="${400 - index * 10}" width="220" height="700" fill="${accent}" opacity="0.4"/>
           <rect x="860" y="320" width="220" height="780" fill="#141414" opacity="0.08"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${base}"/>
        <stop offset="1" stop-color="${accent}"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="1100" fill="url(#g)"/>
    ${marks[shape]}
  </svg>`;
}

function agoIso(ms) {
  return new Date(Date.now() - ms).toISOString();
}
const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function createSeedService({ db, mediaPath }) {
  const insertUser = db.prepare(
    `INSERT INTO USERS (PHONE_NUMBER, NICKNAME, IS_SEED) VALUES (?, ?, 1)
     ON CONFLICT (PHONE_NUMBER) DO UPDATE SET IS_SEED = 1`,
  );
  const upsertMedia = db.prepare(
    `INSERT INTO MEDIA (ID, HASH, TYPE, DOMINANT_COLOR, THUMB_URL, MEDIUM_URL, ORIGINAL_URL, IS_SEED)
     VALUES (@id, @hash, 'image', @dominantColor, @thumbUrl, @mediumUrl, @originalUrl, 1)
     ON CONFLICT (HASH) DO UPDATE SET IS_SEED = 1`,
  );
  const mediaIdByHash = db.prepare('SELECT ID AS id FROM MEDIA WHERE HASH = ?');
  const insertKnock = db.prepare(
    `INSERT INTO KNOCKS (ID, PLACE_ID, PHONE_NUMBER, TYPE, CONTENT, MEDIA_ID, CREATED_AT, IS_SEED)
     VALUES (@id, @placeId, @phoneNumber, @type, @content, @mediaId, @createdAt, 1)`,
  );
  const insertMoment = db.prepare(
    `INSERT INTO MOMENTS
       (ID, PLACE_ID, PHONE_NUMBER, MEDIA_ID, CAPTION, PRESENCE_COUNT, STATUS, CREATED_AT, IS_SEED)
     VALUES (@id, @placeId, @phoneNumber, @mediaId, @caption, @presenceCount, 'live', @createdAt, 1)`,
  );
  const insertMomentPresence = db.prepare(
    `INSERT INTO MOMENT_PRESENCE (MOMENT_ID, PHONE_NUMBER, IS_SEED) VALUES (?, ?, 1)`,
  );
  const insertMemory = db.prepare(
    `INSERT INTO MEMORIES
       (ID, PLACE_ID, TITLE, COVER_MEDIA_ID, PRESENCE_TOTAL, PHOTO_COUNT, ENGRAVED_AT, IS_SEED)
     VALUES (@id, @placeId, @title, @coverMediaId, @presenceTotal, @photoCount, @engravedAt, 1)`,
  );
  const insertMemoryMedia = db.prepare(
    'INSERT INTO MEMORY_MEDIA (MOMENT_ID, MEDIA_ID, ORDER_INDEX, IS_SEED) VALUES (?, ?, ?, 1)',
  );
  const insertParticipant = db.prepare(
    'INSERT INTO MEMORY_PARTICIPANTS (MOMENT_ID, PHONE_NUMBER, ROLE, IS_SEED) VALUES (?, ?, ?, 1)',
  );

  // FK-safe order: children first, MEDIA after everything that references it.
  const SEED_WIPE_STATEMENTS = [
    'DELETE FROM MEMORY_REACTIONS WHERE IS_SEED = 1',
    'DELETE FROM MEMORY_PARTICIPANTS WHERE IS_SEED = 1',
    'DELETE FROM MEMORY_MEDIA WHERE IS_SEED = 1',
    'DELETE FROM MEMORIES WHERE IS_SEED = 1',
    'DELETE FROM MOMENT_PRESENCE WHERE IS_SEED = 1',
    'DELETE FROM MOMENTS WHERE IS_SEED = 1',
    'DELETE FROM KNOCKS WHERE IS_SEED = 1',
    'DELETE FROM SESSIONS WHERE IS_SEED = 1',
    'DELETE FROM USER_VISITS WHERE IS_SEED = 1',
    'DELETE FROM USER_PLACE_RANK WHERE IS_SEED = 1',
    'DELETE FROM USERS WHERE IS_SEED = 1',
    'DELETE FROM MEDIA WHERE IS_SEED = 1',
  ].map((sql) => db.prepare(sql));

  const EVERYTHING_STATEMENTS = [
    'DELETE FROM MEMORY_REACTIONS',
    'DELETE FROM MEMORY_PARTICIPANTS',
    'DELETE FROM MEMORY_MEDIA',
    'DELETE FROM MEMORIES',
    'DELETE FROM MOMENT_PRESENCE',
    'DELETE FROM MOMENTS',
    'DELETE FROM KNOCKS',
    'DELETE FROM SESSIONS',
    'DELETE FROM USER_VISITS',
    'DELETE FROM USER_PLACE_RANK',
    'DELETE FROM USERS',
    'DELETE FROM MEDIA',
  ].map((sql) => db.prepare(sql));

  const wipeSeedTransaction = db.transaction(() => {
    for (const statement of SEED_WIPE_STATEMENTS) statement.run();
  });
  const wipeEverythingTransaction = db.transaction(() => {
    for (const statement of EVERYTHING_STATEMENTS) statement.run();
  });

  async function generateSeedImage(scene, index) {
    const svg = Buffer.from(sceneSvg(scene, index));
    const original = await sharp(svg).webp({ quality: 80 }).toBuffer();
    const hash = createHash('sha256').update(original).digest('hex');
    const names = {
      original: `${hash}-original.webp`,
      thumb: `${hash}-thumb.webp`,
      medium: `${hash}-medium.webp`,
    };
    await fs.writeFile(path.join(mediaPath, names.original), original);
    await sharp(original)
      .resize({ width: 320, height: 320, fit: 'inside' })
      .webp({ quality: 80 })
      .toFile(path.join(mediaPath, names.thumb));
    await sharp(original)
      .resize({ width: 800, height: 800, fit: 'inside' })
      .webp({ quality: 80 })
      .toFile(path.join(mediaPath, names.medium));
    return { hash, names, dominantColor: scene.base };
  }

  return {
    // Loads (replacing any previous seed) the SPEC §9 world: users, knocks,
    // live moments with varied presence, memories across time strata.
    async loadSeed() {
      const images = [];
      for (const [index, scene] of SEED_IMAGES.entries()) {
        images.push(await generateSeedImage(scene, index));
      }

      db.transaction(() => {
        wipeSeedTransaction();

        for (const [phoneNumber, nickname] of SEED_USERS) {
          insertUser.run(phoneNumber, nickname);
        }

        const mediaIds = images.map((image, index) => {
          upsertMedia.run({
            id: `seed-media-${index + 1}`,
            hash: image.hash,
            dominantColor: image.dominantColor,
            thumbUrl: `/media/${image.names.thumb}`,
            mediumUrl: `/media/${image.names.medium}`,
            originalUrl: `/media/${image.names.original}`,
          });
          return mediaIdByHash.get(image.hash).id;
        });

        const textKnocks = [
          ['seed:1', 'Anyone else here before the 9am lecture?', 170 * MINUTE],
          ['seed:2', 'The coffee machine on floor 2 is finally fixed.', 120 * MINUTE],
          ['seed:3', 'Left my notes in room 301, grabbing them at noon.', 95 * MINUTE],
          ['seed:4', 'Study group for the stats exam at the library, come.', 60 * MINUTE],
          ['seed:5', 'The sunset from the top floor is unreal right now.', 25 * MINUTE],
          ['seed:6', 'Whoever plays piano in the lobby — keep going.', 8 * MINUTE],
        ];
        textKnocks.forEach(([phoneNumber, content, ago], index) => {
          insertKnock.run({
            id: `seed-knock-${index + 1}`,
            placeId: PLACE_ID,
            phoneNumber,
            type: 'text',
            content,
            mediaId: null,
            createdAt: agoIso(ago),
          });
        });
        insertKnock.run({
          id: 'seed-knock-photo-1',
          placeId: PLACE_ID,
          phoneNumber: 'seed:7',
          type: 'image',
          content: 'the lobby right now',
          mediaId: mediaIds[6],
          createdAt: agoIso(40 * MINUTE),
        });

        // Varied presence counts so bubbles render at visibly different sizes.
        const moments = [
          ['seed:1', mediaIds[0], 'morning light in the atrium', 2 * HOUR, 8],
          ['seed:2', mediaIds[1], null, 4 * HOUR, 6],
          ['seed:3', mediaIds[2], 'this corridor never gets old', 7 * HOUR, 4],
          ['seed:4', mediaIds[3], 'someone built this from post-its', 10 * HOUR, 2],
          ['seed:5', mediaIds[4], null, 20 * HOUR, 1],
        ];
        moments.forEach(([phoneNumber, mediaId, caption, ago, presence], index) => {
          const momentId = `seed-moment-${index + 1}`;
          insertMoment.run({
            id: momentId,
            placeId: PLACE_ID,
            phoneNumber,
            mediaId,
            caption,
            presenceCount: presence,
            createdAt: agoIso(ago),
          });
          for (let n = 0; n < presence; n += 1) {
            insertMomentPresence.run(momentId, SEED_USERS[n][0]);
          }
        });

        // Memories across strata: this week, earlier this year, past years.
        const memories = [
          {
            id: 'seed-memory-1',
            title: 'the night the projector died',
            mediaIndexes: [5, 6, 7],
            presenceTotal: 34,
            engravedAt: agoIso(3 * DAY),
            participants: [['seed:1', 'contributor'], ['seed:2', 'contributor'], ['seed:3', 'witness'], ['seed:4', 'witness']],
          },
          {
            id: 'seed-memory-2',
            title: 'first rain on the deck',
            mediaIndexes: [8],
            presenceTotal: 12,
            engravedAt: agoIso(6 * DAY),
            participants: [['seed:5', 'contributor'], ['seed:6', 'witness']],
          },
          {
            id: 'seed-memory-3',
            title: 'Sunday evening',
            mediaIndexes: [9],
            presenceTotal: 21,
            engravedAt: agoIso(35 * DAY),
            participants: [['seed:7', 'contributor']],
          },
          {
            id: 'seed-memory-4',
            title: 'exam week, 2am, all of us',
            mediaIndexes: [0, 3],
            presenceTotal: 47,
            engravedAt: agoIso(150 * DAY),
            participants: [['seed:8', 'contributor'], ['seed:1', 'witness'], ['seed:2', 'witness']],
          },
          {
            id: 'seed-memory-5',
            title: 'Thursday afternoon',
            mediaIndexes: [2],
            presenceTotal: 18,
            engravedAt: agoIso(380 * DAY),
            participants: [['seed:3', 'contributor']],
          },
        ];
        for (const memory of memories) {
          insertMemory.run({
            id: memory.id,
            placeId: PLACE_ID,
            title: memory.title,
            coverMediaId: mediaIds[memory.mediaIndexes[0]],
            presenceTotal: memory.presenceTotal,
            photoCount: memory.mediaIndexes.length,
            engravedAt: memory.engravedAt,
          });
          memory.mediaIndexes.forEach((mediaIndex, order) => {
            insertMemoryMedia.run(memory.id, mediaIds[mediaIndex], order);
          });
          for (const [phoneNumber, role] of memory.participants) {
            insertParticipant.run(memory.id, phoneNumber, role);
          }
        }
      })();

      return { users: SEED_USERS.length, images: images.length };
    },

    wipeSeed() {
      wipeSeedTransaction();
    },

    // Leaves PLACES / PLACE_HIERARCHY / SETTINGS intact.
    wipeEverything() {
      wipeEverythingTransaction();
    },
  };
}
