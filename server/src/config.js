import fs from 'node:fs';
import path from 'node:path';

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function integerAtLeast(value, fallback, name, minimum) {
  const parsed = positiveInteger(value, fallback, name);
  if (parsed < minimum) throw new Error(`${name} must be at least ${minimum}`);
  return parsed;
}

function optionalPath(value, cwd) {
  return value ? path.resolve(cwd, value) : null;
}

function optInBoolean(value) {
  return ['1', 'true'].includes(String(value ?? '').toLowerCase());
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const nodeEnv = env.NODE_ENV || 'production';
  const adminPassword = env.ADMIN_PASSWORD || '';
  const forcePlaceId = env.FORCE_PLACE_ID === undefined
    ? 'faculty-data-decision-sciences'
    : env.FORCE_PLACE_ID.trim() || null;
  if (!adminPassword) throw new Error('ADMIN_PASSWORD is required');
  if (nodeEnv === 'production' && adminPassword === 'replace-with-a-long-password') {
    throw new Error('ADMIN_PASSWORD must be changed from the example value');
  }

  return {
    nodeEnv,
    host: env.HOST || '0.0.0.0',
    port: positiveInteger(env.PORT, 3000, 'PORT'),
    logLevel: env.LOG_LEVEL || 'info',
    databasePath: path.resolve(cwd, env.DATABASE_PATH || './data/place-app.sqlite'),
    mediaPath: path.resolve(cwd, env.MEDIA_PATH || './media'),
    clientDistPath: optionalPath(env.CLIENT_DIST_PATH, cwd),
    adminPassword,
    forcePlaceId,
    tlsKeyPath: optionalPath(env.TLS_KEY_PATH, cwd),
    tlsCertPath: optionalPath(env.TLS_CERT_PATH, cwd),
    presenceGraceMs: positiveInteger(env.PRESENCE_GRACE_MS, 60_000, 'PRESENCE_GRACE_MS'),
    presenceBroadcastMs: integerAtLeast(
      env.PRESENCE_BROADCAST_MS,
      1_000,
      'PRESENCE_BROADCAST_MS',
      nodeEnv === 'test' ? 1 : 1_000,
    ),
    heartbeatIntervalMs: positiveInteger(
      env.HEARTBEAT_INTERVAL_MS,
      30_000,
      'HEARTBEAT_INTERVAL_MS',
    ),
    heartbeatMissLimit: positiveInteger(
      env.HEARTBEAT_MISS_LIMIT,
      2,
      'HEARTBEAT_MISS_LIMIT',
    ),
    wsAuthTimeoutMs: positiveInteger(
      env.WS_AUTH_TIMEOUT_MS,
      10_000,
      'WS_AUTH_TIMEOUT_MS',
    ),
    enableStage1Harness: optInBoolean(env.ENABLE_STAGE1_HARNESS),
  };
}

export function loadTlsOptions(config) {
  const hasKey = Boolean(config.tlsKeyPath);
  const hasCert = Boolean(config.tlsCertPath);

  if (hasKey !== hasCert) {
    throw new Error('TLS_KEY_PATH and TLS_CERT_PATH must be set together');
  }

  if (!hasKey) return null;

  return {
    key: fs.readFileSync(config.tlsKeyPath),
    cert: fs.readFileSync(config.tlsCertPath),
  };
}
