import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PQueue from 'p-queue';
import sharp from 'sharp';

const MEDIA_FILENAME = /^[a-f0-9]{64}-(?:original|thumb|medium)\.webp$/;

function fileNames(hash) {
  return {
    original: `${hash}-original.webp`,
    thumb: `${hash}-thumb.webp`,
    medium: `${hash}-medium.webp`,
  };
}

function publicMedia(row) {
  if (!row) return null;
  return {
    id: row.ID,
    hash: row.HASH,
    dominantColor: row.DOMINANT_COLOR,
    thumbUrl: row.THUMB_URL,
    mediumUrl: row.MEDIUM_URL,
    originalUrl: row.ORIGINAL_URL,
    ready: Boolean(row.THUMB_URL && row.MEDIUM_URL && row.DOMINANT_COLOR),
  };
}

function colorHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function createMediaService({ db, mediaPath, logger }) {
  fs.mkdirSync(mediaPath, { recursive: true });
  sharp.concurrency(1);

  const concurrency = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
  const queue = new PQueue({ concurrency });
  const activeHashes = new Set();
  let onReady = () => {};

  const getByHash = db.prepare('SELECT * FROM MEDIA WHERE HASH = ?');
  const getById = db.prepare('SELECT * FROM MEDIA WHERE ID = ?');
  const insertMedia = db.prepare(
    `INSERT INTO MEDIA (ID, HASH, TYPE, ORIGINAL_URL)
     VALUES (?, ?, 'image', ?)`,
  );
  const markReady = db.prepare(
    `UPDATE MEDIA
     SET DOMINANT_COLOR = ?, THUMB_URL = ?, MEDIUM_URL = ?
     WHERE ID = ?`,
  );

  async function writeVariant(sourceBuffer, destinationPath, width) {
    const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
    try {
      await sharp(sourceBuffer, { failOn: 'error' })
        .rotate()
        .resize({
          width,
          height: width,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(temporaryPath);
      try {
        await fsPromises.rename(temporaryPath, destinationPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await fsPromises.unlink(temporaryPath).catch(() => {});
      }
    } catch (error) {
      await fsPromises.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async function processHash(hash) {
    const row = getByHash.get(hash);
    if (!row) return;
    if (row.THUMB_URL && row.MEDIUM_URL && row.DOMINANT_COLOR) {
      onReady(row.ID);
      return;
    }

    const names = fileNames(hash);
    const sourcePath = path.join(mediaPath, names.original);
    const thumbPath = path.join(mediaPath, names.thumb);
    const mediumPath = path.join(mediaPath, names.medium);
    const sourceBuffer = await fsPromises.readFile(sourcePath);
    const stats = await sharp(sourceBuffer, { failOn: 'error' }).stats();

    // 320px thumb: bubbles/trail render up to ~120 CSS px on 3x phone
    // screens (≈360 physical px) — 128px was visibly soft there.
    await Promise.all([
      writeVariant(sourceBuffer, thumbPath, 320),
      writeVariant(sourceBuffer, mediumPath, 800),
    ]);

    const dominantColor = colorHex(stats.dominant);
    const thumbUrl = `/media/${names.thumb}`;
    const mediumUrl = `/media/${names.medium}`;
    markReady.run(dominantColor, thumbUrl, mediumUrl, row.ID);
    onReady(row.ID);
  }

  function enqueue(hash) {
    if (activeHashes.has(hash)) return;
    activeHashes.add(hash);
    queue.add(async () => {
      try {
        await processHash(hash);
      } catch (error) {
        logger?.error?.({ error, hash }, 'Media processing failed');
      } finally {
        activeHashes.delete(hash);
      }
    }).catch(() => {});
  }

  return {
    concurrency,

    async accept(buffer) {
      const hash = createHash('sha256').update(buffer).digest('hex');
      const names = fileNames(hash);
      let row = getByHash.get(hash);

      if (!row) {
        const id = randomUUID();
        insertMedia.run(id, hash, `/media/${names.original}`);
        row = getById.get(id);
      }

      const originalPath = path.join(mediaPath, names.original);
      try {
        await fsPromises.writeFile(originalPath, buffer, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }

      if (!(row.THUMB_URL && row.MEDIUM_URL && row.DOMINANT_COLOR)) enqueue(hash);
      return publicMedia(row);
    },

    get(mediaId) {
      return publicMedia(getById.get(mediaId));
    },

    setReadyHandler(handler) {
      onReady = typeof handler === 'function' ? handler : () => {};
    },

    resolvePublicFile(filename) {
      if (!MEDIA_FILENAME.test(filename)) return null;
      return path.join(mediaPath, filename);
    },

    async close() {
      await queue.onIdle();
    },
  };
}
