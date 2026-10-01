import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  analyzeDeckReadiness,
  createDefaultSelection,
  isSafeGalleryId,
  isSupportedImagePath,
  validateGalleryManifest,
} from './gallery-validation.js';

const MANIFEST_FILENAME = 'set-gallery.json';

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function genericError(code, message) {
  return { code, message };
}

async function canonicalRoots(configuredRoots) {
  const roots = [];
  for (const configuredRoot of configuredRoots) {
    if (typeof configuredRoot !== 'string' || configuredRoot.trim() === '') continue;
    try {
      const canonical = await fs.realpath(configuredRoot);
      if ((await fs.stat(canonical)).isDirectory() && !roots.includes(canonical)) roots.push(canonical);
    } catch {
      // Unavailable configured roots are omitted; diagnostics remain path-free.
    }
  }
  return roots;
}

async function listManifestFiles(roots) {
  const found = [];
  const visited = new Set();
  const scanDirectory = async (directory, root) => {
    let canonicalDirectory;
    try {
      canonicalDirectory = await fs.realpath(directory);
      if (!isContained(root, canonicalDirectory) || visited.has(canonicalDirectory)) return;
      visited.add(canonicalDirectory);
    } catch { return; }

    let entries;
    try { entries = await fs.readdir(canonicalDirectory, { withFileTypes: true }); } catch { return; }
    if (entries.some((entry) => entry.isFile() && entry.name === MANIFEST_FILENAME)) {
      found.push({ manifestPath: path.join(canonicalDirectory, MANIFEST_FILENAME), root });
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const child = path.join(canonicalDirectory, entry.name);
      try {
        const realChild = await fs.realpath(child);
        if (isContained(root, realChild) && (await fs.stat(realChild)).isDirectory()) await scanDirectory(realChild, root);
      } catch { /* Ignore inaccessible and escaping symlinks. */ }
    }
  };
  for (const root of roots) await scanDirectory(root, root);
  return found;
}

async function inspectManifest(found, roots) {
  let manifest;
  try {
    const canonicalManifestPath = await fs.realpath(found.manifestPath);
    if (!roots.some((root) => isContained(root, canonicalManifestPath))) {
      return { manifest: null, validation: { valid: false, errors: [genericError('manifest-outside-root', 'Manifest is outside configured gallery roots.')] }, fileDiagnostics: [], usableCards: [] };
    }
    manifest = JSON.parse(await fs.readFile(canonicalManifestPath, 'utf8'));
    found.manifestPath = canonicalManifestPath;
  } catch {
    return { manifest: null, validation: { valid: false, errors: [genericError('manifest-unreadable', 'Manifest could not be read or parsed.')] }, fileDiagnostics: [], usableCards: [] };
  }

  const validation = validateGalleryManifest(manifest);
  const cards = Array.isArray(manifest?.cards) ? manifest.cards : [];
  const cardErrors = new Set(validation.errors.map((error) => {
    const match = /^cards\.(\d+)(?:\.|$)/.exec(error.location);
    return match ? Number(match[1]) : -1;
  }).filter((index) => index >= 0));
  const fileDiagnostics = [];
  const usableCards = [];

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (cardErrors.has(index) || !card || typeof card.image !== 'string' || !isSupportedImagePath(card.image)) {
      fileDiagnostics.push({ cardId: typeof card?.id === 'string' ? card.id : null, filename: safeBasename(card?.image), status: 'excluded', code: cardErrors.has(index) ? 'invalid-card-record' : 'unsupported-image', message: cardErrors.has(index) ? 'Card record has invalid or unknown feature metadata.' : 'Image format is not supported.' });
      continue;
    }

    let canonicalImage;
    try {
      const requestedImage = path.isAbsolute(card.image) ? card.image : path.resolve(path.dirname(found.manifestPath), card.image);
      canonicalImage = await fs.realpath(requestedImage);
      if (!roots.some((root) => isContained(root, canonicalImage))) {
        fileDiagnostics.push({ cardId: card.id, filename: safeBasename(card.image), status: 'excluded', code: 'path-outside-root', message: 'Image resolves outside configured gallery roots.' });
        continue;
      }
      if (!isSupportedImagePath(canonicalImage)) {
        fileDiagnostics.push({ cardId: card.id, filename: safeBasename(card.image), status: 'excluded', code: 'unsupported-image', message: 'Resolved image format is not supported.' });
        continue;
      }
      if (!(await fs.stat(canonicalImage)).isFile()) {
        fileDiagnostics.push({ cardId: card.id, filename: safeBasename(card.image), status: 'excluded', code: 'not-a-file', message: 'Image reference is not a regular file.' });
        continue;
      }
    } catch {
      fileDiagnostics.push({ cardId: card.id, filename: safeBasename(card.image), status: 'excluded', code: 'missing-image', message: 'Image file is missing or inaccessible.' });
      continue;
    }
    usableCards.push({ id: card.id, features: card.features, canonicalPath: canonicalImage });
    fileDiagnostics.push({ cardId: card.id, filename: safeBasename(card.image), status: 'usable', code: null, message: 'Image is readable and supported.' });
  }

  return { manifest, validation, fileDiagnostics, usableCards };
}

