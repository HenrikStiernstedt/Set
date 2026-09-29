import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLoopback } from './security.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, '..', 'dist');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3001', 10);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  })[extension] ?? 'application/octet-stream';
}

function serveBuiltApp(req, res, pathname) {
  if (req.method !== 'GET' || !fs.existsSync(path.join(distDir, 'index.html'))) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const requestedPath = path.resolve(distDir, relativePath);
  if (requestedPath !== distDir && !requestedPath.startsWith(`${distDir}${path.sep}`)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const filePath = fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()
    ? requestedPath
    : path.join(distDir, 'index.html');
  res.writeHead(200, { 'content-type': contentType(filePath), 'x-content-type-options': 'nosniff' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url ?? '/', `http://${host}:${port}`).pathname;
  } catch {
    sendJson(res, 400, { error: 'Invalid request URL' });
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', mode: 'local', service: 'set-gallery' });
    return;
  }

  if (pathname === '/api/local/health' && req.method === 'GET') {
    requireLoopback(req, res, () => sendJson(res, 200, { status: 'ok', access: 'loopback-only' }));
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'API route not found' });
    return;
  }

  serveBuiltApp(req, res, pathname);
});

server.listen(port, host, () => {
  console.log(`Set Gallery server listening at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
