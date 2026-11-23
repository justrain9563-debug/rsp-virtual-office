import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express from 'express';
import { api } from './api';
import { initAuth } from './auth';
import { initDb } from './db';
import { env } from './env';
import { initRealtime, shutdownSave } from './realtime';
import { loadState } from './state';

async function main() {
  await initDb();
  await initAuth();
  await loadState();

  const app = express();
  app.set('trust proxy', 1); // Render / reverse proxies terminate TLS in front of us
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
    next();
  });
  app.get('/healthz', (_req, res) => res.send('ok'));
  app.use('/api', api);

  const dist = path.join(env.root, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('Client not built. Run <code>npm run dev</code> (Vite on :5173) or <code>npm run build</code>.'));
  }

  let server: http.Server;
  if (env.https) {
    const selfsigned = (await import('selfsigned')).default;
    const certDir = path.join(env.dataDir, 'cert');
    fs.mkdirSync(certDir, { recursive: true });
    const keyFile = path.join(certDir, 'key.pem'), certFile = path.join(certDir, 'cert.pem');
    if (!fs.existsSync(keyFile)) {
      const pems = selfsigned.generate([{ name: 'commonName', value: 'rsp-virtual-office.local' }], { days: 365, keySize: 2048 });
      fs.writeFileSync(keyFile, pems.private);
      fs.writeFileSync(certFile, pems.cert);
    }
    server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, app) as unknown as http.Server;
  } else server = http.createServer(app);

  initRealtime(server);
  server.listen(env.port, () => console.log(`[rsp] RSP Virtual Office on ${env.https ? 'https' : 'http'}://localhost:${env.port}`));

  const stop = async () => {
    console.log('[rsp] shutting down');
    await shutdownSave();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