function safeBasename(reference) {
  if (typeof reference !== 'string') return null;
  return path.basename(reference.replaceAll('\\', '/')) || null;
}

function countUsableReadiness(manifest, usableCards) {
  const selection = createDefaultSelection(manifest);
  if (!selection) return { ready: false, combinationCount: 81, presentCombinationCount: 0, missingCount: 81 };
  const result = analyzeDeckReadiness(manifest, selection, usableCards, { random: () => 0 });
  return {
    ready: result.ready,
    combinationCount: result.combinationCount,
    presentCombinationCount: result.presentCombinationCount,
    missingCount: result.missingTuples.length,
  };
}

function hashFileBytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function createGalleryCatalog(configuredRoots) {
  const rootsPromise = canonicalRoots(Array.isArray(configuredRoots) ? configuredRoots : []);
  let entriesPromise;

  async function loadEntries() {
    const roots = await rootsPromise;
    const manifestFiles = await listManifestFiles(roots);
    const entries = [];
    for (const found of manifestFiles) {
      const inspected = await inspectManifest(found, roots);
      const galleryId = inspected.manifest?.id;
      entries.push({
        id: isSafeGalleryId(galleryId) ? galleryId : null,
        name: typeof inspected.manifest?.name === 'string' ? inspected.manifest.name : null,
        manifestPath: found.manifestPath,
        allowedRoot: found.root,
        manifest: inspected.manifest,
        validation: inspected.validation,
        fileDiagnostics: inspected.fileDiagnostics,
        usableCards: inspected.usableCards,
      });
    }

    const ids = new Map();
    for (const entry of entries) {
      if (!entry.id) continue;
      ids.set(entry.id, (ids.get(entry.id) ?? 0) + 1);
    }
    for (const entry of entries) {
      if (entry.id && ids.get(entry.id) > 1) {
        entry.validation = {
          valid: false,
          errors: [...entry.validation.errors, genericError('duplicate-gallery-id', 'More than one configured gallery uses this ID.')],
        };
      }
    }
    return entries;
  }

  async function getEntries() {
    if (!entriesPromise) entriesPromise = loadEntries();
    return entriesPromise;
  }

  async function rescan() {
    entriesPromise = loadEntries();
    return getEntries();
  }

  async function getEntry(id) {
    if (!isSafeGalleryId(id)) return null;
    const matches = (await getEntries()).filter((entry) => entry.id === id);
    return matches.length === 1 ? matches[0] : null;
  }

  async function getAvailable() {
    const entries = await getEntries();
    return entries.filter((entry) => entry.id && entry.name && entry.validation.valid).map((entry) => ({
      id: entry.id,
      name: entry.name,
      readiness: {
        manifestValid: true,
        categoryCount: entry.manifest.categories.length,
        cardCount: entry.manifest.cards.length,
        usableCardCount: entry.usableCards.length,
        defaultSetup: countUsableReadiness(entry.manifest, entry.usableCards),
      },
    }));
  }

  function getLocalSummary(entry) {
    const manifest = entry.manifest;
    const categories = Array.isArray(manifest?.categories) ? manifest.categories : [];
    return {
      id: entry.id,
      name: entry.name,
      filenameTagging: manifest?.filenameTagging ?? null,
      validation: { valid: entry.validation.valid, errors: entry.validation.errors },
      counts: {
        categories: categories.length,
        cards: Array.isArray(manifest?.cards) ? manifest.cards.length : 0,
        usableCards: entry.usableCards.length,
        excludedCards: entry.fileDiagnostics.filter((item) => item.status === 'excluded').length,
      },
      categories: categories.map((category) => ({
        id: category?.id ?? null,
        name: category?.name ?? null,
        values: Array.isArray(category?.values) ? category.values.map((value) => ({ id: value?.id ?? null, label: value?.label ?? null })) : [],
      })),
      files: entry.fileDiagnostics,
      readiness: manifest ? countUsableReadiness(manifest, entry.usableCards) : { ready: false, combinationCount: 81, presentCombinationCount: 0, missingCount: 81 },
    };
  }

  async function getEditorView(id) {
    if (!isSafeGalleryId(id)) return null;
    const entry = await getEntry(id);
    if (!entry || !entry.manifest) return null;
    const categories = Array.isArray(entry.manifest.categories) ? entry.manifest.categories : [];
    const cards = [];
    const duplicateImageHashes = new Map();
    const duplicateNames = new Map();
    for (const card of Array.isArray(entry.manifest.cards) ? entry.manifest.cards : []) {
      if (typeof card?.image !== 'string') continue;
      const imagePath = path.isAbsolute(card.image) ? card.image : path.resolve(path.dirname(entry.manifestPath), card.image);
      try {
        const buffer = await fs.readFile(imagePath);
        const digest = hashFileBytes(buffer);
        const matched = duplicateImageHashes.get(digest) ?? [];
        matched.push(card.id);
        duplicateImageHashes.set(digest, matched);
      } catch {
        // Missing files already handled elsewhere; keep the viewer tolerant.
      }
      const fileName = path.basename(card.image);
      const sameName = duplicateNames.get(fileName) ?? [];
      sameName.push(card.id);
      duplicateNames.set(fileName, sameName);
    }

    for (const card of Array.isArray(entry.manifest.cards) ? entry.manifest.cards : []) {
      const imagePath = path.isAbsolute(card.image) ? card.image : path.resolve(path.dirname(entry.manifestPath), card.image);
      let digest = null;
      try {
        digest = hashFileBytes(await fs.readFile(imagePath));
      } catch {
        digest = null;
      }
      const duplicateImageIds = digest ? duplicateImageHashes.get(digest)?.filter((value, index, source) => source.indexOf(value) === index) ?? [] : [];
      const fileName = path.basename(card.image ?? '');
      const duplicateFileIds = duplicateNames.get(fileName)?.filter((value, index, source) => source.indexOf(value) === index) ?? [];
      const missingCategoryIds = categories
        .filter((category) => typeof category?.id === 'string')
        .filter((category) => !Object.prototype.hasOwnProperty.call(card?.features ?? {}, category.id) || card.features[category.id] === null || card.features[category.id] === undefined)
        .map((category) => category.id);
      const relativePath = typeof card?.image === 'string' ? card.image.replaceAll('\\', '/') : '';
      cards.push({
        id: card?.id ?? null,
        image: typeof card?.image === 'string' ? card.image : null,
        imagePath,
        relativePath,
        directory: relativePath ? relativePath.split('/').slice(0, -1).join('/') : '',
        filename: relativePath ? relativePath.split('/').at(-1) ?? relativePath : '',
        featureSummary: card?.features ?? {},
        missingCategoryIds,
        duplicateImageIds,
        duplicateFileIds,
        duplicateImage: duplicateImageIds.length > 1,
        duplicateFileName: duplicateFileIds.length > 1,
      });
    }

    return {
      id: entry.id,
      name: entry.name,
      categories: categories.map((category) => ({
        id: category?.id ?? null,
        name: category?.name ?? null,
        values: Array.isArray(category?.values) ? category.values.map((value) => ({ id: value?.id ?? null, label: value?.label ?? null })) : [],
      })),
      cards,
      missingCards: cards.filter((card) => card.missingCategoryIds.length > 0),
      duplicateImageCards: cards.filter((card) => card.duplicateImage),
      duplicateFilenameCards: cards.filter((card) => card.duplicateFileName),
    };
  }

  return { getEntries, getEntry, getAvailable, getLocalSummary, getEditorView, rescan, getRoots: () => rootsPromise };
}
