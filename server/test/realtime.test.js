import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
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

test('WebSocket auth, ancestor presence, grace, visits, and Force relocation work end to end', async () => {
  const context = makeTestContext();
  const app = buildApp({ config: context.config, logger: false });
  const sockets = [];

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const alice = await register(app, 'alice_1');
    const bob = await register(app, 'bob_2');
    const url = socketUrl(app);

    const aliceSocket = await openSocket(url);
    sockets.push(aliceSocket);
    const aliceStatePromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'place_state',
    );
    sendClientEvent(aliceSocket, 'auth', { token: alice.token });
    const aliceState = await aliceStatePromise;
    assert.equal(aliceState.payload.place.id, 'faculty-data-decision-sciences');
    assert.equal(aliceState.payload.presenceCount, 1);
    assert.deepEqual(
      aliceState.payload.layerStack.map((place) => place.id),
      ['faculty-data-decision-sciences', 'technion'],
    );
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 1);
    assert.equal(app.realtime.presence.getCount('technion'), 1);

    // Force-location bypasses Turf even for impossible coordinates.
    sendClientEvent(aliceSocket, 'location', { lat: 0, lng: 0 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      app.realtime.presence.getUserState(
        app.db.prepare('SELECT PHONE_NUMBER FROM USERS WHERE NICKNAME = ?').get('alice_1').PHONE_NUMBER,
      ).placeId,
      'faculty-data-decision-sciences',
    );

    const duplicateAliceSocket = await openSocket(url);
    sockets.push(duplicateAliceSocket);
    const duplicateStatePromise = waitForFrame(
      duplicateAliceSocket,
      (frame) => frame.type === 'place_state',
    );
    sendClientEvent(duplicateAliceSocket, 'auth', { token: alice.token });
    const duplicateState = await duplicateStatePromise;
    assert.equal(duplicateState.payload.presenceCount, 1);

    const bobSocket = await openSocket(url);
    sockets.push(bobSocket);
    const countTwoPromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'presence_update'
        && frame.payload.placeId === 'faculty-data-decision-sciences'
        && frame.payload.count === 2,
    );
    const bobStatePromise = waitForFrame(
      bobSocket,
      (frame) => frame.type === 'place_state',
    );
    sendClientEvent(bobSocket, 'auth', { token: bob.token });
    const bobState = await bobStatePromise;
    assert.equal(bobState.payload.presenceCount, 2);
    await countTwoPromise;
    assert.equal(app.realtime.presence.getCount('technion'), 2);

    const bobPhone = app.db.prepare(
      'SELECT PHONE_NUMBER FROM USERS WHERE NICKNAME = ?',
    ).get('bob_2').PHONE_NUMBER;

    sendClientEvent(bobSocket, 'away');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 2);
    sendClientEvent(bobSocket, 'back');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 2);
    assert.equal(
      app.db.prepare('SELECT COUNT(*) AS count FROM USER_VISITS WHERE PHONE_NUMBER = ?').get(bobPhone).count,
      1,
    );

    const graceStarted = Date.now();
    sendClientEvent(bobSocket, 'away');
    sendClientEvent(bobSocket, 'away');
    await waitUntil(
      () => app.realtime.presence.getCount('faculty-data-decision-sciences') === 1,
      400,
    );
    assert.ok(Date.now() - graceStarted >= 70, 'presence decremented before the grace window');
    const firstVisit = app.db.prepare(
      'SELECT LEFT_AT FROM USER_VISITS WHERE PHONE_NUMBER = ?',
    ).get(bobPhone);
    assert.ok(firstVisit.LEFT_AT);

    sendClientEvent(bobSocket, 'back');
    await waitUntil(
      () => app.realtime.presence.getCount('faculty-data-decision-sciences') === 2,
    );
    const visitsAfterReturn = app.db.prepare(
      `SELECT COUNT(*) AS total,
         SUM(CASE WHEN LEFT_AT IS NULL THEN 1 ELSE 0 END) AS open
       FROM USER_VISITS
       WHERE PHONE_NUMBER = ?`,
    ).get(bobPhone);
    assert.deepEqual(visitsAfterReturn, { total: 2, open: 1 });
    const rank = app.db.prepare(
      `SELECT RANK, VISIT_COUNT
       FROM USER_PLACE_RANK
       WHERE PHONE_NUMBER = ? AND PLACE_ID = 'faculty-data-decision-sciences'`,
    ).get(bobPhone);
    assert.deepEqual(rank, { RANK: 'belong', VISIT_COUNT: 2 });

    await closeSocket(duplicateAliceSocket);
    sockets.splice(sockets.indexOf(duplicateAliceSocket), 1);
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 2);

    const relocatedPromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'relocated' && frame.payload.place?.id === 'technion',
    );
    const relocatedStatePromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'place_state' && frame.payload.place?.id === 'technion',
    );
    const relocateResponse = await app.inject({
      method: 'PUT',
      url: '/api/admin/force-location',
      headers: { 'x-admin-password': context.config.adminPassword },
      payload: { forcePlaceId: 'technion' },
    });
    assert.equal(relocateResponse.statusCode, 200);
    assert.equal(relocateResponse.json().changed, true);
    await relocatedPromise;
    await relocatedStatePromise;
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 0);
    assert.equal(app.realtime.presence.getCount('technion'), 2);

    const idempotent = await app.inject({
      method: 'PUT',
      url: '/api/admin/force-location',
      headers: { 'x-admin-password': context.config.adminPassword },
      payload: { forcePlaceId: 'technion' },
    });
    assert.equal(idempotent.json().changed, false);

    const forceOffPromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'relocated' && frame.payload.place === null,
    );
    const forceOff = await app.inject({
      method: 'PUT',
      url: '/api/admin/force-location',
      headers: { 'x-admin-password': context.config.adminPassword },
      payload: { forcePlaceId: null },
    });
    assert.equal(forceOff.statusCode, 200);
    await forceOffPromise;
    assert.equal(app.realtime.presence.getCount('technion'), 0);

    const realLocationPromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'place_state'
        && frame.payload.place?.id === 'faculty-data-decision-sciences',
    );
    sendClientEvent(aliceSocket, 'location', { lat: 32.77421, lng: 35.02361 });
    const realLocation = await realLocationPromise;
    assert.equal(realLocation.payload.presenceCount, 1);

    const outerLocationPromise = waitForFrame(
      bobSocket,
      (frame) => frame.type === 'place_state' && frame.payload.place?.id === 'technion',
    );
    sendClientEvent(bobSocket, 'location', { lat: 32.7805, lng: 35.022 });
    await outerLocationPromise;
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 1);
    assert.equal(app.realtime.presence.getCount('technion'), 2);

    const parentKnockForAlice = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'knock_new' && frame.payload.knock.id === 'parent-probe',
    );
    const parentKnockForBob = waitForFrame(
      bobSocket,
      (frame) => frame.type === 'knock_new' && frame.payload.knock.id === 'parent-probe',
    );
    app.realtime.broadcastToPlace('technion', 'knock_new', {
      knock: { id: 'parent-probe' },
    });
    await Promise.all([parentKnockForAlice, parentKnockForBob]);

    let bobReceivedInnerKnock = false;
    function inspectInnerKnock(data) {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'knock_new' && frame.payload.knock.id === 'inner-probe') {
        bobReceivedInnerKnock = true;
      }
    }
    bobSocket.on('message', inspectInnerKnock);
    const innerKnockForAlice = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'knock_new' && frame.payload.knock.id === 'inner-probe',
    );
    app.realtime.broadcastToPlace('faculty-data-decision-sciences', 'knock_new', {
      knock: { id: 'inner-probe' },
    });
    await innerKnockForAlice;
    await new Promise((resolve) => setTimeout(resolve, 40));
    bobSocket.off('message', inspectInnerKnock);
    assert.equal(bobReceivedInnerKnock, false);

    const aliceForcedPromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'relocated'
        && frame.payload.place?.id === 'faculty-data-decision-sciences',
    );
    const bobForcedPromise = waitForFrame(
      bobSocket,
      (frame) => frame.type === 'relocated'
        && frame.payload.place?.id === 'faculty-data-decision-sciences',
    );
    const forceFacultyAgain = await app.inject({
      method: 'PUT',
      url: '/api/admin/force-location',
      headers: { 'x-admin-password': context.config.adminPassword },
      payload: { forcePlaceId: 'faculty-data-decision-sciences' },
    });
    assert.equal(forceFacultyAgain.statusCode, 200);
    await Promise.all([aliceForcedPromise, bobForcedPromise]);
    const aliceRestoredPromise = waitForFrame(
      aliceSocket,
      (frame) => frame.type === 'relocated'
        && frame.payload.place?.id === 'faculty-data-decision-sciences',
    );
    const bobRestoredPromise = waitForFrame(
      bobSocket,
      (frame) => frame.type === 'relocated' && frame.payload.place?.id === 'technion',
    );
    const restoreCachedLocations = await app.inject({
      method: 'PUT',
      url: '/api/admin/force-location',
      headers: { 'x-admin-password': context.config.adminPassword },
      payload: { forcePlaceId: null },
    });
    assert.equal(restoreCachedLocations.statusCode, 200);
    await Promise.all([aliceRestoredPromise, bobRestoredPromise]);
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 1);
    assert.equal(app.realtime.presence.getCount('technion'), 2);

    const unauthenticated = await openSocket(url);
    sockets.push(unauthenticated);
    const unauthenticatedClosed = once(unauthenticated, 'close');
    sendClientEvent(unauthenticated, 'away');
    const [closeCode] = await unauthenticatedClosed;
    assert.equal(closeCode, 1008);
    sockets.splice(sockets.indexOf(unauthenticated), 1);

    const malformedThenValid = await openSocket(url);
    sockets.push(malformedThenValid);
    malformedThenValid.send('{"unexpected":true}');
    const recoveredStatePromise = waitForFrame(
      malformedThenValid,
      (frame) => frame.type === 'place_state',
    );
    sendClientEvent(malformedThenValid, 'auth', { token: alice.token });
    sendClientEvent(malformedThenValid, 'location', { lat: 32.77421, lng: 35.02361 });
    const recoveredState = await recoveredStatePromise;
    assert.equal(recoveredState.payload.place.id, 'faculty-data-decision-sciences');
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 1);
  } finally {
    for (const socket of sockets) {
      await closeSocket(socket).catch(() => {});
    }
    await app.close();
    context.cleanup();
  }
});

