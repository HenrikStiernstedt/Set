import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { analyzeDeckReadiness } from './gallery-validation.js';

const TOKEN_BYTES = 24;

export function isSet(cards, categoryIds) {
  if (!Array.isArray(cards) || cards.length !== 3 || !Array.isArray(categoryIds) || categoryIds.length !== 4) return false;
  return categoryIds.every((categoryId) => {
    const values = cards.map((card) => card.features?.[categoryId]);
    return values.every((value) => typeof value === 'string')
      && (values[0] === values[1] && values[1] === values[2]
        || values[0] !== values[1] && values[0] !== values[2] && values[1] !== values[2]);
  });
}

export function findSet(cards, categoryIds) {
  for (let first = 0; first < cards.length - 2; first += 1) {
    for (let second = first + 1; second < cards.length - 1; second += 1) {
      for (let third = second + 1; third < cards.length; third += 1) {
        const triple = [cards[first], cards[second], cards[third]];
        if (isSet(triple, categoryIds)) return triple.map((card) => card.id);
      }
    }
  }
  return null;
}

export function findSetCandidates(cards, categoryIds) {
  const triples = [];
  for (let first = 0; first < cards.length - 2; first += 1) {
    for (let second = first + 1; second < cards.length - 1; second += 1) {
      for (let third = second + 1; third < cards.length; third += 1) {
        const triple = [cards[first], cards[second], cards[third]];
        if (isSet(triple, categoryIds)) triples.push(triple);
      }
    }
  }
  return triples;
}

export function findRevealCards(cards, categoryIds) {
  const triples = findSetCandidates(cards, categoryIds);
  return triples[0] ?? [];
}

