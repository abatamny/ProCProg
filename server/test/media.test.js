import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import {
  closeSocket,
  makeTestContext,
  openSocket,
  register,
  sendClientEvent,
  waitForFrame,
  waitUntil,
} from '../test-support/helpers.js';

function socketUrl(app) {
  const address = app.server.address();
  return `ws://127.0.0.1:${address.port}/ws`;
}

test('image upload returns 202, processes in the bounded queue, and publishes when ready', async () => {
  const context = makeTestContext();
  const app = buildApp({ config: context.config, logger: false });
  let socket;

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const user = await register(app, 'photo_knock');
    const image = await sharp({
      create: {
        width: 1600,
        height: 1000,
        channels: 3,
        background: { r: 72, g: 108, b: 94 },
      },
    }).webp({ quality: 80 }).toBuffer();

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'image/webp' },
      payload: image,
    });
    assert.equal(unauthorized.statusCode, 401);

    socket = await openSocket(socketUrl(app));
    const statePromise = waitForFrame(socket, (frame) => frame.type === 'place_state');
    sendClientEvent(socket, 'auth', { token: user.token });
    await statePromise;

    const upload = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'image/webp',
      },
      payload: image,
    });
    assert.equal(upload.statusCode, 202);
    const { mediaId } = upload.json();
    assert.ok(mediaId);

    const knockPromise = waitForFrame(
      socket,
      (frame) => frame.type === 'knock_new' && frame.payload.knock.mediaId === mediaId,
      5_000,
    );
    sendClientEvent(socket, 'knock_send', {
      targetPlaceId: 'faculty-data-decision-sciences',
      type: 'image',
      mediaId,
    });
    const knockFrame = await knockPromise;
    assert.match(knockFrame.payload.knock.dominantColor, /^#[a-f0-9]{6}$/);
    assert.ok(knockFrame.payload.knock.thumbUrl.endsWith('-thumb.webp'));
    assert.ok(knockFrame.payload.knock.mediumUrl.endsWith('-medium.webp'));

    await waitUntil(() => {
      const media = app.db.prepare('SELECT * FROM MEDIA WHERE ID = ?').get(mediaId);
      return Boolean(media?.THUMB_URL && media?.MEDIUM_URL && media?.DOMINANT_COLOR);
    }, 5_000);

    const row = app.db.prepare('SELECT * FROM MEDIA WHERE ID = ?').get(mediaId);
    const originalPath = path.join(context.config.mediaPath, path.basename(row.ORIGINAL_URL));
    const thumbPath = path.join(context.config.mediaPath, path.basename(row.THUMB_URL));
    const mediumPath = path.join(context.config.mediaPath, path.basename(row.MEDIUM_URL));
    assert.ok(fs.existsSync(originalPath));
    assert.deepEqual(
      await sharp(fs.readFileSync(thumbPath)).metadata()
        .then(({ width, height }) => ({ width, height })),
      { width: 128, height: 80 },
    );
    assert.deepEqual(
      await sharp(fs.readFileSync(mediumPath)).metadata()
        .then(({ width, height }) => ({ width, height })),
      { width: 800, height: 500 },
    );

    const served = await app.inject({ method: 'GET', url: row.THUMB_URL });
    assert.equal(served.statusCode, 200);
    assert.equal(served.headers['content-type'], 'image/webp');
    assert.equal(served.headers['cache-control'], 'public, max-age=31536000, immutable');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'image/webp',
      },
      payload: image,
    });
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().mediaId, mediaId);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM MEDIA').get().count, 1);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM KNOCKS').get().count, 1);
    assert.ok(app.services.media.concurrency >= 1);
  } finally {
    if (socket) await closeSocket(socket).catch(() => {});
    await app.close();
    context.cleanup();
  }
});
