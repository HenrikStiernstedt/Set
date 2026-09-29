import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGalleryCatalog } from './gallery-service.js';
import { createSetGalleryServer } from './index.js';
import { applyGalleryFilenameTags, parseFilenameTags, previewGalleryFilenameTags } from './filename-tagging.js';

function categories() {
  return [
    { id: 'color', name: 'Color', values: [{ id: 'blue', label: 'Blue' }, { id: 'red', label: 'Red' }, { id: 'green', label: 'Green' }] },
    { id: 'hedgehogs', name: 'Hedgehogs', values: [{ id: 'h1', label: 'One' }, { id: 'h2', label: 'Two' }, { id: 'h3', label: 'Three' }] },
    { id: 'foxes', name: 'Foxes', values: [{ id: 'f0', label: 'None' }, { id: 'f1', label: 'One' }, { id: 'f2', label: 'Two' }] },
    { id: 'border', name: 'Border', values: [{ id: 'solid', label: 'Solid' }, { id: 'dotted', label: 'Dotted' }, { id: 'none', label: 'None' }] },
  ];
}

test('filename parser removes extension and hyphen suffix, then ignores numeric and exact vN tokens', () => {
  const parsed = parseFilenameTags('Blue_A_v1_Diamond_Rare_0001-8f3a9c.png', {
    delimiter: '_', slots: [{ categoryId: 'color', position: 1 }],
  }, [{ id: 'color', name: 'Color', values: [{ id: 'blue', label: 'Blue' }] }]);
  assert.equal(parsed.parsedStem, 'Blue_A_v1_Diamond_Rare_0001');
  assert.equal(parsed.ignoredSuffix, '8f3a9c');
  assert.deepEqual(parsed.tokens, ['Blue', 'A', 'Diamond', 'Rare']);
  assert.deepEqual(parsed.ignoredTokens, ['v1', '0001']);
  assert.deepEqual(parsed.assignments, { color: 'blue' });

  const nearMiss = parseFilenameTags('v1blue_n4-V2.png', { delimiter: '_', slots: [ { categoryId: 'c', position: 1 }, { categoryId: 'n', position: 2 } ] }, [
    { id: 'c', name: 'C', values: [{ id: 'v1blue', label: 'V1Blue' }] },
    { id: 'n', name: 'N', values: [{ id: 'n4', label: 'N4' }] },
  ]);
  assert.deepEqual(nearMiss.tokens, ['v1blue', 'n4']);
  assert.deepEqual(nearMiss.assignments, { c: 'v1blue', n: 'n4' });
  assert.deepEqual(nearMiss.ignoredTokens, []);
});

async function makeGallery(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'set-filename-tags-'));
  const root = path.join(temporary, 'galleries');
  const galleryDirectory = path.join(root, 'hedgehogs');
  await fs.mkdir(path.join(galleryDirectory, 'images'), { recursive: true });
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const filename = 'blue_1h_0f_solid.png';
  await fs.writeFile(path.join(galleryDirectory, 'images', filename), Buffer.from('image bytes'));
  const manifest = {
    schemaVersion: 1,
    id: 'hedgehogs',
    name: 'Hedgehogs',
    filenameTagging: {
      enabled: true,
      delimiter: '_',
      slots: [
        { categoryId: 'color', position: 1 },
        { categoryId: 'hedgehogs', position: 2 },
        { categoryId: 'foxes', position: 3 },
        { categoryId: 'border', position: 4 },
      ],
    },
    categories: categories(),
    cards: [{ id: 'card-existing', image: `images/${filename}`, features: { color: 'blue', hedgehogs: 'one', foxes: 'none', border: 'solid' } }],
  };
  const manifestPath = path.join(galleryDirectory, 'set-gallery.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const catalog = createGalleryCatalog([root]);
  const entry = await catalog.getEntry('hedgehogs');
  return { entry, manifestPath, galleryDirectory, filename };
}

test('preview surfaces unknown filename tokens and current assignment conflicts without changing manifest', async (t) => {
  const fixture = await makeGallery(t);
  const before = await fs.readFile(fixture.manifestPath, 'utf8');
  const preview = await previewGalleryFilenameTags(fixture.entry);
  assert.equal(preview.totalDiscovered, 1);
  assert.equal(preview.files.length, 1);
  assert.equal(preview.files[0].existingCardId, 'card-existing');
  assert.equal(preview.files[0].outcome, 'matched-needs-review');
  assert.ok(preview.files[0].issues.some((issue) => issue.code === 'unknown-value' && issue.categoryId === 'hedgehogs' && issue.token === '1h'));
  assert.ok(preview.files[0].issues.some((issue) => issue.code === 'unknown-value' && issue.categoryId === 'foxes' && issue.token === '0f'));
  assert.equal(await fs.readFile(fixture.manifestPath, 'utf8'), before);
});