test('one session has one canonical place and hidden location frames do not cancel grace', async () => {
  const context = makeTestContext({ forcePlaceId: null });
  const app = buildApp({ config: context.config, logger: false });
  const sockets = [];

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const user = await register(app, 'canonical_1');
    const url = socketUrl(app);
    const first = await openSocket(url);
    sockets.push(first);
    sendClientEvent(first, 'auth', { token: user.token });
    const firstFaculty = waitForFrame(
      first,
      (frame) => frame.type === 'place_state'
        && frame.payload.place?.id === 'faculty-data-decision-sciences',
    );
    sendClientEvent(first, 'location', { lat: 32.77421, lng: 35.02361 });
    await firstFaculty;

    const second = await openSocket(url);
    sockets.push(second);
    const secondFaculty = waitForFrame(second, (frame) => frame.type === 'place_state');
    sendClientEvent(second, 'auth', { token: user.token });
    await secondFaculty;
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 1);

    const firstMoved = waitForFrame(
      first,
      (frame) => frame.type === 'place_state' && frame.payload.place?.id === 'technion',
    );
    const secondMoved = waitForFrame(
      second,
      (frame) => frame.type === 'place_state' && frame.payload.place?.id === 'technion',
    );
    sendClientEvent(second, 'location', { lat: 32.7805, lng: 35.022 });
    await Promise.all([firstMoved, secondMoved]);
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 0);
    assert.equal(app.realtime.presence.getCount('technion'), 1);

    sendClientEvent(first, 'location', { lat: 0, lng: 0 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const phoneNumber = app.db.prepare(
      'SELECT PHONE_NUMBER FROM USERS WHERE NICKNAME = ?',
    ).get('canonical_1').PHONE_NUMBER;
    assert.equal(app.realtime.presence.getUserState(phoneNumber).placeId, 'technion');
    assert.equal(app.realtime.presence.getCount('technion'), 1);

    await closeSocket(second);
    sockets.splice(sockets.indexOf(second), 1);
    const graceStarted = Date.now();
    sendClientEvent(first, 'away');
    await new Promise((resolve) => setTimeout(resolve, 20));
    sendClientEvent(first, 'location', { lat: 32.7805, lng: 35.022 });
    await waitUntil(() => app.realtime.presence.getCount('technion') === 0, 300);
    assert.ok(Date.now() - graceStarted >= 70);
    assert.ok(app.db.prepare('SELECT LEFT_AT FROM USER_VISITS').get().LEFT_AT);
  } finally {
    for (const socket of sockets) await closeSocket(socket).catch(() => {});
    await app.close();
    context.cleanup();
  }
});

