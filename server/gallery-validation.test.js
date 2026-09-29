import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDeckReadiness,
  rankValueAlternatives,
  validateGalleryManifest,
} from './gallery-validation.js';

function makeManifest(valueCount = 3, extras = true) {
  const categories = ['color', 'number', 'symbol', 'shade'].map((id, categoryIndex) => ({
    id,
    name: id,
    values: Array.from({ length: valueCount }, (_, index) => ({ id: `v${index + 1}`, label: `${id} ${index + 1}` })),
  }));
  if (extras) categories.push({
    id: 'texture',
    name: 'Texture',
    values: [{ id: 'smooth', label: 'Smooth' }, { id: 'rough', label: 'Rough' }],
  });
  return { schemaVersion: 1, id: 'fixture-gallery', name: 'Fixture', categories, cards: [] };
}

function addCompleteDeck(manifest, { extraVariation = false } = {}) {
  const [a, b, c, d] = manifest.categories;
  for (const av of a.values.slice(0, 3)) {
    for (const bv of b.values.slice(0, 3)) {
      for (const cv of c.values.slice(0, 3)) {
        for (const dv of d.values.slice(0, 3)) {
          const index = manifest.cards.length;
          manifest.cards.push({
            id: `card-${String(index).padStart(3, '0')}`,
            image: `images/card-${index}.png`,
            features: {
              [a.id]: av.id,
              [b.id]: bv.id,
              [c.id]: cv.id,
              [d.id]: dv.id,
              ...(manifest.categories[4] ? { texture: extraVariation && index % 2 ? 'rough' : 'smooth' } : {}),
            },
          });
        }
      }
    }
  }
}

function selectionFor(manifest) {
  const categories = manifest.categories.slice(0, 4);
  return {
    categoryIds: categories.map((category) => category.id),
    valuesByCategory: Object.fromEntries(categories.map((category) => [category.id, category.values.slice(0, 3).map((value) => value.id)])),
  };
}

test('manifest validation allows authoring-incomplete categories and partial card features', () => {
  const manifest = makeManifest();
  manifest.categories[0].values = [];
  manifest.cards = [{ id: 'partial-card', image: 'images/a.webp', features: { color: 'unknown' } }];
  const result = validateGalleryManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(!result.errors.some((error) => error.code === 'category-not-game-eligible'));
  assert.ok(result.errors.some((error) => error.code === 'unknown-value'));

  manifest.cards[0].features = {};
  assert.equal(validateGalleryManifest(manifest).valid, true);
});

test('manifest validation rejects unsafe and duplicate IDs, malformed schema, and alias collisions', () => {
  const manifest = makeManifest();
  manifest.schemaVersion = 2;
  manifest.cards = [
    { id: '../escape', image: 'x.png', features: {} },
    { id: 'card', image: 'x.png', features: {} },
    { id: 'card', image: 'x.png', features: {} },
  ];
  manifest.categories[0].values[1].aliases = [manifest.categories[0].values[0].label.toUpperCase()];
  const result = validateGalleryManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'unsupported-schema'));
  assert.ok(result.errors.some((error) => error.code === 'invalid-id'));
  assert.ok(result.errors.some((error) => error.code === 'duplicate-card-id'));
  assert.ok(result.errors.some((error) => error.code === 'alias-collision'));
});

test('readiness enumerates 81 selected tuples, duplicate candidates, and unselected variation warnings', () => {
  const manifest = makeManifest();
  addCompleteDeck(manifest, { extraVariation: true });
  manifest.cards.push({ ...manifest.cards[0], id: 'variant-card', features: { ...manifest.cards[0].features, texture: 'rough' } });
  const result = analyzeDeckReadiness(manifest, selectionFor(manifest), manifest.cards, { random: () => 0 });
  assert.equal(result.ready, true);
  assert.equal(result.combinationCount, 81);
  assert.equal(result.candidateDeck.length, 81);
  assert.equal(result.duplicateCandidates.length, 1);
  assert.deepEqual(result.variationWarnings[0].values.map((value) => value.id), ['rough', 'smooth']);
  assert.equal(result.candidateDeck.some((card) => card.features.texture === 'rough'), true);
});

test('readiness reports each missing tuple and validates exact selection cardinality', () => {
  const manifest = makeManifest();
  addCompleteDeck(manifest);
  manifest.cards.pop();
  const result = analyzeDeckReadiness(manifest, selectionFor(manifest), manifest.cards, { random: () => 0 });
  assert.equal(result.ready, false);
  assert.equal(result.missingTuples.length, 1);
  assert.equal(result.presentCombinationCount, 80);

  const invalid = analyzeDeckReadiness(manifest, { categoryIds: ['color'], valuesByCategory: {} }, manifest.cards);
  assert.equal(invalid.combinationCount, 0);
  assert.equal(invalid.errors[0].code, 'invalid-category-selection');
});

test('alternative value subsets are ranked by coverage with stable result metadata', () => {
  const manifest = makeManifest(4, false);
  addCompleteDeck(manifest);
  const current = selectionFor(manifest);
  const result = rankValueAlternatives(manifest, current.categoryIds, current.valuesByCategory, manifest.cards, { limit: 5 });
  assert.equal(result.errors.length, 0);
  assert.ok(result.evaluatedCount > 0);
  assert.ok(result.recommendations.length <= 5);
  assert.ok(result.recommendations.every((item) => item.combinationCount === 81 && item.missingCount === 81 - item.presentCombinationCount));
  for (let index = 1; index < result.recommendations.length; index += 1) {
    assert.ok(result.recommendations[index - 1].presentCombinationCount >= result.recommendations[index].presentCombinationCount);
  }
});
