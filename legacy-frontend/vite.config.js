import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const clientRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(clientRoot, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const certPath = process.env.DEV_TLS_CERT_PATH || env.DEV_TLS_CERT_PATH;
  const keyPath = process.env.DEV_TLS_KEY_PATH || env.DEV_TLS_KEY_PATH;
  const apiTarget = process.env.DEV_API_TARGET || env.DEV_API_TARGET || 'http://127.0.0.1:3000';

  if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error('DEV_TLS_CERT_PATH and DEV_TLS_KEY_PATH must be set together');
  }

  return {
    root: clientRoot,
    envDir: projectRoot,
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 3443,
      strictPort: true,
      https: certPath && keyPath
        ? {
            cert: fs.readFileSync(path.resolve(projectRoot, certPath)),
            key: fs.readFileSync(path.resolve(projectRoot, keyPath)),
          }
        : undefined,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: false,
        },
        '/ws': {
          target: apiTarget,
          changeOrigin: false,
          ws: true,
        },
        '/media': {
          target: apiTarget,
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
    },
    build: {
      outDir: path.join(clientRoot, 'dist'),
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