test('a process restart reuses the open visit when the session reconnects', async () => {
  const context = makeTestContext();
  let firstApp = buildApp({ config: context.config, logger: false });
  let secondApp;
  let socket;

  try {
    await firstApp.listen({ host: '127.0.0.1', port: 0 });
    const user = await register(firstApp, 'restart_1');
    socket = await openSocket(socketUrl(firstApp));
    const firstState = waitForFrame(socket, (frame) => frame.type === 'place_state');
    sendClientEvent(socket, 'auth', { token: user.token });
    await firstState;
    assert.equal(firstApp.db.prepare('SELECT COUNT(*) AS count FROM USER_VISITS').get().count, 1);

    await firstApp.close();
    firstApp = null;
    socket = null;

    secondApp = buildApp({ config: context.config, logger: false });
    await secondApp.listen({ host: '127.0.0.1', port: 0 });
    socket = await openSocket(socketUrl(secondApp));
    const restoredState = waitForFrame(socket, (frame) => frame.type === 'place_state');
    sendClientEvent(socket, 'auth', { token: user.token });
    await restoredState;

    assert.equal(secondApp.db.prepare('SELECT COUNT(*) AS count FROM USER_VISITS').get().count, 1);
    const rank = secondApp.db.prepare(
      `SELECT RANK, VISIT_COUNT FROM USER_PLACE_RANK WHERE PHONE_NUMBER = (
         SELECT PHONE_NUMBER FROM USERS WHERE NICKNAME = 'restart_1'
       )`,
    ).get();
    assert.deepEqual(rank, { RANK: 'belong', VISIT_COUNT: 1 });
  } finally {
    if (socket) await closeSocket(socket).catch(() => {});
    if (secondApp) await secondApp.close();
    if (firstApp) await firstApp.close();
    context.cleanup();
  }
});

