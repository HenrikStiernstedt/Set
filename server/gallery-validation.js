import path from 'node:path';

export const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED_IDS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function addError(errors, code, location, message) {
  errors.push({ code, location, message });
}

function normalizedAlias(value) {
  return value.normalize('NFKC').toLocaleLowerCase('und');
}

/** Pure structural validation. Partial feature assignments and empty categories are authoring-valid. */
export function validateGalleryManifest(manifest) {
  const errors = [];
  if (!isRecord(manifest)) {
    return { valid: false, errors: [{ code: 'invalid-manifest', location: '', message: 'Manifest must be a JSON object.' }] };
  }

  if (manifest.schemaVersion !== 1) addError(errors, 'unsupported-schema', 'schemaVersion', 'schemaVersion must be 1.');
  if (!isSafeGalleryId(manifest.id)) addError(errors, 'invalid-id', 'id', 'Gallery ID must be a safe lowercase identifier.');
  if (!isNonEmptyString(manifest.name)) addError(errors, 'invalid-name', 'name', 'Gallery name must be a non-empty string.');
  if (!Array.isArray(manifest.categories)) addError(errors, 'invalid-categories', 'categories', 'Categories must be an array.');
  if (!Array.isArray(manifest.cards)) addError(errors, 'invalid-cards', 'cards', 'Cards must be an array.');

  const categoryById = new Map();
  const valueIdsByCategory = new Map();
  const categories = Array.isArray(manifest.categories) ? manifest.categories : [];
  categories.forEach((category, categoryIndex) => {
    const location = `categories.${categoryIndex}`;
    if (!isRecord(category)) {
      addError(errors, 'invalid-category', location, 'Category must be an object.');
      return;
    }
    if (!isSafeGalleryId(category.id)) addError(errors, 'invalid-id', `${location}.id`, 'Category ID must be a safe lowercase identifier.');
    else if (categoryById.has(category.id)) addError(errors, 'duplicate-category-id', `${location}.id`, 'Category IDs must be unique.');
    else categoryById.set(category.id, category);
    if (!isNonEmptyString(category.name)) addError(errors, 'invalid-name', `${location}.name`, 'Category name must be a non-empty string.');
    if (!Array.isArray(category.values)) {
      addError(errors, 'invalid-values', `${location}.values`, 'Category values must be an array.');
      valueIdsByCategory.set(category.id, new Set());
      return;
    }

    const valueIds = new Set();
    const aliases = new Map();
    category.values.forEach((value, valueIndex) => {
      const valueLocation = `${location}.values.${valueIndex}`;
      if (!isRecord(value)) {
        addError(errors, 'invalid-value', valueLocation, 'Value must be an object.');
        return;
      }
      if (!isSafeGalleryId(value.id)) addError(errors, 'invalid-id', `${valueLocation}.id`, 'Value ID must be a safe lowercase identifier.');
      else if (valueIds.has(value.id)) addError(errors, 'duplicate-value-id', `${valueLocation}.id`, 'Value IDs must be unique within a category.');
      else valueIds.add(value.id);
      if (!isNonEmptyString(value.label)) addError(errors, 'invalid-label', `${valueLocation}.label`, 'Value label must be a non-empty string.');
      if (value.aliases !== undefined && (!Array.isArray(value.aliases) || value.aliases.some((alias) => !isNonEmptyString(alias)))) {
        addError(errors, 'invalid-aliases', `${valueLocation}.aliases`, 'Aliases must be an array of non-empty strings.');
      }
      const aliasesForValue = [value.id, value.label, ...(Array.isArray(value.aliases) ? value.aliases : [])].filter(isNonEmptyString);
      for (const alias of aliasesForValue) {
        const key = normalizedAlias(alias);
        const previous = aliases.get(key);
        if (previous && previous !== value.id) {
          addError(errors, 'alias-collision', `${valueLocation}.aliases`, 'Value IDs, labels, and aliases must not collide within a category.');
          break;
        }
        aliases.set(key, value.id);
      }
    });
    valueIdsByCategory.set(category.id, valueIds);
  });

  const cardIds = new Set();
  const cards = Array.isArray(manifest.cards) ? manifest.cards : [];
  cards.forEach((card, cardIndex) => {
    const location = `cards.${cardIndex}`;
    if (!isRecord(card)) {
      addError(errors, 'invalid-card', location, 'Card must be an object.');
      return;
    }
    if (!isSafeGalleryId(card.id)) addError(errors, 'invalid-id', `${location}.id`, 'Card ID must be a safe lowercase identifier.');
    else if (cardIds.has(card.id)) addError(errors, 'duplicate-card-id', `${location}.id`, 'Card IDs must be unique.');
    else cardIds.add(card.id);
    if (!isNonEmptyString(card.image)) addError(errors, 'invalid-image-reference', `${location}.image`, 'Card image must be a non-empty path string.');
    if (!isRecord(card.features)) {
      addError(errors, 'invalid-features', `${location}.features`, 'Card features must be an object; it may be empty or partial.');
      return;
    }
    for (const [categoryId, valueId] of Object.entries(card.features)) {
      if (!categoryById.has(categoryId)) {
        addError(errors, 'unknown-category', `${location}.features.${categoryId}`, 'Card feature references an unknown category.');
      } else if (typeof valueId !== 'string' || !valueIdsByCategory.get(categoryId)?.has(valueId)) {
        addError(errors, 'unknown-value', `${location}.features.${categoryId}`, 'Card feature references an unknown value.');
      }
    }
  });

  if (manifest.filenameTagging !== undefined) validateFilenameTagging(manifest.filenameTagging, categoryById, errors);
  return { valid: errors.length === 0, errors };
}

