import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGalleryCatalog } from './gallery-service.js';
import { createSetGalleryServer } from './index.js';
import { assignGalleryCardValues, replaceGalleryCardImage } from './editor-mutations.js';

async function makeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'set-gallery-editor-'));
  const directory = path.join(root, 'animals');
  await fs.mkdir(path.join(directory, 'images'), { recursive: true });
  await fs.writeFile(path.join(directory, 'images', 'original.png'), 'existing fixture');
  const manifest = {
    schemaVersion: 1,
    id: 'animals',
    name: 'Animals',
    categories: [
      { id: 'shape', name: 'Shape', values: [{ id: 'round', label: 'Round' }, { id: 'square', label: 'Square' }] },
      { id: 'color', name: 'Color', values: [{ id: 'red', label: 'Red' }, { id: 'blue', label: 'Blue' }] },
    ],
    cards: [{
      id: 'card-one',
      image: 'images/original.png',
      features: { shape: 'round', color: 'red' },
      sourceName: 'original_source.png',
      customMetadata: { keep: true },
    }],
  };
  const manifestPath = path.join(directory, 'set-gallery.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const catalog = createGalleryCatalog([root]);
  return { root, directory, manifest, manifestPath, catalog };
}

const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);

test('manual assignment requires conflict choice, validates values, and keeps other card features', async (t) => {
  const fixture = await makeFixture(t);
  const entry = await fixture.catalog.getEntry('animals');
  const conflict = await assignGalleryCardValues(entry, {
    cardId: 'card-one', assignments: { shape: 'square' },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.conflicts[0].currentValueId, 'round');
  assert.equal(JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8')).cards[0].features.shape, 'round');

  const applied = await assignGalleryCardValues(entry, {
    cardId: 'card-one', assignments: { shape: 'square' }, decisions: { shape: 'overwrite' },
  });
  assert.equal(applied.changed, true);
  const saved = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
  assert.equal(saved.cards[0].features.shape, 'square');
  assert.equal(saved.cards[0].features.color, 'red');
  assert.deepEqual(saved.cards[0].customMetadata, { keep: true });
  assert.equal(saved.cards[0].sourceName, 'original_source.png');
  assert.ok(await fs.stat(`${fixture.manifestPath}.bak`));
  await assert.rejects(assignGalleryCardValues({ ...entry, manifest: saved }, {
    cardId: 'card-one', assignments: { shape: 'unknown' },
  }), { statusCode: 422 });
});

test('image replacement changes only image reference and rejects mismatched file contents', async (t) => {
  const fixture = await makeFixture(t);
  const entry = await fixture.catalog.getEntry('animals');
  const replaced = await replaceGalleryCardImage(entry, {
    cardId: 'card-one', name: 'new-image.png', data: pngBytes.toString('base64'),
  });
  const saved = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
  assert.notEqual(saved.cards[0].image, 'images/original.png');
  assert.match(saved.cards[0].image, /^images\/editor-replacements\/[0-9a-f-]+\.png$/);
  assert.deepEqual({ ...saved.cards[0], image: 'images/original.png' }, fixture.manifest.cards[0]);
  assert.deepEqual(await fs.readFile(path.join(fixture.directory, saved.cards[0].image)), pngBytes);
  assert.equal(replaced.replaced, 'images/original.png');
  await assert.rejects(replaceGalleryCardImage({ ...entry, manifest: saved }, {
    cardId: 'card-one', name: 'bad.png', data: Buffer.from('not an image').toString('base64'),
  }), { statusCode: 415 });
});

test('manifest edits refuse to overwrite an external change', async (t) => {
  const fixture = await makeFixture(t);
  const staleEntry = await fixture.catalog.getEntry('animals');
  const external = structuredClone(fixture.manifest);
  external.name = 'Edited outside the app';
  await fs.writeFile(fixture.manifestPath, JSON.stringify(external));
  await assert.rejects(assignGalleryCardValues(staleEntry, {
    cardId: 'card-one', assignments: { shape: 'square' }, decisions: { shape: 'overwrite' },
  }), { statusCode: 409 });
  assert.equal(JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8')).name, 'Edited outside the app');
});

test('loopback editor endpoints persist assignments and image replacements', async (t) => {
  const fixture = await makeFixture(t);
  const server = createSetGalleryServer({ galleryRoots: [fixture.root] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const assignment = await fetch(`${base}/api/galleries/animals/editor/assignments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId: 'card-one', assignments: { shape: 'square' } }),
  });
  assert.equal(assignment.status, 409);
  assert.ok((await assignment.json()).conflicts.length);
  const confirmedAssignment = await fetch(`${base}/api/galleries/animals/editor/assignments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId: 'card-one', assignments: { shape: 'square' }, decisions: { shape: 'overwrite' } }),
  });
  assert.equal(confirmedAssignment.status, 200);
  assert.equal((await confirmedAssignment.json()).saved, true);

  const replacement = await fetch(`${base}/api/galleries/animals/editor/cards/card-one/image`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'replacement.png', data: pngBytes.toString('base64') }),
  });
  assert.equal(replacement.status, 200);
  assert.equal((await replacement.json()).saved, true);
  const saved = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
  assert.equal(saved.cards[0].features.shape, 'square');
  assert.equal(saved.cards[0].features.color, 'red');
  assert.equal(saved.cards[0].sourceName, 'original_source.png');
});
