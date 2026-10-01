import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGalleryCatalog } from './gallery-service.js';
import { createSetGalleryServer } from './index.js';

async function makeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'set-gallery-test-'));
  const root = path.join(temporary, 'allowed');
  const galleryDirectory = path.join(root, 'animals');
  await fs.mkdir(path.join(galleryDirectory, 'images'), { recursive: true });
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const categories = ['color', 'number', 'shape', 'shade'].map((id) => ({
    id,
    name: id,
    values: ['one', 'two', 'three'].map((value) => ({ id: value, label: value })),
  }));
  const manifest = { schemaVersion: 1, id: 'animals', name: 'Animals', categories, cards: [] };
  for (let index = 0; index < 81; index += 1) {
    const digits = [Math.floor(index / 27), Math.floor(index / 9) % 3, Math.floor(index / 3) % 3, index % 3];
    const cardId = `card-${String(index).padStart(3, '0')}`;
    const image = `images/${cardId}.png`;
    await fs.writeFile(path.join(galleryDirectory, image), Buffer.from('fixture image bytes'));
    manifest.cards.push({
      id: cardId,
      image,
      features: Object.fromEntries(categories.map((category, categoryIndex) => [category.id, category.values[digits[categoryIndex]].id])),
    });
  }
  await fs.writeFile(path.join(galleryDirectory, 'set-gallery.json'), JSON.stringify(manifest));
  return { temporary, root, galleryDirectory, manifest };
}

test('catalog safely loads allowed manifests and only usable supported images', async (t) => {
  const fixture = await makeFixture(t);
  const catalog = createGalleryCatalog([fixture.root]);
  const entry = await catalog.getEntry('animals');
  assert.ok(entry);
  assert.equal(entry.validation.valid, true);
  assert.equal(entry.usableCards.length, 81);
  assert.ok(entry.usableCards.every((card) => path.isAbsolute(card.canonicalPath)));
  assert.equal((await catalog.getAvailable())[0].readiness.defaultSetup.ready, true);

  const exposed = JSON.stringify(await catalog.getAvailable());
  assert.equal(exposed.includes(fixture.temporary), false);
  assert.equal(exposed.includes('card-000.png'), false);
  assert.equal(exposed.includes('images/'), false);
});

test('catalog excludes traversal, escaping symlinks, missing files, and unsupported formats', async (t) => {
  const fixture = await makeFixture(t);
  const outsideImage = path.join(fixture.temporary, 'secret.png');
  await fs.writeFile(outsideImage, 'outside');
  fixture.manifest.cards[0].image = path.relative(fixture.galleryDirectory, outsideImage);
  fixture.manifest.cards[1].image = 'missing.webp';
  fixture.manifest.cards[2].image = 'unsupported.bmp';
  fixture.manifest.cards[3].image = 'images/escape.png';
  try {
    await fs.symlink(outsideImage, path.join(fixture.galleryDirectory, 'images', 'escape.png'));
  } catch {
    t.diagnostic('Symlink creation is unavailable on this host; traversal containment checks still run.');
  }
  await fs.writeFile(path.join(fixture.galleryDirectory, 'set-gallery.json'), JSON.stringify(fixture.manifest));

  const catalog = createGalleryCatalog([fixture.root]);
  const entry = await catalog.getEntry('animals');
  assert.equal(entry.usableCards.length, 77);
  const codes = new Set(entry.fileDiagnostics.filter((file) => file.status === 'excluded').map((file) => file.code));
  assert.ok(codes.has('path-outside-root'));
  assert.ok(codes.has('missing-image'));
  assert.ok(codes.has('unsupported-image'));
  assert.equal(JSON.stringify(entry.fileDiagnostics).includes(fixture.temporary), false);
});