function validateFilenameTagging(profile, categoryById, errors) {
  if (!isRecord(profile)) {
    addError(errors, 'invalid-filename-tagging', 'filenameTagging', 'Filename tagging profile must be an object.');
    return;
  }
  if (profile.enabled !== undefined && typeof profile.enabled !== 'boolean') {
    addError(errors, 'invalid-filename-tagging', 'filenameTagging.enabled', 'Profile enabled must be a boolean.');
  }
  if (profile.delimiter !== undefined && (typeof profile.delimiter !== 'string' || profile.delimiter.length === 0)) {
    addError(errors, 'invalid-filename-tagging', 'filenameTagging.delimiter', 'Profile delimiter must be a non-empty string.');
  }
  if (profile.slots !== undefined && !Array.isArray(profile.slots)) {
    addError(errors, 'invalid-filename-tagging', 'filenameTagging.slots', 'Profile slots must be an array.');
    return;
  }
  const positions = new Set();
  const mappedCategories = new Set();
  (Array.isArray(profile.slots) ? profile.slots : []).forEach((slot, index) => {
    const location = `filenameTagging.slots.${index}`;
    if (!isRecord(slot) || !Number.isSafeInteger(slot.position) || slot.position < 1 || !isNonEmptyString(slot.categoryId)) {
      addError(errors, 'invalid-filename-tagging', location, 'Each slot needs a positive position and category ID.');
      return;
    }
    if (positions.has(slot.position) || mappedCategories.has(slot.categoryId)) {
      addError(errors, 'invalid-filename-tagging', location, 'Filename positions and category mappings must be unique.');
    }
    if (!categoryById.has(slot.categoryId)) addError(errors, 'unknown-category', `${location}.categoryId`, 'Filename profile references an unknown category.');
    positions.add(slot.position);
    mappedCategories.add(slot.categoryId);
  });
}

export function isSafeGalleryId(id) {
  return typeof id === 'string' && SAFE_ID_PATTERN.test(id)
    && !RESERVED_IDS.has(id);
}

export function isSupportedImagePath(imagePath) {
  return typeof imagePath === 'string' && SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(imagePath).toLowerCase());
}

function chooseThree(values) {
  const combinations = [];
  for (let first = 0; first < values.length - 2; first += 1) {
    for (let second = first + 1; second < values.length - 1; second += 1) {
      for (let third = second + 1; third < values.length; third += 1) {
        combinations.push([values[first], values[second], values[third]]);
      }
    }
  }
  return combinations;
}

