import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireLoopback } from './security.js';
import { createGalleryCatalog } from './gallery-service.js';
import { analyzeDeckReadiness, isSafeGalleryId, rankValueAlternatives } from './gallery-validation.js';
import { createSoloGame, dealThree, resolveGameAsset, serializeGame, serializeReadiness, submitSet } from './game-engine.js';
import { applyGalleryFilenameTags, previewGalleryFilenameTags, saveFilenameProfile } from './filename-tagging.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, '..', 'dist');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3001', 10);

function configuredGalleryRoots() {
  const appDir = path.resolve(currentDir, '..');
  const configPath = [path.join(appDir, 'config.json'), path.join(appDir, 'config.example.json')]
    .find((candidate) => fs.existsSync(candidate));
  if (!configPath) return [];
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Array.isArray(config.galleryRoots)
      ? config.galleryRoots.filter((root) => typeof root === 'string' && root.trim()).map((root) => path.resolve(appDir, root))
      : [];
  } catch {
    return [];
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, limitBytes = 131072) {
  return new Promise((resolve, reject) => {
    let body = '';
    let oversized = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (oversized) return;
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
        oversized = true;
        body = '';
      }
    });
    req.on('end', () => {
      if (oversized) {
        const error = new Error('Request body is too large.');
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('Request body must be valid JSON.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function serveGameImage(res, game, card) {
  try {
    const canonicalPath = await fs.promises.realpath(card.canonicalPath);
    if (!game.allowedRoots.some((root) => isWithinRoot(root, canonicalPath))
      || !(await fs.promises.stat(canonicalPath)).isFile()) {
      sendJson(res, 404, { error: 'Image not found.' });
      return;
    }
    res.writeHead(200, {
      'content-type': contentType(canonicalPath),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(canonicalPath).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'Image not found.' });
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  })[extension] ?? 'application/octet-stream';
}

function serveBuiltApp(req, res, pathname, distDirectory = distDir) {
  if (req.method !== 'GET' || !fs.existsSync(path.join(distDirectory, 'index.html'))) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  let relativePath;
  try {
    relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    sendJson(res, 400, { error: 'Invalid asset path.' });
    return;
  }
  const requestedPath = path.resolve(distDirectory, relativePath);
  if (requestedPath !== distDirectory && !requestedPath.startsWith(`${distDirectory}${path.sep}`)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const filePath = fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()
    ? requestedPath
    : path.join(distDirectory, 'index.html');
  res.writeHead(200, { 'content-type': contentType(filePath), 'x-content-type-options': 'nosniff' });
  fs.createReadStream(filePath).pipe(res);
}

export function createSetGalleryServer(options = {}) {
  const catalog = createGalleryCatalog(options.galleryRoots ?? configuredGalleryRoots());
  const staticDirectory = options.staticDirectory ?? distDir;
  const games = new Map();
  return http.createServer((req, res) => {
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

    if (pathname === '/api/galleries/available' && req.method === 'GET') {
      void catalog.rescan().then(() => catalog.getAvailable())
        .then((galleries) => sendJson(res, 200, { galleries }))
        .catch(() => sendJson(res, 500, { error: 'Gallery scan failed.' }));
      return;
    }

    const galleryReadinessMatch = /^\/api\/galleries\/([^/]+)\/readiness$/.exec(pathname);
    if (galleryReadinessMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        void readJsonBody(req).then(async (body) => {
          const galleryId = decodeURIComponent(galleryReadinessMatch[1]);
          const entry = await catalog.getEntry(galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery not found.' });
          const readiness = analyzeDeckReadiness(entry.manifest, body.selection, entry.usableCards, { random: () => 0 });
          const recommendations = readiness.ready || readiness.errors.length
            ? { recommendations: [], evaluatedCount: 0, truncated: false, errors: [] }
            : rankValueAlternatives(entry.manifest, body.selection?.categoryIds, body.selection?.valuesByCategory, entry.usableCards);
          sendJson(res, 200, { readiness: serializeReadiness(readiness, entry.manifest), recommendations });
        }).catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'Invalid request body.' }));
      });
      return;
    }

    if (pathname === '/api/games' && req.method === 'POST') {
      requireLoopback(req, res, () => {
        void readJsonBody(req).then(async (body) => {
          if (!isSafeGalleryId(body.galleryId)) return sendJson(res, 400, { error: 'Invalid gallery ID.' });
          const entry = await catalog.getEntry(body.galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery not found.' });
          const selection = { ...body.selection, acknowledgeVariation: body.acknowledgeVariation === true };
          const result = createSoloGame({
            manifest: entry.manifest,
            usableCards: entry.usableCards,
            allowedRoots: await catalog.getRoots(),
            selection,
            startingBoardSize: body.startingBoardSize,
            targetSets: body.targetSets ?? 5,
            random: () => randomInt(0, 0x100000000) / 0x100000000,
          });
          if (!result.ok) return sendJson(res, result.status, { error: result.error, code: result.code, readiness: result.readiness });
          games.set(result.game.id, result.game);
          sendJson(res, 201, { game: serializeGame(result.game) });
        }).catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'Invalid request body.' }));
      });
      return;
    }

    const gameMatch = /^\/api\/games\/([0-9a-f-]+)\/match$/.exec(pathname);
    if (gameMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        void readJsonBody(req).then((body) => {
          const game = games.get(gameMatch[1]);
          if (!game) return sendJson(res, 404, { error: 'Game not found.' });
          const result = submitSet(game, body.cardIds);
          if (!result.ok) return sendJson(res, result.status, { error: result.error });
          sendJson(res, 200, { valid: result.valid, matched: result.matched ?? [], game: result.game });
        }).catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'Invalid request body.' }));
      });
      return;
    }

    const gameDealMatch = /^\/api\/games\/([0-9a-f-]+)\/deal$/.exec(pathname);
    if (gameDealMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        const game = games.get(gameDealMatch[1]);
        if (!game) return sendJson(res, 404, { error: 'Game not found.' });
        const result = dealThree(game);
        if (!result.ok) return sendJson(res, result.status, { error: result.error });
        sendJson(res, 200, { dealt: result.dealt, game: result.game });
      });
      return;
    }

    const gameGetMatch = /^\/api\/games\/([0-9a-f-]+)$/.exec(pathname);
    if (gameGetMatch && req.method === 'GET') {
      requireLoopback(req, res, () => {
        const game = games.get(gameGetMatch[1]);
        if (!game) return sendJson(res, 404, { error: 'Game not found.' });
        sendJson(res, 200, { game: serializeGame(game) });
      });
      return;
    }

    const assetMatch = /^\/api\/games\/([0-9a-f-]+)\/assets\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (assetMatch && req.method === 'GET') {
      const game = games.get(assetMatch[1]);
      const card = game && resolveGameAsset(game, assetMatch[2]);
      if (!card) return sendJson(res, 404, { error: 'Image not found.' });
      void serveGameImage(res, game, card);
      return;
    }

    const gameRestartMatch = /^\/api\/games\/([0-9a-f-]+)\/restart$/.exec(pathname);
    if (gameRestartMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        const previous = games.get(gameRestartMatch[1]);
        if (!previous) return sendJson(res, 404, { error: 'Game not found.' });
        void catalog.rescan().then(async () => {
          const entry = await catalog.getEntry(previous.galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery is no longer available.' });
          const result = createSoloGame({
            manifest: entry.manifest,
            usableCards: entry.usableCards,
            allowedRoots: await catalog.getRoots(),
            selection: { categoryIds: previous.categoryIds, valuesByCategory: previous.valuesByCategory, acknowledgeVariation: true },
            startingBoardSize: previous.startingBoardSize,
            targetSets: previous.targetSets,
            random: () => randomInt(0, 0x100000000) / 0x100000000,
          });
          if (!result.ok) return sendJson(res, result.status, { error: result.error, readiness: result.readiness });
          games.delete(previous.id);
          games.set(result.game.id, result.game);
          sendJson(res, 201, { game: serializeGame(result.game) });
        }).catch(() => sendJson(res, 500, { error: 'Unable to restart game from the current gallery.' }));
      });
      return;
    }

    if (pathname === '/api/galleries' && req.method === 'GET') {
      requireLoopback(req, res, () => {
        void catalog.rescan().then((entries) => entries.map((entry) => catalog.getLocalSummary(entry)))
          .then((galleries) => sendJson(res, 200, { galleries }))
          .catch(() => sendJson(res, 500, { error: 'Gallery scan failed.' }));
      });
      return;
    }

    const validateMatch = /^\/api\/galleries\/([^/]+)\/validate$/.exec(pathname);
    if (validateMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        let galleryId;
        try { galleryId = decodeURIComponent(validateMatch[1]); } catch {
          sendJson(res, 400, { error: 'Invalid gallery ID.' });
          return;
        }
        if (!isSafeGalleryId(galleryId)) {
          sendJson(res, 400, { error: 'Invalid gallery ID.' });
          return;
        }
        void catalog.rescan().then(() => catalog.getEntry(galleryId))
          .then((entry) => {
            if (!entry) {
              sendJson(res, 404, { error: 'Gallery not found.' });
              return;
            }
            sendJson(res, 200, { gallery: catalog.getLocalSummary(entry) });
          })
          .catch(() => sendJson(res, 500, { error: 'Gallery validation failed.' }));
      });
      return;
    }

    const fileDropPreviewMatch = /^\/api\/galleries\/([^/]+)\/editor\/file-drop-preview$/.exec(pathname);
    if (fileDropPreviewMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        void (async () => {
          const galleryId = decodeURIComponent(fileDropPreviewMatch[1]);
          const entry = await catalog.getEntry(galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery not found.' });
          const body = await readJsonBody(req);
          const preview = await previewGalleryFileDrops(entry, Array.isArray(body.files) ? body.files : (body.droppedFiles ?? []));
          sendJson(res, 200, preview);
        })().catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'File drop preview failed.' }));
      });
      return;
    }

    const fileDropApplyMatch = /^\/api\/galleries\/([^/]+)\/editor\/file-drop-apply$/.exec(pathname);
    if (fileDropApplyMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        void (async () => {
          const galleryId = decodeURIComponent(fileDropApplyMatch[1]);
          const entry = await catalog.getEntry(galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery not found.' });
          const body = await readJsonBody(req);
          const result = await applyGalleryFileDrops(entry, body);
          if (!result.ok) return sendJson(res, result.status ?? 422, result);
          await catalog.rescan();
          sendJson(res, 200, { applied: true, ...result });
        })().catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'File drop apply failed.' }));
      });
      return;
    }

    const filenameProfileMatch = /^\/api\/galleries\/([^/]+)\/editor\/filename-profile$/.exec(pathname);
    if (filenameProfileMatch && ['GET', 'PATCH'].includes(req.method)) {
      requireLoopback(req, res, () => {
        void (async () => {
          const galleryId = decodeURIComponent(filenameProfileMatch[1]);
          const entry = await catalog.getEntry(galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery not found.' });
          if (req.method === 'GET') return sendJson(res, 200, { profile: entry.manifest.filenameTagging ?? { enabled: false, delimiter: '_', slots: [] } });
          const body = await readJsonBody(req);
          const result = await saveFilenameProfile(entry, body.profile);
          if (!result.ok) return sendJson(res, 422, { error: 'Filename profile is invalid.', errors: result.errors });
          await catalog.rescan();
          sendJson(res, 200, { profile: body.profile, saved: true });
        })().catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'Filename profile request failed.' }));
      });
      return;
    }

    const filenamePreviewMatch = /^\/api\/galleries\/([^/]+)\/editor\/filename-preview$/.exec(pathname);
    if (filenamePreviewMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        void (async () => {
          const galleryId = decodeURIComponent(filenamePreviewMatch[1]);
          await catalog.rescan();
          const entry = await catalog.getEntry(galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery not found.' });
          const body = await readJsonBody(req);
          const preview = await previewGalleryFilenameTags(entry, body.assetPaths);
          if (preview.errors.length) return sendJson(res, 422, preview);
          sendJson(res, 200, preview);
        })().catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'Filename preview failed.' }));
      });
      return;
    }

    const filenameApplyMatch = /^\/api\/galleries\/([^/]+)\/editor\/filename-apply$/.exec(pathname);
    if (filenameApplyMatch && req.method === 'POST') {
      requireLoopback(req, res, () => {
        void (async () => {
          const galleryId = decodeURIComponent(filenameApplyMatch[1]);
          await catalog.rescan();
          const entry = await catalog.getEntry(galleryId);
          if (!entry) return sendJson(res, 404, { error: 'Gallery not found.' });
          const body = await readJsonBody(req);
          const result = await applyGalleryFilenameTags(entry, body.decisions ?? {});
          if (!result.ok) return sendJson(res, result.status ?? 422, result);
          await catalog.rescan();
          sendJson(res, 200, { applied: true, ...result });
        })().catch((error) => sendJson(res, error.statusCode ?? 400, { error: error.message || 'Filename tag apply failed.' }));
      });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'API route not found' });
      return;
    }

    serveBuiltApp(req, res, pathname, staticDirectory);
  });
}

const server = createSetGalleryServer();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => {
    console.log(`Set Gallery server listening at http://${host}:${port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
