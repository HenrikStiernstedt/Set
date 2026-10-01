import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateGalleryManifest, isSupportedImagePath } from './gallery-validation.js';
import { writeManifestSafely } from './manifest-store.js';

const MAX_REPLACEMENT_BYTES = 8 * 1024 * 1024;
const IMAGE_SIGNATURES = {
  '.png': (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  '.jpg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  '.jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  '.gif': (bytes) => bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
  '.webp': (bytes) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
};

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function recordError(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  throw error;
}

async function resolveCardImage(entry, card) {
  if (!isSupportedImagePath(card.image)) recordError('Card image reference is unsupported.', 422);
  const galleryDirectory = path.dirname(entry.manifestPath);
  const requested = path.isAbsolute(card.image) ? card.image : path.resolve(galleryDirectory, card.image);
  let canonical;
  try { canonical = await fs.realpath(requested); } catch { recordError('Card image is missing or inaccessible.', 422); }
  if (!contained(entry.allowedRoot, canonical) || !(await fs.stat(canonical)).isFile()) {
    recordError('Card image resolves outside the configured gallery root.', 422);
  }
  return canonical;
}

function cardForMutation(entry, cardId) {
  if (typeof cardId !== 'string' || !cardId) recordError('A card ID is required.');
  const cards = Array.isArray(entry.manifest?.cards) ? entry.manifest.cards : [];
  const matches = cards.filter((card) => card?.id === cardId);
  if (matches.length !== 1) recordError(matches.length ? 'Card ID is ambiguous.' : 'Card not found.', 404);
  const card = matches[0];
  if (!card || typeof card.image !== 'string' || !card.features || typeof card.features !== 'object' || Array.isArray(card.features)) {
    recordError('Card record is not editable until its metadata is repaired.', 422);
  }
  return card;
}

function validateNoNewManifestErrors(previous, next) {
  const previousErrors = new Set(validateGalleryManifest(previous).errors.map((error) => `${error.code}:${error.location}`));
  const newErrors = validateGalleryManifest(next).errors.filter((error) => !previousErrors.has(`${error.code}:${error.location}`));
  if (newErrors.length) return { ok: false, status: 422, errors: newErrors };
  return { ok: true };
}

export async function assignGalleryCardValues(entry, { cardId, assignments, decisions = {} } = {}) {
  if (!entry?.manifest || !entry?.manifestPath) recordError('Gallery is unavailable.', 404);
  const card = cardForMutation(entry, cardId);
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments) || !Object.keys(assignments).length) {
    recordError('Choose at least one category and value.');
  }

  const manifest = structuredClone(entry.manifest);
  const target = manifest.cards.find((candidate) => candidate.id === cardId);
  const categories = new Map(manifest.categories.map((category) => [category.id, category]));
  const conflicts = [];
  let changed = false;
  for (const [categoryId, valueId] of Object.entries(assignments)) {
    const category = categories.get(categoryId);
    if (!category || typeof valueId !== 'string' || !category.values.some((value) => value.id === valueId)) {
      recordError('The selected category or value is not part of this gallery.', 422);
    }
    const currentValueId = target.features[categoryId];
    if (currentValueId && currentValueId !== valueId) {
      const decision = decisions[categoryId];
      if (decision !== 'overwrite' && decision !== 'ignore') {
        conflicts.push({ categoryId, currentValueId, proposedValueId: valueId });
        continue;
      }
      if (decision === 'ignore') continue;
    }
    if (currentValueId !== valueId) {
      target.features[categoryId] = valueId;
      changed = true;
    }
  }
  if (conflicts.length) return { ok: false, status: 409, conflicts };
  if (!changed) return { ok: true, changed: false, cardId };
  const validation = validateNoNewManifestErrors(entry.manifest, manifest);
  if (!validation.ok) return validation;
  await resolveCardImage(entry, card);
  await writeManifestSafely(entry, manifest);
  return { ok: true, changed: true, cardId };
}

export async function replaceGalleryCardImage(entry, { cardId, name, data } = {}) {
  if (!entry?.manifest || !entry?.manifestPath) recordError('Gallery is unavailable.', 404);
  const card = cardForMutation(entry, cardId);
  if (typeof name !== 'string' || typeof data !== 'string') recordError('Choose an image file to replace this card.');
  const filename = path.basename(name.replaceAll('\\', '/'));
  const extension = path.extname(filename).toLowerCase();
  if (!isSupportedImagePath(filename)) recordError('Choose a PNG, JPEG, GIF, or WebP image.', 415);
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_REPLACEMENT_BYTES) recordError('Replacement image must be no larger than 8 MB.', 413);
  if (!IMAGE_SIGNATURES[extension]?.(bytes)) recordError('The file contents do not match the selected image format.', 415);

  const manifest = structuredClone(entry.manifest);
  const target = manifest.cards.find((candidate) => candidate.id === cardId);
  const galleryDirectory = path.dirname(entry.manifestPath);
  const relativeDirectory = path.join('images', 'editor-replacements');
  const destinationDirectory = path.join(galleryDirectory, relativeDirectory);
  await fs.mkdir(destinationDirectory, { recursive: true });
  const canonicalDirectory = await fs.realpath(destinationDirectory);
  if (!contained(entry.allowedRoot, canonicalDirectory)) recordError('Replacement location escapes the configured gallery root.', 422);
  const destinationName = `${randomUUID()}${extension}`;
  const destination = path.join(canonicalDirectory, destinationName);
  const relativeImage = path.relative(galleryDirectory, destination).split(path.sep).join('/');
  const previousImage = target.image;
  target.image = relativeImage;
  const validation = validateNoNewManifestErrors(entry.manifest, manifest);
  if (!validation.ok) return validation;

  await resolveCardImage(entry, card);
  try {
    await fs.writeFile(destination, bytes, { flag: 'wx' });
    await writeManifestSafely(entry, manifest);
  } catch (error) {
    await fs.rm(destination, { force: true });
    throw error;
  }
  return { ok: true, cardId, image: relativeImage, replaced: previousImage };
}