import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoloGame, dealThree, findRevealCards, findSet, findSetCandidates, isSet, resolveGameAsset, serializeGame, submitSet } from './game-engine.js';

function buildManifest(extraCategory = false) {
  const categories = [
    ['color', ['red', 'green', 'blue']],
    ['count', ['one', 'two', 'three']],
    ['shape', ['circle', 'diamond', 'wave']],
    ['shade', ['solid', 'striped', 'open']],
  ].map(([id, values]) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    values: values.map((value) => ({ id: value, label: value[0].toUpperCase() + value.slice(1) })),
  }));
  if (extraCategory) categories.push({ id: 'extra', name: 'Extra', values: [
    { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' },
  ] });
  const [color, count, shape, shade] = categories;
  const cards = [];
  for (const a of color.values) for (const b of count.values) for (const c of shape.values) for (const d of shade.values) {
    cards.push({
      id: `card-${cards.length}`,
      image: `images/${cards.length}.svg`,
      features: { color: a.id, count: b.id, shape: c.id, shade: d.id, ...(extraCategory ? { extra: categories[4].values[cards.length % 3].id } : {}) },
      canonicalPath: `C:\\gallery\\images\\${cards.length}.svg`,
    });
  }
  return {
    schemaVersion: 1,
    id: 'test-gallery',
    name: 'Test Gallery',
    categories,
    cards,
  };
}

const selection = {
  categoryIds: ['color', 'count', 'shape', 'shade'],
  valuesByCategory: {
    color: ['red', 'green', 'blue'],
    count: ['one', 'two', 'three'],
    shape: ['circle', 'diamond', 'wave'],
    shade: ['solid', 'striped', 'open'],
  },
};

const constantRandom = () => 0;

function gameFixture(overrides = {}) {
  const manifest = buildManifest(overrides.extraCategory);
  const result = createSoloGame({
    manifest,
    usableCards: manifest.cards,
    allowedRoots: ['C:\\gallery'],
    selection: { ...selection, acknowledgeVariation: true },
    startingBoardSize: 12,
    targetSets: 5,
    random: constantRandom,
    ...overrides,
  });
  assert.equal(result.ok, true);
  return result.game;
}

function findNonSetTriple(cards, categoryIds) {
  for (let first = 0; first < cards.length - 2; first += 1) {
    for (let second = first + 1; second < cards.length - 1; second += 1) {
      for (let third = second + 1; third < cards.length; third += 1) {
        const triple = [cards[first], cards[second], cards[third]];
        if (!isSet(triple, categoryIds)) return triple;
      }
    }
  }
  return null;
}

function noSetBoard(cards, categoryIds, size) {
  const chosen = [];
  for (const card of cards) {
    const trial = [...chosen, card];
    let hasSet = false;
    for (let a = 0; a < trial.length - 2; a += 1) {
      for (let b = a + 1; b < trial.length - 1; b += 1) {
        for (let c = b + 1; c < trial.length; c += 1) {
          if (isSet([trial[a], trial[b], trial[c]], categoryIds)) hasSet = true;
        }
      }
    }
    if (!hasSet) chosen.push(card);
    if (chosen.length === size) return chosen;
  }
  return chosen;
}

test('Set rule requires all same or all different independently for each category', () => {
  const cards = [
    { features: { color: 'red', count: 'one', shape: 'circle', shade: 'solid' } },
    { features: { color: 'red', count: 'two', shape: 'circle', shade: 'striped' } },
    { features: { color: 'red', count: 'three', shape: 'circle', shade: 'open' } },
  ];
  assert.equal(isSet(cards, ['color', 'count', 'shape', 'shade']), true);
  cards[2].features.color = 'green';
  assert.equal(isSet(cards, ['color', 'count', 'shape', 'shade']), false);
  assert.equal(isSet(cards.slice(0, 2), ['color', 'count', 'shape', 'shade']), false);
});

test('creates an 81-card unique-combination deck and opening board', () => {
  const game = gameFixture();
  assert.equal(game.board.length, 12);
  assert.equal(game.remainingDeck.length, 69);
  assert.equal(game.score, 0);
  assert.equal(game.status, 'active');
  assert.equal(new Set([...game.board, ...game.remainingDeck].map((card) => JSON.stringify(game.categoryIds.map((id) => card.features[id])))).size, 81);
});

