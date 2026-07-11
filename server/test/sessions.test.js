import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeTestContext } from '../test-support/helpers.js';

test('registration, collision suggestions, returning sessions, admin auth, and harness work', async () => {
  const context = makeTestContext();
  const app = buildApp({ config: context.config, logger: false });

  try {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json().database, { journalMode: 'wal', foreignKeys: true });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { nickname: 'no spaces' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, 'invalid_nickname');

    const created = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { nickname: 'noamk' },
    });
    assert.equal(created.statusCode, 201);
    const registration = created.json();
    assert.match(registration.token, /^[0-9a-f-]{36}$/);
    assert.deepEqual(registration.user, { nickname: 'noamk' });
    assert.equal(Object.hasOwn(registration, 'phoneNumber'), false);

    const principal = app.db.prepare(
      'SELECT PHONE_NUMBER FROM USERS WHERE NICKNAME = ?',
    ).get('noamk');
    assert.match(principal.PHONE_NUMBER, /^demo:[0-9a-f-]{36}$/);

    const collision = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { nickname: 'NOAMK' },
    });
    assert.equal(collision.statusCode, 409);
    assert.equal(collision.json().error, 'nickname_taken');
    assert.equal(collision.json().suggestion, 'NOAMK_2');

    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { authorization: `Bearer ${registration.token}` },
    });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json(), { user: { nickname: 'noamk' } });

    const missingSession = await app.inject({ method: 'GET', url: '/api/session' });
    assert.equal(missingSession.statusCode, 401);

    const deniedAdmin = await app.inject({
      method: 'GET',
      url: '/api/admin/force-location',
      headers: { 'x-admin-password': 'wrong' },
    });
    assert.equal(deniedAdmin.statusCode, 401);

    const admin = await app.inject({
      method: 'GET',
      url: '/api/admin/force-location',
      headers: { 'x-admin-password': context.config.adminPassword },
    });
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.json().forcePlaceId, 'faculty-data-decision-sciences');

    const harness = await app.inject({ method: 'GET', url: '/stage1-test' });
    assert.equal(harness.statusCode, 200);
    assert.match(harness.headers['content-type'], /^text\/html/);
    assert.match(harness.body, /Secure context/);
    assert.match(harness.body, /new WebSocket\(url\)/);
  } finally {
    await app.close();
    context.cleanup();
  }
});

test('the Stage 1 harness stays unavailable in production even if its flag is set', async () => {
  const context = makeTestContext({ nodeEnv: 'production', enableStage1Harness: true });
  const app = buildApp({ config: context.config, logger: false });
  try {
    const response = await app.inject({ method: 'GET', url: '/stage1-test' });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
    context.cleanup();
  }
});

test('configuration fails fast without admin access and enforces one-second broadcasts', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development' }),
    /ADMIN_PASSWORD is required/,
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'replace-with-a-long-password',
    }),
    /ADMIN_PASSWORD must be changed from the example value/,
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'development',
      ADMIN_PASSWORD: 'configured',
      PRESENCE_BROADCAST_MS: '999',
    }),
    /PRESENCE_BROADCAST_MS must be at least 1000/,
  );
});