test('apply maps unknown aliases, overwrites only with explicit decisions, and is idempotent', async (t) => {
  const fixture = await makeGallery(t);
  const assetPath = `images/${fixture.filename}`;
  const decisions = {
    [assetPath]: { hedgehogs: 'overwrite', foxes: 'overwrite' },
    valueResolutions: { [assetPath]: { hedgehogs: 'h1', foxes: 'f0' } },
  };
  const result = await applyGalleryFilenameTags(fixture.entry, decisions);
  assert.equal(result.ok, true);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.createdCount, 0);
  const saved = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
  assert.equal(saved.cards.length, 1);
  assert.equal(saved.cards[0].features.hedgehogs, 'h1');
  assert.equal(saved.cards[0].features.foxes, 'f0');
  assert.deepEqual(saved.categories[1].values[0].aliases, ['1h']);
  assert.deepEqual(saved.categories[2].values[0].aliases, ['0f']);
  assert.equal(await fs.readFile(`${fixture.manifestPath}.bak`, 'utf8').then((value) => value.includes('"one"')), true);

  const refreshedCatalog = createGalleryCatalog([path.dirname(path.dirname(fixture.galleryDirectory))]);
  const refreshed = await refreshedCatalog.getEntry('hedgehogs');
  const secondPreview = await previewGalleryFilenameTags(refreshed);
  assert.equal(secondPreview.files[0].issues.length, 0);
  assert.equal(secondPreview.files[0].conflicts.length, 0);
  const second = await applyGalleryFilenameTags(refreshed);
  assert.equal(second.ok, true);
  assert.equal(second.createdCount, 0);
  assert.equal(second.updatedCount, 0);
});

test('unresolved token-to-value mapping does not partially write the manifest', async (t) => {
  const fixture = await makeGallery(t);
  const before = await fs.readFile(fixture.manifestPath, 'utf8');
  const result = await applyGalleryFilenameTags(fixture.entry, {});
  assert.equal(result.ok, false);
  assert.equal(result.applied, false);
  assert.ok(result.unresolved.length > 0);
  assert.equal(await fs.readFile(fixture.manifestPath, 'utf8'), before);
});

test('one global token mapping tags every matching image in the gallery batch', async (t) => {
  const fixture = await makeGallery(t);
  const secondName = 'green_1h_0f_solid.png';
  await fs.writeFile(path.join(fixture.galleryDirectory, 'images', secondName), Buffer.from('second image bytes'));
  const preview = await previewGalleryFilenameTags(fixture.entry);
  assert.equal(preview.files.length, 2);
  const decisions = {
    valueResolutions: {},
    globalValueResolutions: { hedgehogs: { '1h': 'h1' }, foxes: { '0f': 'f0' } },
  };
  decisions[`images/${fixture.filename}`] = { hedgehogs: 'overwrite', foxes: 'overwrite' };
  const result = await applyGalleryFilenameTags(fixture.entry, decisions);
  assert.equal(result.ok, true);
  assert.equal(result.createdCount, 1);
  const saved = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
  assert.equal(saved.cards.length, 2);
  assert.equal(saved.cards.find((card) => card.image.endsWith(secondName)).features.hedgehogs, 'h1');
});

test('preview accepts an invalid existing card-feature record so filename tagging can repair it', async (t) => {
  const fixture = await makeGallery(t);
  const manifest = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
  manifest.cards[0].features.hedgehogs = 'One';
  await fs.writeFile(fixture.manifestPath, JSON.stringify(manifest));
  const catalog = createGalleryCatalog([path.dirname(path.dirname(fixture.galleryDirectory))]);
  const entry = await catalog.getEntry('hedgehogs');
  const preview = await previewGalleryFilenameTags(entry);
  assert.equal(preview.files.length, 1);
  assert.equal(preview.files[0].existingCardId, 'card-existing');
});

test('local filename preview/apply endpoints persist tags and stay loopback protected', async (t) => {
  const fixture = await makeGallery(t);
  const server = createSetGalleryServer({ galleryRoots: [path.dirname(path.dirname(fixture.galleryDirectory))] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const previewResponse = await fetch(`${base}/api/galleries/hedgehogs/editor/filename-preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.files.length, 1);
  assert.equal(preview.files[0].assetPath, `images/${fixture.filename}`);

  const assetPath = preview.files[0].assetPath;
  const applyResponse = await fetch(`${base}/api/galleries/hedgehogs/editor/filename-apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decisions: {
      [assetPath]: { hedgehogs: 'overwrite', foxes: 'overwrite' },
      valueResolutions: { [assetPath]: { hedgehogs: 'h1', foxes: 'f0' } },
    } }),
  });
  assert.equal(applyResponse.status, 200);
  assert.equal((await applyResponse.json()).applied, true);
});
