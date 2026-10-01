import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateGalleryManifest } from './gallery-validation.js';
import { writeManifestSafely } from './manifest-store.js';

function decodeFilePayload(payload) {
  if (typeof payload === 'string') {
    return Buffer.from(payload, 'base64');
  }
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (Array.isArray(payload)) return Buffer.from(payload);
  return Buffer.alloc(0);
}

function fileHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function listGalleryAssetHashes(entry) {
  const galleryDirectory = path.dirname(entry.manifestPath);
  const files = [];
  const walk = async (directory) => {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      const stat = await fs.stat(child).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) await walk(child);
      else if (stat.isFile()) {
        const ext = path.extname(child).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
          const data = await fs.readFile(child);
          files.push({ absolutePath: child, relativePath: path.relative(galleryDirectory, child).split(path.sep).join('/'), hash: fileHash(data) });
        }
      }
    }
  };
  return walk(galleryDirectory).then(() => files);
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase('und');
}

function tokenValue(category, token) {
  const key = normalize(token);
  const matches = [];
  for (const value of category.values) {
    const candidates = [value.id, value.label, ...(Array.isArray(value.aliases) ? value.aliases : [])];
    if (candidates.some((candidate) => normalize(candidate) === key)) matches.push(value);
  }
  const unique = [...new Map(matches.map((value) => [value.id, value])).values()];
  if (unique.length === 1) return { value: unique[0] };
  if (unique.length > 1) return { ambiguous: unique.map(({ id, label }) => ({ id, label })) };
  return { unknown: true };
}

