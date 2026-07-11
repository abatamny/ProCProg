import 'dotenv/config';
import fs from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig, loadTlsOptions } from './config.js';

const config = loadConfig();
fs.mkdirSync(config.mediaPath, { recursive: true });

const app = buildApp({
  config,
  tlsOptions: loadTlsOptions(config),
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down');
  await app.close();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