function shuffle(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function chooseCandidateDeck(manifest, selection, usableCards, random) {
  const readiness = analyzeDeckReadiness(manifest, selection, usableCards, { random });
  if (!readiness.ready) return { readiness, deck: null };
  return { readiness, deck: readiness.candidateDeck };
}

function randomSource(random) {
  if (random) return random;
  return () => randomInt(0, 0x100000000) / 0x100000000;
}

export function createSoloGame({ manifest, usableCards, allowedRoots = [], selection, startingBoardSize = 12, targetSets = 5, random }) {
  if (![12, 15].includes(startingBoardSize)) {
    return { ok: false, status: 400, error: 'Starting board size must be 12 or 15.' };
  }
  if (!Number.isSafeInteger(targetSets) || targetSets < 1 || targetSets > 27) {
    return { ok: false, status: 400, error: 'Target Sets must be between 1 and 27.' };
  }

  const randomValue = randomSource(random);
  const prepared = chooseCandidateDeck(manifest, selection, usableCards, randomValue);
  if (!prepared.readiness.ready) {
    return {
      ok: false,
      status: 422,
      error: 'The selected categories and values do not have complete image coverage.',
      readiness: serializeReadiness(prepared.readiness, manifest),
    };
  }
  if (prepared.readiness.variationWarnings.length && !selection.acknowledgeVariation) {
    return {
      ok: false,
      status: 409,
      code: 'unselected-category-variation',
      error: 'Acknowledge variation in unselected categories before starting.',
      readiness: serializeReadiness(prepared.readiness, manifest),
    };
  }

  const selectedCategorySet = new Set(selection.categoryIds);
  const orderedCategoryIds = manifest.categories.filter((category) => selectedCategorySet.has(category.id)).map((category) => category.id);
  const orderedValuesByCategory = Object.fromEntries(orderedCategoryIds.map((id) => [id, [...selection.valuesByCategory[id]]]));
  const orderedSelection = { categoryIds: orderedCategoryIds, valuesByCategory: orderedValuesByCategory };
  const deck = shuffle(prepared.deck, randomValue);
  const game = {
    id: randomUUID(),
    mode: 'solo',
    galleryId: manifest.id,
    galleryName: manifest.name,
    sourceManifest: manifest,
    sourceCards: usableCards,
    allowedRoots: [...allowedRoots],
    categoryIds: orderedCategoryIds,
    valuesByCategory: orderedValuesByCategory,
    startingBoardSize,
    targetSets,
    createdAt: new Date().toISOString(),
    startedAtMonotonicMs: performance.now(),
    board: deck.slice(0, startingBoardSize),
    remainingDeck: deck.slice(startingBoardSize),
    score: 0,
    mistakes: 0,
    status: 'active',
    outcome: null,
    selectedCategoryLabels: categoryLabels(manifest, orderedSelection),
    assetTokens: new Map(),
    readinessWarnings: prepared.readiness.variationWarnings,
  };
  for (const card of deck) game.assetTokens.set(randomBytes(TOKEN_BYTES).toString('base64url'), card);
  return { ok: true, game };
}

function categoryLabels(manifest, selection) {
  const byCategory = new Map(manifest.categories.map((category) => [category.id, category]));
  return selection.categoryIds.map((categoryId) => {
    const category = byCategory.get(categoryId);
    const byValue = new Map(category.values.map((value) => [value.id, value]));
    return {
      id: categoryId,
      name: category.name,
      values: selection.valuesByCategory[categoryId].map((id) => ({ id, label: byValue.get(id)?.label ?? id })),
    };
  });
}

export function serializeReadiness(readiness, manifest) {
  const labels = new Map();
  for (const category of manifest.categories) {
    labels.set(category.id, new Map(category.values.map((value) => [value.id, value.label])));
  }
  return {
    ready: readiness.ready,
    combinationCount: readiness.combinationCount,
    presentCombinationCount: readiness.presentCombinationCount,
    missingTuples: readiness.missingTuples.map(({ features }) => ({
      features: Object.fromEntries(Object.entries(features).map(([categoryId, valueId]) => [categoryId, {
        id: valueId,
        label: labels.get(categoryId)?.get(valueId) ?? valueId,
      }]))
    })),
    duplicateCandidateCount: readiness.duplicateCandidates.length,
    variationWarnings: readiness.variationWarnings,
  };
}

export function serializeGame(game) {
  return {
    id: game.id,
    mode: game.mode,
    gallery: { id: game.galleryId, name: game.galleryName },
    categories: game.selectedCategoryLabels,
    board: game.board.map((card) => publicCard(game, card)),
    remainingCount: game.remainingDeck.length,
    score: game.score,
    mistakes: game.mistakes,
    targetSets: game.targetSets,
    status: game.status,
    outcome: game.outcome,
    elapsedSeconds: Math.max(0, Math.floor((performance.now() - game.startedAtMonotonicMs) / 1000)),
    canDealThree: game.status === 'active' && game.remainingDeck.length > 0 && !findSet(game.board, game.categoryIds),
    readinessWarnings: game.readinessWarnings,
  };
}

function publicCard(game, card) {
  const categoryInfo = new Map(game.selectedCategoryLabels.map((category) => [category.id, category]));
  return {
    id: card.id,
    imageUrl: `/api/games/${game.id}/assets/${tokenForCard(game, card.id)}`,
    features: Object.fromEntries(game.categoryIds.map((categoryId) => {
      const info = categoryInfo.get(categoryId);
      const value = info.values.find((entry) => entry.id === card.features[categoryId]);
      return [categoryId, { id: card.features[categoryId], label: value?.label ?? card.features[categoryId] }];
    })),
  };
}

function tokenForCard(game, cardId) {
  for (const [token, card] of game.assetTokens) if (card.id === cardId) return token;
  return '';
}

export function submitSet(game, cardIds) {
  if (game.status !== 'active') return { ok: false, status: 409, error: 'This game is already over.' };
  if (!Array.isArray(cardIds) || cardIds.length !== 3 || new Set(cardIds).size !== 3) {
    return { ok: false, status: 400, error: 'Select three different cards.' };
  }
  const boardById = new Map(game.board.map((card) => [card.id, card]));
  const cards = cardIds.map((id) => boardById.get(id));
  if (cards.some((card) => !card)) return { ok: false, status: 409, error: 'Those cards are no longer on the board.' };

  if (!isSet(cards, game.categoryIds)) {
    game.mistakes += 1;
    return { ok: true, valid: false, game: serializeGame(game) };
  }

  const matchedIds = new Set(cardIds);
  const replacedSlots = game.board.map((card, index) => matchedIds.has(card.id) ? index : -1).filter((index) => index >= 0);
  const survivors = game.board.filter((card) => !matchedIds.has(card.id));
  const replacements = game.remainingDeck.splice(0, Math.min(3, game.remainingDeck.length));
  for (let index = 0; index < replacements.length; index += 1) survivors.splice(replacedSlots[index], 0, replacements[index]);
  game.board = survivors;
  game.score += 1;

  if (game.score >= game.targetSets) {
    game.status = 'finished';
    game.outcome = 'won';
  } else if (game.remainingDeck.length === 0 && !findSet(game.board, game.categoryIds)) {
    game.status = 'finished';
    game.outcome = 'completed';
  }
  return {
    ok: true,
    valid: true,
    matched: cards.map((card) => publicCard(game, card)),
    game: serializeGame(game),
  };
}

export function dealThree(game) {
  if (game.status !== 'active') return { ok: false, status: 409, error: 'This game is already over.' };
  if (findSet(game.board, game.categoryIds)) return { ok: false, status: 409, error: 'A Set is still available on the board.' };
  if (game.remainingDeck.length === 0) {
    game.status = 'finished';
    game.outcome = 'completed';
    return { ok: true, dealt: 0, game: serializeGame(game) };
  }
  const additions = game.remainingDeck.splice(0, Math.min(3, game.remainingDeck.length));
  game.board.push(...additions);
  if (game.remainingDeck.length === 0 && !findSet(game.board, game.categoryIds)) {
    game.status = 'finished';
    game.outcome = 'completed';
  }
  return { ok: true, dealt: additions.length, game: serializeGame(game) };
}

export function resolveGameAsset(game, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 64) return null;
  return game.assetTokens.get(token) ?? null;
}
