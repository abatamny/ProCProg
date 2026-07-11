import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';

export function makeTestContext(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'place-app-stage1-'));
  const config = {
    ...loadConfig({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3000',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: './place-app.sqlite',
      MEDIA_PATH: './media',
      ADMIN_PASSWORD: 'stage1-test-password',
      FORCE_PLACE_ID: 'faculty-data-decision-sciences',
      PRESENCE_GRACE_MS: '80',
      PRESENCE_BROADCAST_MS: '20',
      HEARTBEAT_INTERVAL_MS: '5000',
      HEARTBEAT_MISS_LIMIT: '2',
      WS_AUTH_TIMEOUT_MS: '500',
      ENABLE_STAGE1_HARNESS: '0',
    }, directory),
    nodeEnv: 'development',
    enableStage1Harness: true,
    ...overrides,
  };

  return {
    directory,
    config,
    cleanup() {
      fs.rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    },
  };
}

export async function register(app, nickname) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { nickname },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Registration failed: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

export async function openSocket(url, options) {
  const socket = new WebSocket(url, options);
  await once(socket, 'open');
  return socket;
}

export function waitForFrame(socket, predicate, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timeoutError = new Error('Timed out waiting for WebSocket frame');
    const timeout = setTimeout(() => {
      cleanup();
      reject(timeoutError);
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      socket.off('error', onError);
    }

    function onMessage(data, isBinary) {
      if (isBinary) return;
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!predicate(frame)) return;
      cleanup();
      resolve(frame);
    }

    function onClose(code) {
      cleanup();
      reject(new Error(`Socket closed before frame arrived (${code})`));
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on('message', onMessage);
    socket.on('close', onClose);
    socket.on('error', onError);
  });
}

export function sendClientEvent(socket, type, payload = {}) {
  socket.send(JSON.stringify({ type, payload }));
}

export async function waitUntil(predicate, timeoutMs = 1_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition');
}

export async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = once(socket, 'close');
  socket.close(1000, 'test complete');
  await closed;
}