test('unauthenticated sockets are closed after the authentication deadline', async () => {
  const context = makeTestContext({ wsAuthTimeoutMs: 30 });
  const app = buildApp({ config: context.config, logger: false });
  let socket;
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    socket = await openSocket(socketUrl(app));
    const [code] = await once(socket, 'close');
    assert.equal(code, 1008);
  } finally {
    if (socket) await closeSocket(socket).catch(() => {});
    await app.close();
    context.cleanup();
  }
});

test('two missed native pongs terminate a socket and then enter presence grace', async () => {
  const context = makeTestContext({
    heartbeatIntervalMs: 20,
    heartbeatMissLimit: 2,
    presenceGraceMs: 60,
    presenceBroadcastMs: 10,
  });
  const app = buildApp({ config: context.config, logger: false });
  let socket;

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const user = await register(app, 'no_pong');
    socket = await openSocket(socketUrl(app), { autoPong: false });
    const statePromise = waitForFrame(socket, (frame) => frame.type === 'place_state');
    sendClientEvent(socket, 'auth', { token: user.token });
    await statePromise;
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 1);

    const closedPromise = once(socket, 'close');
    const [code] = await closedPromise;
    assert.equal(code, 1006);
    assert.equal(socket.readyState, WebSocket.CLOSED);
    assert.equal(app.realtime.presence.getCount('faculty-data-decision-sciences'), 1);

    await waitUntil(
      () => app.realtime.presence.getCount('faculty-data-decision-sciences') === 0,
      300,
    );
    const visit = app.db.prepare('SELECT LEFT_AT FROM USER_VISITS').get();
    assert.ok(visit.LEFT_AT);
  } finally {
    if (socket) await closeSocket(socket).catch(() => {});
    await app.close();
    context.cleanup();
  }
});