/** Parser order is extension → first-hyphen suffix → delimiter split → ignore numeric/vN → slot mapping. */
export function parseFilenameTags(filename, profile, categories) {
  const delimiter = profile?.delimiter ?? '_';
  if (typeof delimiter !== 'string' || delimiter.length === 0) {
    return { ok: false, status: 'invalid-profile', error: 'Delimiter must be a non-empty string.' };
  }
  const stem = path.basename(String(filename)).replace(/\.[^.]*$/, '');
  const suffixIndex = stem.indexOf('-');
  const parsedStem = suffixIndex < 0 ? stem : stem.slice(0, suffixIndex);
  const ignoredSuffix = suffixIndex < 0 ? null : stem.slice(suffixIndex + 1);
  const allTokens = parsedStem.split(delimiter);
  const ignoredTokens = [];
  const tokens = [];
  for (const token of allTokens) {
    if (/^\d+$/.test(token) || /^[vV]\d+$/.test(token)) ignoredTokens.push(token);
    else tokens.push(token);
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const assignments = {};
  const issues = [];
  const usedPositions = new Set();
  const slots = Array.isArray(profile?.slots) ? profile.slots : [];
  for (const slot of slots) {
    if (!Number.isSafeInteger(slot?.position) || slot.position < 1 || typeof slot.categoryId !== 'string') {
      issues.push({ code: 'invalid-slot', message: 'Filename profile contains an invalid slot.' });
      continue;
    }
    if (usedPositions.has(slot.position)) {
      issues.push({ code: 'duplicate-position', position: slot.position, message: 'A token position is mapped more than once.' });
      continue;
    }
    usedPositions.add(slot.position);
    const category = categoryById.get(slot.categoryId);
    if (!category) {
      issues.push({ code: 'unknown-category', categoryId: slot.categoryId, position: slot.position, message: 'Profile refers to a missing category.' });
      continue;
    }
    const token = tokens[slot.position - 1];
    if (token === undefined || token === '') {
      issues.push({ code: 'missing-token', categoryId: category.id, categoryName: category.name, position: slot.position, message: `No filename token exists at position ${slot.position}.` });
      continue;
    }
    const match = tokenValue(category, token);
    if (match.unknown) {
      issues.push({ code: 'unknown-value', categoryId: category.id, categoryName: category.name, token, position: slot.position, message: `Unknown value "${token}" for ${category.name}.` });
    } else if (match.ambiguous) {
      issues.push({ code: 'ambiguous-value', categoryId: category.id, categoryName: category.name, token, candidates: match.ambiguous, position: slot.position, message: `Token "${token}" matches more than one value for ${category.name}.` });
    } else {
      assignments[category.id] = match.value.id;
    }
  }
  return {
    ok: issues.length === 0,
    status: issues.length ? 'needs-review' : 'parsed',
    sourceName: path.basename(String(filename)),
    stem,
    parsedStem,
    ignoredSuffix,
    allTokens,
    tokens,
    ignoredTokens,
    assignments,
    issues,
  };
}

async function scanImages(directory, root) {
  const results = [];
  const visited = new Set();
  async function visit(folder) {
    let canonical;
    try {
      canonical = await fs.realpath(folder);
      if (!isContained(root, canonical) || visited.has(canonical)) return;
      visited.add(canonical);
    } catch { return; }
    let entries;
    try { entries = await fs.readdir(canonical, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = path.join(canonical, entry.name);
      try {
        const actual = await fs.realpath(child);
        if (!isContained(root, actual)) continue;
        const stat = await fs.stat(actual);
        if (stat.isDirectory()) await visit(actual);
        else if (stat.isFile() && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(actual).toLowerCase())) {
          results.push({ absolutePath: actual, relativePath: path.relative(directory, actual).split(path.sep).join('/') });
        }
      } catch { /* Ignore inaccessible files and links. */ }
    }
  }
  await visit(directory);
  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function existingCardForFile(cards, absolutePath, galleryDirectory) {
  const matches = [];
  for (const card of cards) {
    if (typeof card?.image !== 'string') continue;
    const candidate = path.isAbsolute(card.image) ? card.image : path.resolve(galleryDirectory, card.image);
    if (path.resolve(candidate).toLowerCase() === path.resolve(absolutePath).toLowerCase()) matches.push(card);
  }
  return matches;
}

function stableCardId(relativePath, usedIds) {
  const base = `file-${createHash('sha256').update(relativePath).digest('hex').slice(0, 24)}`;
  if (!usedIds.has(base)) return base;
  let index = 2;
  while (usedIds.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function makePreviewRecord(file, parsed, manifest, galleryDirectory) {
  const cards = Array.isArray(manifest.cards) ? manifest.cards : [];
  const matches = existingCardForFile(cards, file.absolutePath, galleryDirectory);
  if (matches.length > 1) {
    return { ...parsed, assetPath: file.relativePath, outcome: 'ambiguous-record', matchingCardIds: matches.map((card) => card.id), conflicts: [] };
  }
  const existing = matches[0] ?? null;
  const conflicts = [];
  for (const [categoryId, proposedValueId] of Object.entries(parsed.assignments)) {
    const oldValueId = existing?.features?.[categoryId];
    if (oldValueId && oldValueId !== proposedValueId) {
      const category = manifest.categories.find((item) => item.id === categoryId);
      const oldLabel = category?.values.find((value) => value.id === oldValueId)?.label ?? oldValueId;
      const newLabel = category?.values.find((value) => value.id === proposedValueId)?.label ?? proposedValueId;
      conflicts.push({ categoryId, oldValueId, oldLabel, proposedValueId, proposedLabel: newLabel });
    }
  }
  return {
    ...parsed,
    assetPath: file.relativePath,
    outcome: parsed.ok ? (existing ? 'matched' : 'new') : (existing ? 'matched-needs-review' : 'new-needs-review'),
    existingCardId: existing?.id ?? null,
    existingFeatures: existing?.features ?? {},
    conflicts,
  };
}

export async function previewGalleryFilenameTags(entry, selectedPaths) {
  if (!entry?.manifest || !entry?.manifestPath || !entry?.allowedRoot) throw new Error('Gallery is unavailable.');
  const profile = entry.manifest.filenameTagging;
  if (!profile || profile.enabled === false) throw new Error('Filename tagging is not enabled for this gallery.');
  if (!Array.isArray(profile.slots) || profile.slots.length === 0) throw new Error('Map at least one filename token position to a category first.');
  const validation = validateGalleryManifest({ ...entry.manifest, cards: [] });
  if (!validation.valid) return { profile, files: [], errors: validation.errors };
  const galleryDirectory = path.dirname(entry.manifestPath);
  const allFiles = await scanImages(galleryDirectory, entry.allowedRoot);
  const selection = Array.isArray(selectedPaths) && selectedPaths.length
    ? new Set(selectedPaths.filter((item) => typeof item === 'string'))
    : null;
  const files = allFiles.filter((file) => !selection || selection.has(file.relativePath));
  return {
    profile: { delimiter: profile.delimiter ?? '_', slots: profile.slots },
    totalDiscovered: allFiles.length,
    files: files.map((file) => makePreviewRecord(file, parseFilenameTags(path.basename(file.relativePath), profile, entry.manifest.categories), entry.manifest, galleryDirectory)),
    errors: [],
  };
}

export async function applyGalleryFilenameTags(entry, decisions = {}) {
  const preview = await previewGalleryFilenameTags(entry);
  if (preview.errors.length) return { ok: false, status: 422, errors: preview.errors };
  const manifest = structuredClone(entry.manifest);
  const galleryDirectory = path.dirname(entry.manifestPath);
  const usedIds = new Set(manifest.cards.map((card) => card.id));
  let updatedCount = 0;
  let createdCount = 0;
  let ignoredCount = 0;
  const unresolved = [];
  const skipped = new Set(Array.isArray(decisions.skipFiles) ? decisions.skipFiles : []);
  const valueResolutions = decisions.valueResolutions ?? {};
  const globalValueResolutions = decisions.globalValueResolutions ?? {};

  for (const file of preview.files) {
    if (skipped.has(file.assetPath)) continue;
    if (file.outcome === 'ambiguous-record') {
      unresolved.push({ assetPath: file.assetPath, code: 'ambiguous-record', cardIds: file.matchingCardIds });
      continue;
    }
    const choice = decisions[file.assetPath] ?? {};
    const existing = manifest.cards.find((card) => card.id === file.existingCardId);
    const resolvedAssignments = { ...file.assignments };
    for (const issue of file.issues) {
      if (!['unknown-value', 'ambiguous-value'].includes(issue.code)) {
        unresolved.push({ assetPath: file.assetPath, code: issue.code, issue });
        continue;
      }
      const resolution = valueResolutions?.[file.assetPath]?.[issue.categoryId]
        ?? globalValueResolutions?.[issue.categoryId]?.[issue.token];
      const category = manifest.categories.find((item) => item.id === issue.categoryId);
      const value = category?.values.find((item) => item.id === resolution);
      if (!value) {
        unresolved.push({ assetPath: file.assetPath, code: issue.code, issue });
        continue;
      }
      resolvedAssignments[issue.categoryId] = value.id;
      if (!Array.isArray(value.aliases)) value.aliases = [];
      if (!value.aliases.some((alias) => normalize(alias) === normalize(issue.token))) value.aliases.push(issue.token);
    }
    if (unresolved.some((item) => item.assetPath === file.assetPath)) continue;
    let card = existing;
    if (!card) {
      const id = stableCardId(file.assetPath, usedIds);
      usedIds.add(id);
      card = { id, image: path.relative(galleryDirectory, path.resolve(galleryDirectory, file.assetPath)).split(path.sep).join('/'), features: {} };
      manifest.cards.push(card);
      createdCount += 1;
    }

    let changed = !existing;
    for (const [categoryId, proposedValueId] of Object.entries(resolvedAssignments)) {
      const old = card.features[categoryId];
      if (!old || old === proposedValueId) {
        if (old !== proposedValueId) { card.features[categoryId] = proposedValueId; changed = true; }
        continue;
      }
      const decision = choice[categoryId];
      if (decision === 'overwrite') { card.features[categoryId] = proposedValueId; changed = true; }
      else if (decision === 'ignore') ignoredCount += 1;
      else unresolved.push({ assetPath: file.assetPath, code: 'conflict', categoryId, oldValueId: old, proposedValueId, allowedDecisions: ['overwrite', 'ignore'] });
    }
    if (existing && changed) updatedCount += 1;
  }

  if (unresolved.length) return { ok: false, status: 409, applied: false, unresolved, createdCount: 0, updatedCount: 0, ignoredCount };
  const validation = validateGalleryManifest(manifest);
  const originalErrors = new Set(validateGalleryManifest(entry.manifest).errors.map((error) => `${error.code}:${error.location}`));
  const newErrors = validation.errors.filter((error) => !originalErrors.has(`${error.code}:${error.location}`));
  if (newErrors.length) return { ok: false, status: 422, errors: newErrors };
  await writeManifestSafely(entry, manifest);
  return { ok: true, createdCount, updatedCount, ignoredCount, totalRecords: manifest.cards.length, remainingValidationErrors: validation.errors };
}

export async function previewGalleryFileDrops(entry, droppedFiles = []) {
  if (!entry?.manifest || !entry?.manifestPath || !entry?.allowedRoot) throw new Error('Gallery is unavailable.');
  const galleryDirectory = path.dirname(entry.manifestPath);
  const knownAssets = await listGalleryAssetHashes(entry);
  const files = [];
  for (const file of Array.isArray(droppedFiles) ? droppedFiles : []) {
    const name = typeof file?.name === 'string' ? file.name : 'untitled-file';
    const payload = decodeFilePayload(file?.data ?? file?.content ?? file?.bytes ?? file?.buffer ?? []);
    const canonicalName = path.basename(name).replaceAll('\\', '/');
    const hash = fileHash(payload || Buffer.alloc(0));
    const matches = knownAssets.filter((known) => known.hash === hash);
    files.push({
      name: canonicalName,
      status: matches.length === 0 ? 'new-copy' : matches.length === 1 ? 'existing-match' : 'ambiguous-duplicate',
      hash,
      matches: matches.map((match) => ({ relativePath: match.relativePath, absolutePath: match.absolutePath })),
      fileSize: payload.length,
    });
  }
  return { files, totalFiles: files.length, galleryDir: galleryDirectory };
}

export async function applyGalleryFileDrops(entry, payload = {}) {
  const preview = await previewGalleryFileDrops(entry, Array.isArray(payload.files) ? payload.files : (payload.droppedFiles ?? []));
  const galleryDirectory = path.dirname(entry.manifestPath);
  const imageDirectory = path.join(galleryDirectory, 'images');
  await fs.mkdir(imageDirectory, { recursive: true });
  const decisions = payload.decisions ?? {};
  let reusedCount = 0;
  let copiedCount = 0;
  let skippedCount = 0;
  const unresolved = [];

  for (const file of preview.files) {
    const decision = decisions[file.name] ?? decisions[file.hash] ?? (file.status === 'new-copy' ? 'copy' : 'reuse');
    const input = Array.isArray(payload.files) ? payload.files.find((item) => item.name === file.name) : null;
    const buffer = decodeFilePayload(input?.data ?? input?.content ?? input?.bytes ?? input?.buffer ?? []);

    if (file.status === 'ambiguous-duplicate') {
      if (decision === 'skip') { skippedCount += 1; continue; }
      if (decision === 'copy') {
        const destination = path.join(imageDirectory, file.name);
        await fs.writeFile(destination, buffer);
        copiedCount += 1;
        continue;
      }
      if (decision === 'reuse') {
        reusedCount += 1;
        continue;
      }
      unresolved.push({ name: file.name, reason: 'ambiguous duplicate asset; select a path or skip.' });
      continue;
    }

    if (file.status === 'existing-match') {
      if (decision === 'skip') { skippedCount += 1; continue; }
      if (decision === 'copy') {
        const destination = path.join(imageDirectory, file.name);
        await fs.writeFile(destination, buffer);
        copiedCount += 1;
        continue;
      }
      reusedCount += 1;
      continue;
    }

    if (file.status === 'new-copy') {
      if (decision === 'skip') { skippedCount += 1; continue; }
      const destination = path.join(imageDirectory, file.name);
      await fs.writeFile(destination, buffer);
      copiedCount += 1;
    }
  }

  if (unresolved.length) return { ok: false, status: 409, applied: false, unresolved, reusedCount: 0, copiedCount: 0, skippedCount };
  return { ok: true, applied: true, reusedCount, copiedCount, skippedCount, totalRecords: 0 };
}

export async function saveFilenameProfile(entry, profile) {
  if (!entry?.manifest || !entry?.manifestPath) throw new Error('Gallery is unavailable.');
  const manifest = structuredClone(entry.manifest);
  manifest.filenameTagging = profile;
  const validation = validateGalleryManifest(manifest);
  if (!validation.valid) return { ok: false, errors: validation.errors };
  await writeManifestSafely(entry, manifest);
  return { ok: true };
}