test('game category order follows the gallery manifest, not selection click order', () => {
  const manifest = buildManifest();
  const reversedSelection = {
    categoryIds: [...selection.categoryIds].reverse(),
    valuesByCategory: selection.valuesByCategory,
  };
  const result = createSoloGame({
    manifest,
    usableCards: manifest.cards,
    selection: reversedSelection,
    random: constantRandom,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.game.categoryIds, manifest.categories.map((category) => category.id));
  assert.deepEqual(result.game.selectedCategoryLabels.map((category) => category.name), manifest.categories.map((category) => category.name));
});

test('unselected variation must be acknowledged before start', () => {
  const manifest = buildManifest(true);
  const result = createSoloGame({ manifest, usableCards: manifest.cards, selection, random: constantRandom });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'unselected-category-variation');
  assert.equal(result.readiness.variationWarnings[0].categoryId, 'extra');
  const acknowledged = createSoloGame({ manifest, usableCards: manifest.cards, selection: { ...selection, acknowledgeVariation: true }, random: constantRandom });
  assert.equal(acknowledged.ok, true);
});

test('valid Set removes three cards, refills, and reaches configured win target', () => {
  const game = gameFixture({ targetSets: 1 });
  const ids = findSet(game.board, game.categoryIds);
  assert.ok(ids);
  const result = submitSet(game, ids);
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.equal(result.matched.length, 3);
  assert.equal(game.score, 1);
  assert.equal(game.board.length, 12);
  assert.equal(game.remainingDeck.length, 66);
  assert.equal(game.status, 'finished');
  assert.equal(game.outcome, 'won');
});

test('invalid triple increments mistakes without changing board or score', () => {
  const game = gameFixture();
  const cards = findNonSetTriple(game.board, game.categoryIds);
  assert.ok(cards);
  const before = game.board.map((card) => card.id);
  const result = submitSet(game, cards.map((card) => card.id));
  assert.equal(result.valid, false);
  assert.equal(game.mistakes, 1);
  assert.equal(game.score, 0);
  assert.deepEqual(game.board.map((card) => card.id), before);
});

test('rejects stale card claims and refuses Deal 3 while a Set is available', () => {
  const game = gameFixture();
  const setIds = findSet(game.board, game.categoryIds);
  const matched = submitSet(game, setIds);
  const stale = submitSet(game, setIds);
  assert.equal(matched.valid, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(game.mistakes, 0);

  const anotherGame = gameFixture();
  if (findSet(anotherGame.board, anotherGame.categoryIds)) {
    const result = dealThree(anotherGame);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  }
});

test('Deal 3 is available only on no-set board and deals up to three cards', () => {
  const game = gameFixture();
  const candidateDeck = [...game.board, ...game.remainingDeck];
  const board = noSetBoard(candidateDeck, game.categoryIds, 12);
  assert.equal(board.length, 12);
  assert.equal(findSet(board, game.categoryIds), null);
  game.board = board;
  game.remainingDeck = candidateDeck.filter((card) => !new Set(board.map((item) => item.id)).has(card.id)).slice(0, 2);
  const result = dealThree(game);
  assert.equal(result.ok, true);
  assert.equal(result.dealt, 2);
  assert.equal(game.board.length, 14);
  assert.equal(game.remainingDeck.length, 0);
});

test('public game snapshots hide canonical paths and expose opaque image URLs only', () => {
  const game = gameFixture();
  const view = serializeGame(game);
  assert.equal(view.board.length, 12);
  assert.equal(view.board[0].features.color.label, 'Red');
  assert.match(view.board[0].imageUrl, /^\/api\/games\/[0-9a-f-]+\/assets\/[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(view).includes('canonicalPath'), false);
  assert.equal(JSON.stringify(view).includes('C:\\gallery'), false);
  const token = view.board[0].imageUrl.split('/').at(-1);
  assert.equal(resolveGameAsset(game, token).id, view.board[0].id);
  assert.equal(resolveGameAsset(game, 'images/0.svg'), null);
});

test('findSetCandidates finds valid triples and reveal helpers choose the cards from them', () => {
  const setCards = [
    { id: 'a', features: { color: 'red', count: 'one', shape: 'circle', shade: 'solid' } },
    { id: 'b', features: { color: 'red', count: 'two', shape: 'circle', shade: 'striped' } },
    { id: 'c', features: { color: 'red', count: 'three', shape: 'circle', shade: 'open' } },
  ];
  const candidates = findSetCandidates(setCards, ['color', 'count', 'shape', 'shade']);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].map((card) => card.id).sort(), ['a', 'b', 'c']);

  const revealOne = findRevealCards(setCards, ['color', 'count', 'shape', 'shade'], ['a']).slice(0, 1);
  assert.equal(revealOne.length, 1);
  assert.deepEqual(revealOne.map((card) => card.id).sort(), ['a']);

  const revealThree = findRevealCards(setCards, ['color', 'count', 'shape', 'shade'], ['a', 'b']);
  assert.deepEqual(revealThree.map((card) => card.id).sort(), ['a', 'b', 'c']);
});
