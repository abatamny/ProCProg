import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import {
  closeSocket,
  makeTestContext,
  openSocket,
  register,
  sendClientEvent,
  waitForFrame,
} from '../test-support/helpers.js';

function socketUrl(app) {
  const address = app.server.address();
  return `ws://127.0.0.1:${address.port}/ws`;
}

test('knocks keep 24h history and route from ancestor layers into contained places', async () => {
  const context = makeTestContext({ forcePlaceId: null });
  const app = buildApp({ config: context.config, logger: false });
  const sockets = [];

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const innerUser = await register(app, 'inner_knock');
    const outerUser = await register(app, 'outer_knock');
    const innerPhone = app.db.prepare(
      'SELECT PHONE_NUMBER FROM USERS WHERE NICKNAME = ?',
    ).get('inner_knock').PHONE_NUMBER;
    const url = socketUrl(app);

    const inner = await openSocket(url);
    const outer = await openSocket(url);
    sockets.push(inner, outer);

    const innerState = waitForFrame(
      inner,
      (frame) => frame.type === 'place_state'
        && frame.payload.place?.id === 'faculty-data-decision-sciences',
    );
    sendClientEvent(inner, 'auth', { token: innerUser.token });
    sendClientEvent(inner, 'location', { lat: 32.77421, lng: 35.02361 });
    await innerState;

    const outerState = waitForFrame(
      outer,
      (frame) => frame.type === 'place_state' && frame.payload.place?.id === 'technion',
    );
    sendClientEvent(outer, 'auth', { token: outerUser.token });
    sendClientEvent(outer, 'location', { lat: 32.7805, lng: 35.022 });
    await outerState;

    const parentForInner = waitForFrame(
      inner,
      (frame) => frame.type === 'knock_new'
        && frame.payload.knock.content === 'Hello, campus.',
    );
    const parentForOuter = waitForFrame(
      outer,
      (frame) => frame.type === 'knock_new'
        && frame.payload.knock.content === 'Hello, campus.',
    );
    sendClientEvent(inner, 'knock_send', {
      targetPlaceId: 'technion',
      type: 'text',
      content: '  Hello, campus.  ',
    });
    const [innerParentFrame, outerParentFrame] = await Promise.all([
      parentForInner,
      parentForOuter,
    ]);
    assert.equal(innerParentFrame.payload.knock.placeName, 'Technion');
    assert.equal(outerParentFrame.payload.knock.nickname, 'inner_knock');

    let outerReceivedInner = false;
    function observeOuter(data) {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'knock_new' && frame.payload.knock.content === 'Faculty only.') {
        outerReceivedInner = true;
      }
    }
    outer.on('message', observeOuter);
    const innerOnly = waitForFrame(
      inner,
      (frame) => frame.type === 'knock_new'
        && frame.payload.knock.content === 'Faculty only.',
    );
    sendClientEvent(inner, 'knock_send', {
      targetPlaceId: 'faculty-data-decision-sciences',
      type: 'text',
      content: 'Faculty only.',
    });
    await innerOnly;
    await new Promise((resolve) => setTimeout(resolve, 40));
    outer.off('message', observeOuter);
    assert.equal(outerReceivedInner, false);

    const beforeInvalid = app.db.prepare('SELECT COUNT(*) AS count FROM KNOCKS').get().count;
    sendClientEvent(inner, 'knock_send', {
      targetPlaceId: 'somewhere-else',
      type: 'text',
      content: 'Do not store this.',
    });
    sendClientEvent(inner, 'knock_send', {
      targetPlaceId: 'faculty-data-decision-sciences',
      type: 'video',
      mediaId: 'no-video-in-demo',
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(
      app.db.prepare('SELECT COUNT(*) AS count FROM KNOCKS').get().count,
      beforeInvalid,
    );

    app.db.prepare(
      `INSERT INTO MEDIA (
         ID, HASH, TYPE, DOMINANT_COLOR, THUMB_URL, MEDIUM_URL, ORIGINAL_URL
       ) VALUES (?, ?, 'image', ?, ?, ?, ?)`,
    ).run(
      'image-1',
      'image-hash-1',
      '#6f766b',
      '/media/image-1-thumb.webp',
      '/media/image-1-medium.webp',
      '/media/image-1-original.webp',
    );
    const imageFramePromise = waitForFrame(
      inner,
      (frame) => frame.type === 'knock_new' && frame.payload.knock.mediaId === 'image-1',
    );
    sendClientEvent(inner, 'knock_send', {
      targetPlaceId: 'faculty-data-decision-sciences',
      type: 'image',
      mediaId: 'image-1',
      content: 'Light on the stone',
    });
    const imageFrame = await imageFramePromise;
    assert.equal(imageFrame.payload.knock.mediumUrl, '/media/image-1-medium.webp');
    assert.equal(imageFrame.payload.knock.content, 'Light on the stone');

    app.db.prepare(
      `INSERT INTO KNOCKS (
         ID, PLACE_ID, PHONE_NUMBER, TYPE, CONTENT, CREATED_AT
       ) VALUES (?, ?, ?, 'text', ?, ?)`,
    ).run(
      'expired-knock',
      'faculty-data-decision-sciences',
      innerPhone,
      'Already faded.',
      new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString(),
    );

    const restored = await openSocket(url);
    sockets.push(restored);
    const restoredStatePromise = waitForFrame(restored, (frame) => frame.type === 'place_state');
    sendClientEvent(restored, 'auth', { token: innerUser.token });
    const restoredState = await restoredStatePromise;
    assert.deepEqual(
      restoredState.payload.knocks.map((knock) => knock.content),
      ['Hello, campus.', 'Faculty only.', 'Light on the stone'],
    );
  } finally {
    for (const socket of sockets) await closeSocket(socket).catch(() => {});
    await app.close();
    context.cleanup();
  }
});
