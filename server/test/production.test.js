import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { makeTestContext } from '../test-support/helpers.js';

test('production serves the client, admin entry, immutable assets, and public media', async () => {
  const context = makeTestContext({
    nodeEnv: 'production',
    enableStage1Harness: false,
  });
  const clientDistPath = path.join(context.directory, 'client-dist');
  const assetsPath = path.join(clientDistPath, 'assets');
  const mediaFilename = `${'a'.repeat(64)}-thumb.webp`;
  fs.mkdirSync(assetsPath, { recursive: true });
  fs.mkdirSync(context.config.mediaPath, { recursive: true });
  fs.writeFileSync(path.join(clientDistPath, 'index.html'), '<!doctype html><title>place-app</title>');
  fs.writeFileSync(path.join(assetsPath, 'app-abc123.js'), 'console.log("place-app");');
  fs.writeFileSync(path.join(context.config.mediaPath, mediaFilename), Buffer.from('webp-test'));

  const app = buildApp({
    config: { ...context.config, clientDistPath },
    logger: false,
  });

  try {
    const home = await app.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /place-app/);
    assert.equal(home.headers['cache-control'], 'no-cache');

    const admin = await app.inject({ method: 'GET', url: '/admin' });
    assert.equal(admin.statusCode, 200);
    assert.match(admin.body, /place-app/);
    assert.equal(admin.headers['cache-control'], 'no-cache');

    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    assert.equal(asset.statusCode, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');

    const media = await app.inject({ method: 'GET', url: `/media/${mediaFilename}` });
    assert.equal(media.statusCode, 200);
    assert.equal(media.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(media.headers['x-content-type-options'], 'nosniff');

    const privateMedia = await app.inject({ method: 'GET', url: '/media/not-public.tmp' });
    assert.equal(privateMedia.statusCode, 404);

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, 'ok');
  } finally {
    await app.close();
    context.cleanup();
  }
});