function validateSelection(manifest, selection) {
  const errors = [];
  const categories = new Map((Array.isArray(manifest.categories) ? manifest.categories : [])
    .filter((category) => isRecord(category) && typeof category.id === 'string')
    .map((category) => [category.id, category]));
  const categoryIds = selection?.categoryIds;
  const valuesByCategory = selection?.valuesByCategory;
  if (!Array.isArray(categoryIds) || categoryIds.length !== 4 || new Set(categoryIds).size !== 4) {
    errors.push({ code: 'invalid-category-selection', message: 'Select exactly four distinct category IDs.' });
    return { errors, categoryIds: [], valuesByCategory: {}, categories };
  }
  if (!isRecord(valuesByCategory)) {
    errors.push({ code: 'invalid-value-selection', message: 'Selected values must be provided for each category.' });
    return { errors, categoryIds, valuesByCategory: {}, categories };
  }

  for (const categoryId of categoryIds) {
    const category = categories.get(categoryId);
    if (!category) {
      errors.push({ code: 'unknown-category', categoryId, message: 'Selected category does not exist.' });
      continue;
    }
    const definedValues = new Set(Array.isArray(category.values) ? category.values.map((value) => value?.id) : []);
    const selected = Object.hasOwn(valuesByCategory, categoryId) ? valuesByCategory[categoryId] : undefined;
    if (!Array.isArray(category.values) || category.values.length < 3) {
      errors.push({ code: 'category-not-game-eligible', categoryId, message: 'A selected category must define at least three values.' });
    }
    if (!Array.isArray(selected) || selected.length !== 3 || new Set(selected).size !== 3 || selected.some((valueId) => !definedValues.has(valueId))) {
      errors.push({ code: 'invalid-value-selection', categoryId, message: 'Choose exactly three distinct defined values for each selected category.' });
    }
  }
  return { errors, categoryIds, valuesByCategory, categories };
}

function tupleKey(categoryIds, features) {
  return JSON.stringify(categoryIds.map((categoryId) => features[categoryId]));
}

function enumerateTuples(categoryIds, valuesByCategory) {
  const tuples = [];
  for (const first of valuesByCategory[categoryIds[0]]) {
    for (const second of valuesByCategory[categoryIds[1]]) {
      for (const third of valuesByCategory[categoryIds[2]]) {
        for (const fourth of valuesByCategory[categoryIds[3]]) {
          tuples.push({ [categoryIds[0]]: first, [categoryIds[1]]: second, [categoryIds[2]]: third, [categoryIds[3]]: fourth });
        }
      }
    }
  }
  return tuples;
}

/** Pure readiness calculation. Cards passed here must already have valid, readable supported assets. */
export function analyzeDeckReadiness(manifest, selection, usableCards, options = {}) {
  const selected = validateSelection(manifest, selection);
  if (selected.errors.length) {
    return { ready: false, errors: selected.errors, combinationCount: 0, missingTuples: [], duplicateCandidates: [], candidateDeck: [], variationWarnings: [] };
  }

  const categoryIds = selected.categoryIds;
  const valuesByCategory = selected.valuesByCategory;
  const tuples = enumerateTuples(categoryIds, valuesByCategory);
  const allowed = new Map(categoryIds.map((categoryId) => [categoryId, new Set(valuesByCategory[categoryId])]));
  const grouped = new Map(tuples.map((features) => [tupleKey(categoryIds, features), []]));
  for (const card of Array.isArray(usableCards) ? usableCards : []) {
    if (!isRecord(card?.features)) continue;
    const matchesSelection = categoryIds.every((categoryId) => allowed.get(categoryId).has(card.features[categoryId]));
    if (matchesSelection) grouped.get(tupleKey(categoryIds, card.features))?.push(card);
  }

  const missingTuples = [];
  const duplicateCandidates = [];
  const candidateDeck = [];
  const random = typeof options.random === 'function' ? options.random : () => 0;
  for (const features of tuples) {
    const candidates = grouped.get(tupleKey(categoryIds, features));
    if (!candidates.length) {
      missingTuples.push({ features });
      continue;
    }
    if (candidates.length > 1) duplicateCandidates.push({ features, cardIds: candidates.map((card) => card.id) });
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
    candidateDeck.push(candidates[index]);
  }

  const selectedSet = new Set(categoryIds);
  const variationWarnings = [];
  for (const category of manifest.categories) {
    if (!isRecord(category) || typeof category.id !== 'string' || selectedSet.has(category.id)) continue;
    const valueIds = [...new Set(candidateDeck.map((card) => card.features?.[category.id]).filter((id) => typeof id === 'string'))].sort();
    if (valueIds.length > 1) {
      const valueLabels = new Map((Array.isArray(category.values) ? category.values : [])
        .filter((value) => isRecord(value) && typeof value.id === 'string')
        .map((value) => [value.id, value.label]));
      variationWarnings.push({
        categoryId: category.id,
        categoryName: category.name,
        values: valueIds.map((id) => ({ id, label: valueLabels.get(id) ?? id })),
      });
    }
  }

  return {
    ready: missingTuples.length === 0,
    errors: [],
    combinationCount: tuples.length,
    presentCombinationCount: tuples.length - missingTuples.length,
    missingTuples,
    duplicateCandidates,
    candidateDeck,
    variationWarnings,
  };
}