test('gallery endpoints preserve health routes, enforce local access, and redact path details', async (t) => {
  const fixture = await makeFixture(t);
  const server = createSetGalleryServer({ galleryRoots: [fixture.root] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  const availableResponse = await fetch(`${base}/api/galleries/available`);
  const availableBody = await availableResponse.text();
  assert.equal(availableResponse.status, 200);
  assert.equal(availableBody.includes(fixture.temporary), false);
  assert.equal(availableBody.includes('card-000.png'), false);
  assert.equal(JSON.parse(availableBody).galleries[0].id, 'animals');

  const localResponse = await fetch(`${base}/api/galleries`);
  const localBody = await localResponse.text();
  assert.equal(localResponse.status, 200);
  assert.equal(localBody.includes(fixture.temporary), false);
  assert.equal(JSON.parse(localBody).galleries[0].counts.usableCards, 81);

  const validation = await fetch(`${base}/api/galleries/animals/validate`, { method: 'POST' });
  assert.equal(validation.status, 200);
  assert.equal((await validation.json()).gallery.validation.valid, true);
});

test('editor view identifies duplicate feature assignments after card tagging changes', async (t) => {
  const fixture = await makeFixture(t);
  const first = fixture.manifest.cards[0];
  const second = fixture.manifest.cards[1];
  assert.notDeepEqual(first.features, second.features);
  second.features = { ...first.features };
  await fs.writeFile(path.join(fixture.galleryDirectory, 'set-gallery.json'), JSON.stringify(fixture.manifest));

  const catalog = createGalleryCatalog([fixture.root]);
  const view = await catalog.getEditorView('animals');
  assert.deepEqual(view.duplicateFeatureCards.map((card) => card.id), [first.id, second.id]);
  assert.deepEqual(view.duplicateFeatureCards[0].duplicateFeatureIds, [first.id, second.id]);
  assert.equal(view.duplicateFeatureCards[0].duplicateFeatures, true);
});

test('solo game API validates setup, starts a game, serves an opaque image, and scores a Set', async (t) => {
  const fixture = await makeFixture(t);
  const server = createSetGalleryServer({ galleryRoots: [fixture.root] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const selection = {
    categoryIds: fixture.manifest.categories.map((category) => category.id),
    valuesByCategory: Object.fromEntries(fixture.manifest.categories.map((category) => [category.id, category.values.map((value) => value.id)])),
  };

  const readinessResponse = await fetch(`${base}/api/galleries/animals/readiness`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection }),
  });
  assert.equal(readinessResponse.status, 200);
  const readiness = await readinessResponse.json();
  assert.equal(readiness.readiness.ready, true);
  assert.equal(readiness.readiness.combinationCount, 81);

  const createdResponse = await fetch(`${base}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ galleryId: 'animals', selection, startingBoardSize: 12, targetSets: 1 }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.game.board.length, 12);
  assert.equal(created.game.remainingCount, 69);
  const imageUrl = created.game.board[0].imageUrl;
  assert.match(imageUrl, new RegExp(`^/api/games/${created.game.id}/assets/[A-Za-z0-9_-]+$`));
  assert.equal(JSON.stringify(created.game).includes(fixture.temporary), false);
  assert.equal(JSON.stringify(created.game).includes('card-000.png'), false);
  const imageResponse = await fetch(new URL(imageUrl, base));
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get('content-type'), /^image\/png/);
  assert.equal(imageResponse.headers.get('cache-control'), 'private, no-store');

  const board = created.game.board;
  let setIds;
  for (let first = 0; first < board.length - 2 && !setIds; first += 1) {
    for (let second = first + 1; second < board.length - 1 && !setIds; second += 1) {
      for (let third = second + 1; third < board.length; third += 1) {
        const selected = [board[first], board[second], board[third]];
        const valid = selection.categoryIds.every((categoryId) => {
          const values = selected.map((card) => card.features[categoryId].id);
          return values.every((value) => value === values[0]) || new Set(values).size === 3;
        });
        if (valid) { setIds = selected.map((card) => card.id); break; }
      }
    }
  }
  assert.ok(setIds);
  const matchResponse = await fetch(`${base}/api/games/${created.game.id}/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardIds: setIds }),
  });
  assert.equal(matchResponse.status, 200);
  const matched = await matchResponse.json();
  assert.equal(matched.valid, true);
  assert.equal(matched.game.score, 1);
  assert.equal(matched.game.status, 'finished');
  assert.equal(matched.game.outcome, 'won');

  const restartResponse = await fetch(`${base}/api/games/${created.game.id}/restart`, { method: 'POST', body: '{}' });
  assert.equal(restartResponse.status, 201);
  const restarted = await restartResponse.json();
  assert.notEqual(restarted.game.id, created.game.id);
  assert.equal(restarted.game.score, 0);
  assert.equal(restarted.game.mistakes, 0);
  assert.equal(restarted.game.board.length, 12);
  const oldGameResponse = await fetch(`${base}/api/games/${created.game.id}`);
  assert.equal(oldGameResponse.status, 404);
});

test('catalog reports duplicate gallery IDs as invalid instead of choosing an arbitrary folder', async (t) => {
  const fixture = await makeFixture(t);
  const secondDirectory = path.join(fixture.root, 'duplicate');
  await fs.mkdir(secondDirectory, { recursive: true });
  await fs.writeFile(path.join(secondDirectory, 'set-gallery.json'), JSON.stringify({
    ...fixture.manifest,
    name: 'Duplicate gallery ID',
    cards: [],
  }));

  const catalog = createGalleryCatalog([fixture.root]);
  assert.equal(await catalog.getEntry('animals'), null);
  assert.equal((await catalog.getAvailable()).length, 0);
  const local = await catalog.getEntries();
  assert.equal(local.length, 2);
  assert.ok(local.every((entry) => entry.validation.errors.some((error) => error.code === 'duplicate-gallery-id')));
});
