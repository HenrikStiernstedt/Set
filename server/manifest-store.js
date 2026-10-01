import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const writeQueues = new Map();

/** Serialize writes and reject stale editor snapshots instead of clobbering external edits. */
export async function writeManifestSafely(entry, manifest) {
  const manifestPath = entry?.manifestPath;
  if (typeof manifestPath !== 'string' || !entry?.manifest) throw new Error('Gallery is unavailable.');
  const key = path.resolve(manifestPath);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  writeQueues.set(key, current);
  await previous;
  try {
    const original = await fs.readFile(key);
    let latest;
    try { latest = JSON.parse(original.toString('utf8')); } catch {
      const error = new Error('The gallery manifest is no longer valid. Reload it before editing.');
      error.statusCode = 409;
      throw error;
    }
    if (!isDeepStrictEqual(latest, entry.manifest)) {
      const error = new Error('The gallery changed outside the editor. Reload it before saving again.');
      error.statusCode = 409;
      throw error;
    }

    const directory = path.dirname(key);
    const temporary = path.join(directory, `.set-gallery-${randomUUID()}.tmp`);
    await fs.writeFile(`${key}.bak`, original);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporary, key);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  } finally {
    release();
    if (writeQueues.get(key) === current) writeQueues.delete(key);
  }
}