/** Rank alternative 3-value subsets for the selected quartet; enumeration is bounded and reports truncation. */
export function rankValueAlternatives(manifest, categoryIds, currentValuesByCategory, usableCards, options = {}) {
  const maximum = Number.isSafeInteger(options.maxEvaluations) && options.maxEvaluations > 0 ? options.maxEvaluations : 50000;
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 20;
  const selectionCheck = validateSelection(manifest, { categoryIds, valuesByCategory: currentValuesByCategory });
  const categories = selectionCheck.categories;
  if (!Array.isArray(categoryIds) || categoryIds.length !== 4 || new Set(categoryIds).size !== 4 || categoryIds.some((id) => !categories.has(id))) {
    return { recommendations: [], evaluatedCount: 0, truncated: false, errors: [{ code: 'invalid-category-selection', message: 'Select exactly four distinct existing categories.' }] };
  }
  const subsets = categoryIds.map((id) => chooseThree(categories.get(id).values.map((value) => value.id).sort()));
  if (subsets.some((optionsForCategory) => optionsForCategory.length === 0)) {
    return { recommendations: [], evaluatedCount: 0, truncated: false, errors: [{ code: 'category-not-game-eligible', message: 'Each selected category must define at least three values.' }] };
  }

  const cards = Array.isArray(usableCards) ? usableCards : [];
  const availableTupleKeys = new Set(cards
    .filter((card) => isRecord(card?.features))
    .map((card) => JSON.stringify(categoryIds.map((categoryId) => card.features[categoryId]))));
  const scores = [];
  let evaluatedCount = 0;
  let truncated = false;
  const selected = {};
  const evaluate = (depth) => {
    if (evaluatedCount >= maximum) { truncated = true; return; }
    if (depth < 4) {
      const categoryId = categoryIds[depth];
      for (const subset of subsets[depth]) {
        selected[categoryId] = subset;
        evaluate(depth + 1);
        if (truncated) break;
      }
      return;
    }
    const values = Object.fromEntries(categoryIds.map((id) => [id, [...selected[id]]]));
    if (categoryIds.every((id) => sameStringSet(values[id], currentValuesByCategory?.[id]))) return;
    evaluatedCount += 1;
    const tuples = enumerateTuples(categoryIds, values);
    const missingTuples = tuples
      .filter((features) => !availableTupleKeys.has(tupleKey(categoryIds, features)))
      .map((features) => ({ features }));
    scores.push({
      valuesByCategory: values,
      presentCombinationCount: tuples.length - missingTuples.length,
      combinationCount: 81,
      missingCount: missingTuples.length,
      missingTuples,
    });
  };
  evaluate(0);
  scores.sort((left, right) => right.presentCombinationCount - left.presentCombinationCount
    || left.missingCount - right.missingCount
    || compareSelections(left.valuesByCategory, right.valuesByCategory, categoryIds));
  return { recommendations: scores.slice(0, limit), evaluatedCount, truncated, errors: [] };
}

function sameStringSet(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function compareSelections(left, right, categoryIds) {
  for (const categoryId of categoryIds) {
    const a = left[categoryId].join('\u0000');
    const b = right[categoryId].join('\u0000');
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

export function createDefaultSelection(manifest) {
  const categories = Array.isArray(manifest?.categories) ? manifest.categories.slice(0, 4) : [];
  if (categories.length !== 4 || categories.some((category) => !isRecord(category)
    || !Array.isArray(category.values) || category.values.length < 3
    || category.values.slice(0, 3).some((value) => !isRecord(value) || typeof value.id !== 'string'))) return null;
  return {
    categoryIds: categories.map((category) => category.id),
    valuesByCategory: Object.fromEntries(categories.map((category) => [category.id, category.values.slice(0, 3).map((value) => value.id)])),
  };
}
