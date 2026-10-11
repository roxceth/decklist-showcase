// Serves the static site and emulates the Apps Script API at POST /api using the in-memory mock.
// Used by the Playwright tests. Not part of the deliverable runtime.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from './mock-gas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8'
};
const BLOCKED_DIRS = ['qa', 'apps-script', 'docs', 'node_modules'];

export async function startDevServer({ port = 0, latencyMs = 0 } = {}) {
  const gas = createGas({ now: Date.now() });
  gas.setupAll();
  const state = { latencyMs, apiCalls: [], failNext: null };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const reply = () => {
          if (state.failNext) {
            const f = state.failNext;
            state.failNext = null;
            if (f === 'drop') return req.socket.destroy();
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end(f);
          }
          let parsed = {};
          try { parsed = JSON.parse(raw); } catch (e) { /* mock answers bad_request */ }
          state.apiCalls.push(parsed.action);
          const out = gas.post(raw);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out));
        };
        state.latencyMs ? setTimeout(reply, state.latencyMs) : reply();
      });
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405);
      return res.end();
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      return res.end("window.DS_CONFIG = { API_URL: '/api', APP_NAME: 'CAPY BURST Deck Showcase', LOGO_URL: 'assets/logo.svg' };");
    }
    if (p === '/') p = '/index.html';
    const file = path.join(root, p);
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || BLOCKED_DIRS.includes(rel.split(path.sep)[0]) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, gas, state, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PW } = await import('./helpers.mjs');
  const s = await startDevServer({ port: Number(process.env.PORT) || 8080 });
  s.gas.run('addOrganizer', 'Hector D.', PW);
  console.log('Dev server:', s.base, ' organizer: "Hector D." password:', PW);
}
