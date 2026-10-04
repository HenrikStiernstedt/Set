<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

const apiStatus = ref('checking');
const apiMessage = ref('Connecting to the local game service…');
const isLocalClient = ref(true);
const galleries = ref([]);
const selectedGalleryId = ref('');
const selectedCategoryIds = ref([]);
const selectedValues = ref({});
const startingBoardSize = ref(12);
const targetSets = ref(5);
const readiness = ref(null);
const recommendations = ref([]);
const acknowledgedVariation = ref(false);
const setupError = ref('');
const showFilenameTagging = ref(false);
const filenameProfile = ref({ enabled: false, delimiter: '_', slots: [] });
const filenamePositions = ref({});
const filenameProfileDirty = ref(false);
const filenamePreview = ref(null);
const filenameError = ref('');
const filenameBusy = ref(false);
const filenameDecisions = ref({});
const filenameGlobalResolutions = ref({});
const game = ref(null);
const selectedCardIds = ref([]);
const matchedCards = ref([]);
const revealHintIds = ref([]);
const hintModes = ref({
  revealOne: false,
  revealTwo: false,
  revealThree: false,
  highlightCategory: false,
  fadeInvalid: false,
  highlightNewCards: false,
  showCategoryOverlay: false,
});
const highlightCategorySelection = ref({ categoryId: '', valueId: '' });
const newlyDealtCardIds = ref([]);
const lightboxOpen = ref(false);
const lightboxCloseButton = ref(null);
const galleryView = ref(null);
const galleryViewOpen = ref(false);
const galleryViewFilter = ref('all');
const galleryViewSort = ref('file');
const galleryViewValueFilter = ref({});
const galleryLightboxCard = ref(null);
const galleryEditCard = ref(null);
const galleryEditValues = ref({});
const galleryImageMaximized = ref(false);
const galleryEditorBusy = ref(false);
const galleryEditorError = ref('');
const galleryImageInput = ref(null);
const message = ref('');
const messageType = ref('');
const busy = ref(false);
const now = ref(Date.now());
let clockInterval;
let messageTimeout;

const activeGallery = computed(() => galleries.value.find((gallery) => gallery.id === selectedGalleryId.value) ?? null);
const activeGameSeconds = computed(() => game.value ? Math.max(game.value.elapsedSeconds, Math.floor((now.value - game.value._clientStartedAt) / 1000)) : 0);
const formattedTime = computed(() => `${String(Math.floor(activeGameSeconds.value / 60)).padStart(2, '0')}:${String(activeGameSeconds.value % 60).padStart(2, '0')}`);
const setupIsComplete = computed(() => selectedCategoryIds.value.length === 4
  && selectedCategoryIds.value.every((categoryId) => (selectedValues.value[categoryId] ?? []).length === 3));
const variationWarningExists = computed(() => (readiness.value?.variationWarnings?.length ?? 0) > 0);
const canStart = computed(() => readiness.value?.ready === true
  && (!variationWarningExists.value || acknowledgedVariation.value)
  && !busy.value);

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ?? `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function loadGalleries() {
  try {
    let data;
    try {
      data = await requestJson('/api/galleries');
      isLocalClient.value = true;
    } catch (error) {
      if (error.status !== 403) throw error;
      data = await requestJson('/api/galleries/available');
      isLocalClient.value = false;
    }
    galleries.value = data.galleries ?? [];
    apiStatus.value = 'online';
    apiMessage.value = `${isLocalClient.value ? 'Local' : 'LAN game'} service online · ${galleries.value.length} ${galleries.value.length === 1 ? 'gallery' : 'galleries'} found`;
    if (!selectedGalleryId.value && galleries.value.length) chooseGallery(galleries.value[0].id);
  } catch (error) {
    apiStatus.value = 'offline';
    apiMessage.value = error.message || 'Start the Node service to connect the app.';
  }
}

function chooseGallery(galleryId) {
  selectedGalleryId.value = galleryId;
  const gallery = galleries.value.find((item) => item.id === galleryId);
  selectedCategoryIds.value = (gallery?.categories ?? []).map((category) => category.id);
  selectedValues.value = Object.fromEntries((gallery?.categories ?? []).map((category) => [
    category.id,
    category.values.map((value) => value.id),
  ]));
  readiness.value = null;
  recommendations.value = [];
  acknowledgedVariation.value = false;
  setupError.value = '';
  showFilenameTagging.value = false;
  filenamePreview.value = null;
  filenameError.value = '';
  galleryView.value = null;
  galleryViewOpen.value = false;
  galleryLightboxCard.value = null;
  galleryEditCard.value = null;
  void loadFilenameProfile(galleryId);
  void refreshReadiness();
}

async function openGalleryViewer() {
  if (!activeGallery.value) return;
  try {
    galleryView.value = await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/view`);
    galleryViewOpen.value = true;
    galleryViewFilter.value = 'all';
    galleryViewSort.value = 'file';
    galleryLightboxCard.value = null;
  } catch (error) {
    showMessage(error.message || 'Gallery view unavailable.', 'error');
  }
}

function galleryViewCards() {
  if (!galleryView.value) return [];
  const cards = (() => {
    if (galleryViewFilter.value === 'missing') return galleryView.value.missingCards ?? [];
    if (galleryViewFilter.value === 'duplicates') return galleryView.value.duplicateCards ?? galleryView.value.duplicateImageCards ?? [];
    if (galleryViewFilter.value === 'images') return galleryView.value.duplicateImageCards ?? [];
    if (galleryViewFilter.value === 'filenames') return galleryView.value.duplicateFilenameCards ?? [];
    if (galleryViewFilter.value === 'tags') return galleryView.value.duplicateFeatureCards ?? [];
    return galleryView.value.cards ?? [];
  })();

  const filtered = [...cards].filter((card) => {
    const featureSummary = card.featureSummary ?? {};
    return Object.entries(galleryViewValueFilter.value).every(([categoryId, selectedValues]) => {
      const selected = Array.isArray(selectedValues) ? selectedValues : [];
      if (!selected.length) return true;
      const actual = featureSummary[categoryId];
      return selected.includes(actual);
    });
  });

  return filtered.sort((left, right) => {
    const leftTitle = left?.image ?? left?.id ?? '';
    const rightTitle = right?.image ?? right?.id ?? '';
    if (galleryViewSort.value === 'missing') return (right.missingCategoryIds?.length ?? 0) - (left.missingCategoryIds?.length ?? 0);
    if (galleryViewSort.value === 'duplicates') return Number(Boolean(right.duplicateImage || right.duplicateFileName || right.duplicateFeatures)) - Number(Boolean(left.duplicateImage || left.duplicateFileName || left.duplicateFeatures));
    return String(leftTitle).localeCompare(String(rightTitle));
  });
}

function applyGalleryValueFilter(categoryId, valueId) {
  const current = galleryViewValueFilter.value[categoryId] ?? [];
  const next = current.includes(valueId) ? current.filter((id) => id !== valueId) : [...current, valueId];
  if (next.length) galleryViewValueFilter.value[categoryId] = next;
  else delete galleryViewValueFilter.value[categoryId];
}

function galleryCardImageUrl(card) {
  if (!activeGallery.value || !card?.image) return '';
  return `/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/images/${encodeURIComponent(card.image)}`;
}

function openGalleryCard(card) {
  galleryLightboxCard.value = card;
  galleryImageMaximized.value = false;
  galleryEditorError.value = '';
}

function openGalleryCardEditor() {
  if (!galleryLightboxCard.value) return;
  galleryEditCard.value = galleryLightboxCard.value;
  galleryEditValues.value = { ...(galleryEditCard.value.featureSummary ?? {}) };
  galleryLightboxCard.value = null;
  galleryEditorError.value = '';
}

function returnToGalleryImage() {
  galleryLightboxCard.value = galleryEditCard.value;
  galleryEditCard.value = null;
  galleryImageMaximized.value = false;
}

function selectGalleryEditValue(categoryId, valueId) {
  galleryEditValues.value = { ...galleryEditValues.value, [categoryId]: valueId };
}

async function refreshGalleryEditorView(cardId = galleryEditCard.value?.id ?? galleryLightboxCard.value?.id) {
  if (!activeGallery.value) return;
  galleryView.value = await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/view`);
  if (cardId) {
    const refreshed = galleryView.value.cards.find((card) => card.id === cardId) ?? null;
    if (galleryEditCard.value?.id === cardId) galleryEditCard.value = refreshed;
    if (galleryLightboxCard.value?.id === cardId) galleryLightboxCard.value = refreshed;
  }
}

async function saveGalleryCardAssignment() {
  if (!activeGallery.value || !galleryEditCard.value) return;
  const assignments = Object.fromEntries(Object.entries(galleryEditValues.value).filter(([, valueId]) => Boolean(valueId)));
  if (!Object.keys(assignments).length) return;
  galleryEditorBusy.value = true;
  galleryEditorError.value = '';
  const decisions = Object.fromEntries(Object.keys(assignments).map((categoryId) => [categoryId, 'overwrite']));
  try {
    const result = await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/assignments`, {
      method: 'POST',
      body: JSON.stringify({ cardId: galleryEditCard.value.id, assignments, decisions }),
    });
    await refreshGalleryEditorView(galleryEditCard.value.id);
    galleryEditValues.value = { ...(galleryEditCard.value?.featureSummary ?? {}) };
    showMessage(result.changed ? 'Card assignment saved.' : 'No changes were needed.', 'info');
  } catch (error) {
    galleryEditorError.value = error.message;
    if (error.status === 409 && !error.data?.conflicts) {
      try { await loadGalleries(); await refreshGalleryEditorView(galleryEditCard.value?.id); } catch { /* Keep the original save error visible. */ }
    }
  } finally {
    galleryEditorBusy.value = false;
  }
}

function fileAsBase64(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  });
}

async function replaceGalleryCardImage(file) {
  if (!file || !activeGallery.value || !galleryEditCard.value) return;
  galleryEditorBusy.value = true;
  galleryEditorError.value = '';
  try {
    await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/cards/${encodeURIComponent(galleryEditCard.value.id)}/image`, {
      method: 'POST',
      body: JSON.stringify({ name: file.name, data: await fileAsBase64(file) }),
    });
    await refreshGalleryEditorView(galleryEditCard.value.id);
    showMessage('Image replaced on the existing card. No card copy was created.', 'info');
  } catch (error) {
    galleryEditorError.value = error.message;
  } finally {
    galleryEditorBusy.value = false;
    if (galleryImageInput.value) galleryImageInput.value.value = '';
  }
}

function onGalleryImageDrop(event) {
  // Some desktop file drags omit the MIME type; the server validates extension and file signature.
  const file = event.dataTransfer?.files?.[0];
  if (file) void replaceGalleryCardImage(file);
}

function galleryNavigationItems() {
  return galleryViewCards();
}

function openGalleryCardAt(index) {
  const items = galleryNavigationItems();
  if (!items.length) return;
  const nextIndex = ((index % items.length) + items.length) % items.length;
  openGalleryCard(items[nextIndex]);
}

function nextGalleryCard() {
  if (!galleryLightboxCard.value) return;
  const items = galleryNavigationItems();
  const currentIndex = items.findIndex((card) => card.id === galleryLightboxCard.value.id);
  openGalleryCardAt(currentIndex + 1);
}

function previousGalleryCard() {
  if (!galleryLightboxCard.value) return;
  const items = galleryNavigationItems();
  const currentIndex = items.findIndex((card) => card.id === galleryLightboxCard.value.id);
  openGalleryCardAt(currentIndex - 1);
}

async function loadFilenameProfile(galleryId) {
  if (!isLocalClient.value) return;
  try {
    const result = await requestJson(`/api/galleries/${encodeURIComponent(galleryId)}/editor/filename-profile`);
    filenameProfile.value = { enabled: result.profile?.enabled === true, delimiter: result.profile?.delimiter ?? '_', slots: result.profile?.slots ?? [] };
    filenameProfileDirty.value = false;
    filenamePositions.value = Object.fromEntries(filenameProfile.value.slots.map((slot) => [slot.categoryId, slot.position]));
    if (!filenameProfile.value.slots.length) {
      const gallery = galleries.value.find((item) => item.id === galleryId);
      filenamePositions.value = Object.fromEntries((gallery?.categories ?? []).slice(0, 4).map((category, index) => [category.id, index + 1]));
    }
  } catch (error) {
    filenameError.value = error.message;
  }
}

async function saveFilenameProfile() {
  if (!activeGallery.value) return;
  filenameBusy.value = true;
  filenameError.value = '';
  try {
    const slots = Object.entries(filenamePositions.value)
      .filter(([, position]) => Number.isInteger(Number(position)) && Number(position) > 0)
      .map(([categoryId, position]) => ({ categoryId, position: Number(position) }))
      .sort((left, right) => left.position - right.position);
    const profile = { enabled: true, delimiter: filenameProfile.value.delimiter || '_', slots };
    await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/filename-profile`, {
      method: 'PATCH', body: JSON.stringify({ profile }),
    });
    filenameProfile.value = profile;
    filenameProfileDirty.value = false;
    filenamePreview.value = null;
    showFilenameTagging.value = true;
    await loadGalleries();
    showMessage('Filename rules saved.', 'info');
  } catch (error) {
    filenameError.value = error.data?.errors?.map((item) => item.message).join(' ') || error.message;
  } finally {
    filenameBusy.value = false;
  }
}

async function previewFilenameTags() {
  if (!activeGallery.value) return;
  filenameBusy.value = true;
  filenameError.value = '';
  try {
    filenamePreview.value = await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/filename-preview`, {
      method: 'POST', body: JSON.stringify({}),
    });
    filenameDecisions.value = {};
    filenameGlobalResolutions.value = {};
  } catch (error) {
    filenameError.value = error.message;
  } finally {
    filenameBusy.value = false;
  }
}

function fileDecision(file) {
  if (!filenameDecisions.value[file.assetPath]) filenameDecisions.value[file.assetPath] = { valueResolutions: {}, conflicts: {}, skip: false };
  return filenameDecisions.value[file.assetPath];
}

const unknownFilenameValues = computed(() => {
  const unique = new Map();
  for (const file of filenamePreview.value?.files ?? []) {
    for (const issue of file.issues ?? []) {
      if (!['unknown-value', 'ambiguous-value'].includes(issue.code)) continue;
      const key = `${issue.categoryId}:${issue.token}`;
      if (!unique.has(key)) unique.set(key, issue);
    }
  }
  return [...unique.values()];
});

async function applyFilenameTags() {
  if (!activeGallery.value || !filenamePreview.value) return;
  filenameBusy.value = true;
  filenameError.value = '';
  const decisions = { valueResolutions: {}, globalValueResolutions: filenameGlobalResolutions.value, skipFiles: [] };
  for (const file of filenamePreview.value.files) {
    const choice = fileDecision(file);
    if (choice.skip) { decisions.skipFiles.push(file.assetPath); continue; }
    decisions.valueResolutions[file.assetPath] = choice.valueResolutions;
    decisions[file.assetPath] = choice.conflicts;
  }
  try {
    const result = await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/editor/filename-apply`, {
      method: 'POST', body: JSON.stringify({ decisions }),
    });
    showMessage(`Tagged ${result.createdCount} new and updated ${result.updatedCount} existing images.`, 'info');
    filenamePreview.value = null;
    await loadGalleries();
  } catch (error) {
    const unresolved = error.data?.unresolved ?? [];
    filenameError.value = unresolved.length
      ? `${unresolved.length} file(s) still need a value mapping, conflict choice, or skip.`
      : error.data?.errors?.map((item) => item.message).join(' ') || error.message;
  } finally {
    filenameBusy.value = false;
  }
}

function toggleCategory(category) {
  const existingIndex = selectedCategoryIds.value.indexOf(category.id);
  if (existingIndex >= 0) {
    selectedCategoryIds.value.splice(existingIndex, 1);
    delete selectedValues.value[category.id];
  } else {
    selectedCategoryIds.value.push(category.id);
    selectedValues.value[category.id] = category.values.map((value) => value.id);
  }
  acknowledgedVariation.value = false;
  void refreshReadiness();
}

function toggleValue(category, value) {
  const selected = selectedValues.value[category.id] ?? (selectedValues.value[category.id] = []);
  const index = selected.indexOf(value.id);
  if (index >= 0) selected.splice(index, 1);
  else selected.push(value.id);
  acknowledgedVariation.value = false;
  void refreshReadiness();
}

function chooseRecommendation(recommendation) {
  selectedValues.value = Object.fromEntries(selectedCategoryIds.value.map((id) => [id, [...recommendation.valuesByCategory[id]]]));
  acknowledgedVariation.value = false;
  void refreshReadiness();
}

async function refreshReadiness() {
  readiness.value = null;
  recommendations.value = [];
  setupError.value = '';
  if (!activeGallery.value || !setupIsComplete.value) return;
  busy.value = true;
  try {
    const result = await requestJson(`/api/galleries/${encodeURIComponent(activeGallery.value.id)}/readiness`, {
      method: 'POST',
      body: JSON.stringify({ selection: { categoryIds: selectedCategoryIds.value, valuesByCategory: selectedValues.value } }),
    });
    readiness.value = result.readiness;
    recommendations.value = result.recommendations?.recommendations ?? [];
  } catch (error) {
    setupError.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function startGame() {
  if (!activeGallery.value || !canStart.value) return;
  busy.value = true;
  setupError.value = '';
  try {
    const result = await requestJson('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        galleryId: activeGallery.value.id,
        selection: { categoryIds: selectedCategoryIds.value, valuesByCategory: selectedValues.value },
        startingBoardSize: startingBoardSize.value,
        targetSets: targetSets.value,
        acknowledgeVariation: acknowledgedVariation.value,
      }),
    });
    enterGame(result.game);
  } catch (error) {
    if (error.data?.readiness) readiness.value = error.data.readiness;
    setupError.value = error.message;
  } finally {
    busy.value = false;
  }
}

function enterGame(nextGame) {
  game.value = { ...nextGame, _clientStartedAt: Date.now() - (nextGame.elapsedSeconds ?? 0) * 1000 };
  selectedCardIds.value = [];
  matchedCards.value = [];
  revealHintIds.value = [];
  newlyDealtCardIds.value = [];
  hintModes.value = {
    revealOne: false,
    revealTwo: false,
    revealThree: false,
    highlightCategory: false,
    fadeInvalid: false,
    highlightNewCards: false,
    showCategoryOverlay: false,
  };
  const firstCategory = game.value.categories?.[0];
  highlightCategorySelection.value = {
    categoryId: firstCategory?.id ?? '',
    valueId: firstCategory?.values?.[0]?.id ?? '',
  };
  lightboxOpen.value = false;
  message.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function featureValueId(card, categoryId) {
  const value = card?.features?.[categoryId];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value) return value.id;
  return null;
}

function isSetLocal(cards, categoryIds) {
  if (!Array.isArray(cards) || cards.length !== 3 || !Array.isArray(categoryIds) || categoryIds.length !== 4) return false;
  return categoryIds.every((categoryId) => {
    const values = cards.map((card) => featureValueId(card, categoryId));
    return values.every((value) => typeof value === 'string')
      && (values[0] === values[1] && values[1] === values[2]
        || values[0] !== values[1] && values[0] !== values[2] && values[1] !== values[2]);
  });
}

function clearRevealHints() {
  hintModes.value.revealOne = false;
  hintModes.value.revealTwo = false;
  hintModes.value.revealThree = false;
  revealHintIds.value = [];
}

async function syncRevealHint() {
  if (!game.value) {
    revealHintIds.value = [];
    return;
  }

  const activeMode = Object.entries(hintModes.value)
    .find(([mode, enabled]) => enabled && ['revealOne', 'revealTwo', 'revealThree'].includes(mode))?.[0];
  if (!activeMode) {
    revealHintIds.value = [];
    return;
  }

  try {
    const response = await requestJson(`/api/games/${game.value.id}/hint`, {
      method: 'POST',
      body: JSON.stringify({ mode: activeMode }),
    });
    revealHintIds.value = Array.isArray(response.revealIds) ? response.revealIds : [];
  } catch (error) {
    revealHintIds.value = [];
    clearRevealHints();
    showMessage(error.message || 'Reveal hint unavailable.', 'error');
  }
}

async function setHintMode(mode) {
  if (!game.value) return;
  if (['revealOne', 'revealTwo', 'revealThree'].includes(mode)) {
    const nextState = { revealOne: false, revealTwo: false, revealThree: false };
    const enabled = !hintModes.value[mode];
    nextState[mode] = enabled;
    hintModes.value = { ...hintModes.value, ...nextState };
    if (enabled) {
      await syncRevealHint();
    } else {
      revealHintIds.value = [];
    }
    return;
  }
  hintModes.value[mode] = !hintModes.value[mode];
  if (mode === 'highlightCategory' && hintModes.value.highlightCategory) {
    syncHighlightCategorySelection();
  }
}

function syncHighlightCategorySelection() {
  if (!game.value) return;
  const category = game.value.categories.find((entry) => entry.id === highlightCategorySelection.value.categoryId)
    ?? game.value.categories[0];
  if (!category) return;
  highlightCategorySelection.value.categoryId = category.id;
  if (!category.values.some((value) => value.id === highlightCategorySelection.value.valueId)) {
    highlightCategorySelection.value.valueId = category.values[0]?.id ?? '';
  }
}

const activeRevealIds = computed(() => {
  if (!game.value) return [];
  const revealMode = Object.entries(hintModes.value)
    .find(([mode, enabled]) => enabled && ['revealOne', 'revealTwo', 'revealThree'].includes(mode))?.[0];
  if (!revealMode) return [];
  if (!revealHintIds.value.length) return [];
  return revealHintIds.value;
});

const activeCategoryIds = computed(() => game.value?.categories?.map((category) => category.id) ?? []);

const categoryHighlight = computed(() => {
  if (!game.value || !hintModes.value.highlightCategory) return null;
  const categoryId = highlightCategorySelection.value.categoryId || activeCategoryIds.value[0];
  const category = game.value.categories.find((entry) => entry.id === categoryId);
  if (!category) return null;
  const valueId = highlightCategorySelection.value.valueId || category.values[0]?.id || null;
  if (!valueId) return null;
  return { categoryId, valueId };
});

const invalidCardIds = computed(() => {
  if (!game.value || selectedCardIds.value.length !== 2 || !hintModes.value.fadeInvalid) return [];
  const [firstId, secondId] = selectedCardIds.value;
  const first = game.value.board.find((card) => card.id === firstId);
  const second = game.value.board.find((card) => card.id === secondId);
  if (!first || !second) return [];
  const invalid = [];
  for (const card of game.value.board) {
    if (card.id === firstId || card.id === secondId) continue;
    if (!isSetLocal([first, second, card], activeCategoryIds.value)) invalid.push(card.id);
  }
  return invalid;
});

const newCardHighlightIds = computed(() => {
  if (!hintModes.value.highlightNewCards) return [];
  return newlyDealtCardIds.value;
});

function cardClasses(card) {
  const classes = [];
  if (selectedCardIds.value.includes(card.id)) classes.push('selected');
  if (activeRevealIds.value.includes(card.id)) classes.push('reveal-highlight');
  if (newCardHighlightIds.value.includes(card.id)) classes.push('new-card-highlight');
  if (categoryHighlight.value && card.features[categoryHighlight.value.categoryId]?.id === categoryHighlight.value.valueId) classes.push('category-highlight');
  if (invalidCardIds.value.includes(card.id)) classes.push('invalid-card');
  if (hintModes.value.showCategoryOverlay) classes.push('category-overlay-enabled');
  return classes;
}

function cardOverlayEntries(card) {
  if (!game.value) return [];
  return game.value.categories.map((category, index) => {
    const value = card.features?.[category.id];
    const label = typeof value === 'string' ? value : value?.label ?? '';
    return { label: label ? `${category.name}: ${label}` : '', position: index };
  }).filter((entry) => entry.label);
}

async function toggleCard(card) {
  if (!game.value || game.value.status !== 'active' || busy.value || lightboxOpen.value) return;
  const index = selectedCardIds.value.indexOf(card.id);
  if (index >= 0) {
    selectedCardIds.value.splice(index, 1);
    return;
  }
  if (selectedCardIds.value.length >= 3) selectedCardIds.value = [];
  selectedCardIds.value.push(card.id);
  if (selectedCardIds.value.length === 3) await submitSelection();
}

async function submitSelection() {
  if (!game.value || selectedCardIds.value.length !== 3) return;
  busy.value = true;
  try {
    const previousIds = new Set(game.value.board.map((card) => card.id));
    const result = await requestJson(`/api/games/${game.value.id}/match`, {
      method: 'POST',
      body: JSON.stringify({ cardIds: [...selectedCardIds.value] }),
    });
    game.value = { ...result.game, _clientStartedAt: game.value._clientStartedAt };
    selectedCardIds.value = [];
    if (result.valid) {
      matchedCards.value = result.matched;
      clearRevealHints();
      newlyDealtCardIds.value = result.game.board.filter((card) => !previousIds.has(card.id)).map((card) => card.id);
      lastFocusedElement = document.activeElement;
      lightboxOpen.value = true;
      await nextTick();
      lightboxCloseButton.value?.focus();
    } else {
      showMessage('Not a Set. Try another combination.', 'error');
    }
  } catch (error) {
    selectedCardIds.value = [];
    showMessage(error.message, 'error');
    await refreshGame();
  } finally {
    busy.value = false;
  }
}

async function dealThree() {
  if (!game.value || busy.value) return;
  busy.value = true;
  try {
    const previousIds = new Set(game.value.board.map((card) => card.id));
    const result = await requestJson(`/api/games/${game.value.id}/deal`, { method: 'POST', body: '{}' });
    game.value = { ...result.game, _clientStartedAt: game.value._clientStartedAt };
    newlyDealtCardIds.value = result.game.board.filter((card) => !previousIds.has(card.id));
    if (result.dealt === 0) showMessage('No cards remain to deal.', 'info');
  } catch (error) {
    showMessage(error.message, 'error');
    await refreshGame();
  } finally {
    busy.value = false;
  }
}

async function refreshGame() {
  if (!game.value) return;
  const result = await requestJson(`/api/games/${game.value.id}`);
  game.value = { ...result.game, _clientStartedAt: game.value._clientStartedAt };
}

async function restartGame() {
  if (!game.value || busy.value) return;
  if (!window.confirm('Start a fresh game with the same gallery and setup?')) return;
  busy.value = true;
  try {
    const result = await requestJson(`/api/games/${game.value.id}/restart`, { method: 'POST', body: '{}' });
    enterGame(result.game);
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    busy.value = false;
  }
}

function exitGame() {
  game.value = null;
  readiness.value = null;
  selectedCardIds.value = [];
  lightboxOpen.value = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function dismissReward() {
  lightboxOpen.value = false;
  matchedCards.value = [];
  nextTick(() => lastFocusedElement?.focus?.());
}

function showMessage(text, type) {
  message.value = text;
  messageType.value = type;
  clearTimeout(messageTimeout);
  messageTimeout = setTimeout(() => { message.value = ''; }, 2400);
}

function onKeydown(event) {
  if (event.key === 'Escape' && (lightboxOpen.value || galleryLightboxCard.value || galleryEditCard.value)) {
    if (lightboxOpen.value) dismissReward();
    if (galleryLightboxCard.value) galleryLightboxCard.value = null;
    if (galleryEditCard.value) galleryEditCard.value = null;
    return;
  }

  if (galleryLightboxCard.value && (event.key === 'ArrowRight' || event.key === 'PageDown')) {
    event.preventDefault();
    nextGalleryCard();
    return;
  }

  if (galleryLightboxCard.value && (event.key === 'ArrowLeft' || event.key === 'PageUp')) {
    event.preventDefault();
    previousGalleryCard();
    return;
  }
}

let lastFocusedElement;

function tupleLabel(features) {
  return Object.entries(features).map(([id, value]) => `${categoryName(id)}=${value.label}`).join(' · ');
}

function categoryName(categoryId) {
  return activeGallery.value?.categories.find((category) => category.id === categoryId)?.name ?? categoryId;
}

function valueName(categoryId, valueId) {
  return activeGallery.value?.categories.find((category) => category.id === categoryId)?.values.find((value) => value.id === valueId)?.label ?? valueId;
}

function cardLabel(card) {
  return game.value.categories.map((category) => `${category.name}: ${card.features[category.id].label}`).join(', ');
}

function artSymbol(index, valueId) {
  const symbols = ['●', '◆', '∿', '◍', '◌', '⬟', '✦', '◉', '⌁'];
  let hash = 0;
  for (const character of valueId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return symbols[(hash + index) % symbols.length];
}

onMounted(async () => {
  await loadGalleries();
  clockInterval = setInterval(() => { now.value = Date.now(); }, 1000);
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  clearInterval(clockInterval);
  clearTimeout(messageTimeout);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <main class="shell app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Set Gallery home" @click.prevent="exitGame">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>set<span class="brand-light">gallery</span></span>
      </a>
      <div class="topbar-right">
        <span class="local-label"><span class="local-dot"></span> PRIVATE BY DESIGN</span>
        <button v-if="game" class="text-button" @click="exitGame">Exit game</button>
      </div>
    </header>

    <template v-if="!game">
      <section class="setup-heading">
        <div>
          <p class="eyebrow">SOLO GAME · SETUP</p>
          <h1 class="setup-title">Find the <em>connection.</em></h1>
          <p class="intro">Choose a gallery, then select four categories and three values in each. Every combination must have an image before the game can begin.</p>
        </div>
        <div class="setup-api" :class="apiStatus"><span class="local-dot"></span>{{ apiMessage }}</div>
      </section>

      <section v-if="!galleries.length" class="empty-state">
        <span class="empty-icon" aria-hidden="true">▧</span>
        <h2>No galleries found yet</h2>
        <p>Place a gallery folder containing <strong>set-gallery.json</strong> under one of the configured gallery roots, then restart the local server. Gallery authoring arrives in a later build step.</p>
        <button class="secondary-button" :disabled="apiStatus !== 'online'" @click="loadGalleries">Rescan galleries</button>
      </section>

      <template v-else>
        <section class="gallery-picker" aria-labelledby="gallery-heading">
          <div class="section-title-row"><div><p class="eyebrow">01 / COLLECTION</p><h2 id="gallery-heading">Choose your gallery</h2></div><button class="link-button" @click="loadGalleries">↻ Rescan</button></div>
          <div class="gallery-list" role="listbox" aria-label="Available galleries">
            <button v-for="gallery in galleries" :key="gallery.id" class="gallery-option" :class="{ active: selectedGalleryId === gallery.id }" role="option" :aria-selected="selectedGalleryId === gallery.id" @click="chooseGallery(gallery.id)">
              <span class="gallery-symbol" aria-hidden="true">✳</span>
              <span class="gallery-option-copy"><strong>{{ gallery.name || 'Invalid gallery' }}</strong><small>{{ gallery.counts?.usableCards ?? 0 }} usable images · {{ gallery.counts?.categories ?? 0 }} categories</small></span>
              <span class="gallery-ready" :class="gallery.readiness?.ready ? 'ready' : 'needs-work'">{{ gallery.readiness?.ready ? 'READY' : 'SETUP' }}</span>
            </button>
          </div>
        </section>

        <section v-if="activeGallery && isLocalClient" class="gallery-view-panel" aria-labelledby="gallery-view-heading">
          <div class="section-title-row"><div><p class="eyebrow">02 / GALLERY VIEW</p><h2 id="gallery-view-heading">Inspect gallery records</h2></div><button class="secondary-button" @click="openGalleryViewer">Open gallery view</button></div>
          <div v-if="galleryViewOpen && galleryView" class="gallery-view-body">
            <div class="gallery-filter-row">
              <button class="gallery-filter" :class="{ active: galleryViewFilter === 'all' }" @click="galleryViewFilter = 'all'">All {{ galleryView.cards.length }}</button>
              <button class="gallery-filter" :class="{ active: galleryViewFilter === 'missing' }" @click="galleryViewFilter = 'missing'">Missing values {{ galleryView.missingCards.length }}</button>
              <button class="gallery-filter" :class="{ active: galleryViewFilter === 'duplicates' }" @click="galleryViewFilter = 'duplicates'">Duplicate cards {{ galleryView.duplicateCards?.length ?? galleryView.duplicateImageCards.length }}</button>
              <button class="gallery-filter" :class="{ active: galleryViewFilter === 'images' }" @click="galleryViewFilter = 'images'">Duplicate images {{ galleryView.duplicateImageCards.length }}</button>
              <button class="gallery-filter" :class="{ active: galleryViewFilter === 'tags' }" @click="galleryViewFilter = 'tags'">Duplicate tags {{ galleryView.duplicateFeatureCards.length }}</button>
              <button class="gallery-filter" :class="{ active: galleryViewFilter === 'filenames' }" @click="galleryViewFilter = 'filenames'">Duplicate filenames {{ galleryView.duplicateFilenameCards.length }}</button>
            </div>
            <div class="gallery-toolbar">
              <label class="form-field inline-form-field">Sort
                <select v-model="galleryViewSort">
                  <option value="file">File name</option>
                  <option value="missing">Missing values</option>
                  <option value="duplicates">Duplicates first</option>
                </select>
              </label>
              <button class="secondary-button" @click="galleryViewOpen = false">Close</button>
            </div>
            <div class="gallery-value-filters">
              <div v-for="category in (galleryView?.categories ?? [])" :key="category.id" class="gallery-value-filter-group">
                <strong>{{ category.name }}</strong>
                <div class="gallery-value-filter-pills">
                  <button v-for="value in category.values" :key="value.id" class="gallery-value-pill" :class="{ active: (galleryViewValueFilter[category.id] ?? []).includes(value.id) }" @click="applyGalleryValueFilter(category.id, value.id)">{{ value.label }}</button>
                </div>
              </div>
            </div>
            <div class="gallery-grid">
              <button v-for="card in galleryViewCards()" :key="card.id" class="gallery-thumb" :aria-label="`Edit card ${card.id}`" @click="openGalleryCard(card)">
                <img :src="galleryCardImageUrl(card)" :alt="`Gallery card ${card.id}`" />
                <span class="gallery-thumb-meta">{{ card.missingCategoryIds.length ? `Missing ${card.missingCategoryIds.length}` : 'Complete' }}</span>
                <span class="gallery-thumb-edit">Edit card</span>
              </button>
            </div>
          </div>
        </section>

        <section v-if="activeGallery" class="category-setup" aria-labelledby="category-heading">
          <div class="section-title-row"><div><p class="eyebrow">03 / GAME RULES</p><h2 id="category-heading">Choose four categories</h2></div><span class="selection-counter">{{ selectedCategoryIds.length }} <span>selected · choose 4</span></span></div>
          <p class="helper-copy">Only these four categories determine whether three cards make a Set. Other tags in the gallery do not affect this game.</p>
          <div class="category-list">
            <article v-for="category in activeGallery.categories" :key="category.id" class="category-card" :class="{ chosen: selectedCategoryIds.includes(category.id), disabled: !selectedCategoryIds.includes(category.id) && selectedCategoryIds.length >= 4 }">
              <button class="category-toggle" :aria-pressed="selectedCategoryIds.includes(category.id)" @click="toggleCategory(category)">
                <span class="checkmark">{{ selectedCategoryIds.includes(category.id) ? '✓' : '' }}</span><span class="category-name">{{ category.name }}</span><span class="category-value-count">{{ category.values.length }} values</span>
              </button>
              <div v-if="selectedCategoryIds.includes(category.id)" class="value-list" :aria-label="`Select three values for ${category.name}`">
                <button v-for="value in category.values" :key="value.id" class="value-chip" :class="{ selected: (selectedValues[category.id] ?? []).includes(value.id) }" :aria-pressed="(selectedValues[category.id] ?? []).includes(value.id)" :disabled="!(selectedValues[category.id] ?? []).includes(value.id) && (selectedValues[category.id] ?? []).length >= 3" @click="toggleValue(category, value)">{{ value.label }}</button>
                <span class="value-selection-count">{{ (selectedValues[category.id] ?? []).length }} / 3</span>
              </div>
            </article>
          </div>

          <div v-if="setupIsComplete" class="setup-validation" aria-live="polite">
            <div v-if="busy" class="validation-note">Checking all 81 feature combinations…</div>
            <template v-else-if="readiness">
              <div v-if="readiness.ready" class="validation-success"><span>✓</span><div><strong>Complete deck</strong><small>All {{ readiness.combinationCount }} selected combinations have an image.</small></div></div>
              <div v-else class="validation-error"><span>!</span><div><strong>{{ readiness.presentCombinationCount }} / {{ readiness.combinationCount }} combinations covered</strong><small>{{ readiness.missingTuples.length }} combinations are missing an image.</small></div></div>
              <details v-if="readiness.missingTuples?.length" class="diagnostic-details"><summary>Review missing combinations</summary><ul><li v-for="tuple in readiness.missingTuples" :key="JSON.stringify(tuple.features)">{{ tupleLabel(tuple.features) }}</li></ul></details>
              <div v-if="recommendations.length" class="recommendations"><strong>Try another value selection</strong><button v-for="(suggestion, index) in recommendations.slice(0, 3)" :key="index" class="recommendation" @click="chooseRecommendation(suggestion)"><span>{{ suggestion.presentCombinationCount }} / 81 covered</span><small>{{ Object.entries(suggestion.valuesByCategory).map(([categoryId, ids]) => `${categoryName(categoryId)}: ${ids.map((id) => valueName(categoryId, id)).join(', ')}`).join(' · ') }}</small></button></div>
              <div v-if="readiness.variationWarnings?.length" class="variation-warning"><strong>Some unused features vary between cards</strong><p>{{ readiness.variationWarnings.map((warning) => `${warning.categoryName}: ${warning.values.map((value) => value.label).join(', ')}`).join(' · ') }}. These categories are not part of the Set rule.</p><label><input v-model="acknowledgedVariation" type="checkbox" /> I understand that only the four selected categories affect Sets.</label></div>
            </template>
          </div>
          <p v-if="setupError" class="error-text" role="alert">{{ setupError }}</p>
        </section>

        <section v-if="activeGallery && isLocalClient" class="filename-tagging-panel">
          <div class="filename-panel-heading">
            <div><p class="eyebrow">OPTIONAL · AUTOMATED TAGGING</p><h2>Tag images from filenames</h2><p class="helper-copy">Map filename token positions to categories, preview all images in this gallery, then apply the tags. Existing image files are not copied or renamed.</p></div>
            <button class="secondary-button" @click="showFilenameTagging = !showFilenameTagging">{{ showFilenameTagging ? 'Hide' : 'Configure' }}</button>
          </div>
          <template v-if="showFilenameTagging">
            <div class="filename-profile-form">
              <label class="form-field">Token delimiter <input v-model="filenameProfile.delimiter" maxlength="8" placeholder="_" @input="filenameProfileDirty = true" /></label>
              <div v-for="category in activeGallery.categories" :key="category.id" class="form-field token-slot">
                <label :for="`slot-${category.id}`">{{ category.name }} token position</label>
                <select :id="`slot-${category.id}`" v-model.number="filenamePositions[category.id]" @change="filenameProfileDirty = true">
                  <option :value="0">Not mapped</option>
                  <option v-for="position in 16" :key="position" :value="position">{{ position }}</option>
                </select>
              </div>
              <button class="primary-button" :disabled="filenameBusy" @click="saveFilenameProfile">{{ filenameBusy ? 'Saving…' : 'Save filename rules' }}</button>
            </div>
            <p class="filename-rule-note">Parser order: remove extension → ignore everything from the first hyphen → split on the delimiter → ignore numeric-only tokens and exact v1/V2-style tokens → map remaining positions. Example: <code>blue_1h_0f_dotted-v5ab.png</code> maps tokens 1–4 as <code>blue</code>, <code>1h</code>, <code>0f</code>, <code>dotted</code>.</p>
            <div class="filename-actions"><button class="secondary-button" :disabled="filenameBusy || filenameProfileDirty" @click="previewFilenameTags">{{ filenameBusy ? 'Scanning…' : filenameProfileDirty ? 'Save rules before preview' : 'Preview all gallery images' }}</button><button v-if="filenamePreview" class="primary-button" :disabled="filenameBusy || !filenamePreview.files.length" @click="applyFilenameTags">Apply reviewed tags</button></div>
            <p v-if="filenameError" class="error-text" role="alert">{{ filenameError }}</p>
            <div v-if="filenamePreview" class="filename-preview" aria-live="polite">
              <div class="filename-preview-summary"><strong>{{ filenamePreview.files.length }} of {{ filenamePreview.totalDiscovered }} images previewed</strong><span>Preview does not change files or manifest.</span></div>
              <p v-if="filenamePreview.profile.slots.length === 0" class="error-text">Map at least one token position and save the profile before applying tags.</p>
              <div v-if="unknownFilenameValues.length" class="filename-unknown-mappings">
                <strong>Map each filename token once</strong>
                <div v-for="issue in unknownFilenameValues" :key="`${issue.categoryId}-${issue.token}`" class="unknown-mapping-row">
                  <span><code>{{ issue.token }}</code> → {{ issue.categoryName }}</span>
                  <select :value="filenameGlobalResolutions[issue.categoryId]?.[issue.token] ?? ''" @change="(filenameGlobalResolutions[issue.categoryId] ||= {})[issue.token] = $event.target.value">
                    <option value="">Choose a value…</option>
                    <option v-for="value in activeGallery.categories.find((item) => item.id === issue.categoryId)?.values ?? []" :key="value.id" :value="value.id">{{ value.label }}</option>
                  </select>
                </div>
              </div>
              <article v-for="file in filenamePreview.files" :key="file.assetPath" class="filename-file-row">
                <div class="filename-file-name"><strong>{{ file.sourceName }}</strong><code>{{ file.parsedStem }}<template v-if="file.ignoredSuffix !== null"> <span class="ignored-token">−{{ file.ignoredSuffix }}</span></template></code></div>
                <div class="filename-pills"><span v-for="token in file.tokens" :key="`${file.assetPath}-${token}`" class="filename-token">{{ token }}</span><span v-for="token in file.ignoredTokens" :key="`${file.assetPath}-ignored-${token}`" class="filename-token ignored-token">{{ token }} · ignored</span></div>
                <div v-if="Object.keys(file.assignments).length" class="proposed-tags"><span v-for="(valueId, categoryId) in file.assignments" :key="categoryId">{{ categoryName(categoryId) }} = {{ valueName(categoryId, valueId) }}</span></div>
                <div v-for="issue in file.issues" :key="`${file.assetPath}-${issue.categoryId}-${issue.code}`" class="tag-resolution">
                  <span class="tag-issue">{{ issue.message }}</span>
                  <span v-if="['unknown-value','ambiguous-value'].includes(issue.code)" class="mapping-hint">Use the shared mapping above.</span>
                  <label v-if="['unknown-value','ambiguous-value'].includes(issue.code) && filenameGlobalResolutions[issue.categoryId]?.[issue.token] && file.existingFeatures?.[issue.categoryId] && file.existingFeatures[issue.categoryId] !== filenameGlobalResolutions[issue.categoryId][issue.token]" class="form-field">Existing tag differs
                    <select v-model="fileDecision(file).conflicts[issue.categoryId]"><option value="">Choose…</option><option value="overwrite">Overwrite existing tag</option><option value="ignore">Keep existing tag</option></select>
                  </label>
                </div>
                <div v-for="conflict in file.conflicts" :key="`${file.assetPath}-${conflict.categoryId}`" class="tag-resolution conflict-resolution">
                  <span class="tag-issue">{{ categoryName(conflict.categoryId) }} is already {{ conflict.oldLabel }}; filename says {{ conflict.proposedLabel }}.</span>
                  <label class="form-field">Decision
                    <select v-model="fileDecision(file).conflicts[conflict.categoryId]"><option value="">Choose…</option><option value="overwrite">Overwrite existing tag</option><option value="ignore">Keep existing tag</option></select>
                  </label>
                </div>
                <label v-if="file.issues.length || file.outcome === 'ambiguous-record'" class="skip-file"><input v-model="fileDecision(file).skip" type="checkbox" /> Skip this file for now</label>
                <span class="file-outcome" :class="file.outcome">{{ file.outcome }}</span>
              </article>
            </div>
          </template>
        </section>

        <section v-if="activeGallery" class="game-options">
          <label class="form-field">Opening board <select v-model.number="startingBoardSize"><option :value="12">12 cards</option><option :value="15">15 cards</option></select></label>
          <label class="form-field">Sets to win <select v-model.number="targetSets"><option v-for="value in 27" :key="value" :value="value">{{ value }} {{ value === 1 ? 'Set' : 'Sets' }}</option></select></label>
          <button class="primary-button start-button" :disabled="!canStart" @click="startGame">{{ busy ? 'Checking…' : 'Start game' }} <span aria-hidden="true">↗</span></button>
        </section>
      </template>

      <footer class="footer"><span>Made for curious minds.</span><span>Everything stays on your machine.</span></footer>
    </template>

    <template v-else>
      <section class="game-header">
        <div><p class="eyebrow">SOLO GAME · {{ game.gallery.name }}</p><h1 class="game-title">Find a <em>Set.</em></h1><p class="helper-copy">A Set has all the same or all different values in every active category.</p></div>
        <div class="game-controls"><button class="secondary-button" @click="restartGame">↻ Restart</button></div>
      </section>
      <section class="active-rules" aria-label="Active game categories"><div v-for="category in game.categories" :key="category.id" class="rule-pill"><strong>{{ category.name }}</strong><span>{{ category.values.map((value) => value.label).join(' · ') }}</span></div></section>
      <section class="scorebar" aria-label="Game status"><div><small>SETS</small><strong>{{ game.score }} <i>/ {{ game.targetSets }}</i></strong></div><div><small>MISTAKES</small><strong>{{ game.mistakes }}</strong></div><div><small>TIME</small><strong>{{ formattedTime }}</strong></div><div><small>DECK</small><strong>{{ game.remainingCount }}</strong></div></section>
      <div v-if="message" class="toast" :class="messageType" role="status">{{ message }}</div>
      <div v-if="game.status !== 'active'" class="end-banner" role="status"><div><p class="eyebrow">GAME COMPLETE</p><h2>{{ game.outcome === 'won' ? 'You found enough Sets!' : 'No Sets remain.' }}</h2><p>{{ game.outcome === 'won' ? `You reached ${game.targetSets} Sets.` : 'The deck is exhausted and the board has no Set.' }} · {{ formattedTime }} · {{ game.mistakes }} mistakes</p></div><button class="primary-button" @click="restartGame">Play again <span aria-hidden="true">↻</span></button></div>
      <section class="board-section" aria-label="Set game cards">
        <div class="hint-button-row" aria-label="Hint and cheat controls">
          <button class="hint-button reveal" :class="{ active: hintModes.revealOne }" @click="setHintMode('revealOne')">Reveal one</button>
          <button class="hint-button reveal" :class="{ active: hintModes.revealTwo }" @click="setHintMode('revealTwo')">Reveal two</button>
          <button class="hint-button reveal" :class="{ active: hintModes.revealThree }" @click="setHintMode('revealThree')">Reveal three</button>
          <div v-if="game.categories?.length" class="hint-category-picker">
            <button class="hint-button category" :class="{ active: hintModes.highlightCategory }" @click="setHintMode('highlightCategory')">Highlight category</button>
            <select v-model="highlightCategorySelection.categoryId" v-if="hintModes.highlightCategory" class="hint-category-select" aria-label="Choose category to highlight" @change="syncHighlightCategorySelection()">
              <option v-for="category in game.categories" :key="category.id" :value="category.id">{{ category.name }}</option>
            </select>
            <select v-model="highlightCategorySelection.valueId" v-if="hintModes.highlightCategory && highlightCategorySelection.categoryId" class="hint-category-select" aria-label="Choose value to highlight" @change="syncHighlightCategorySelection()">
              <option v-for="value in (game.categories.find((category) => category.id === highlightCategorySelection.categoryId)?.values ?? [])" :key="value.id" :value="value.id">{{ value.label }}</option>
            </select>
          </div>
          <button class="hint-button invalid" :class="{ active: hintModes.fadeInvalid }" @click="setHintMode('fadeInvalid')">Fade invalid</button>
          <button class="hint-button accent" :class="{ active: hintModes.highlightNewCards }" @click="setHintMode('highlightNewCards')">Highlight new cards</button>
          <button class="hint-button accent" :class="{ active: hintModes.showCategoryOverlay }" @click="setHintMode('showCategoryOverlay')">Show category overlay</button>
        </div>
        <TransitionGroup name="card" tag="div" class="board-grid" :class="{ 'expanded-board': game.board.length > 15 }">
          <button v-for="card in game.board" :key="card.id" class="playing-card" :class="cardClasses(card)" :aria-pressed="selectedCardIds.includes(card.id)" :aria-label="cardLabel(card)" :disabled="game.status !== 'active' || busy || lightboxOpen" @click="toggleCard(card)">
            <img class="card-art-image" :src="card.imageUrl" alt="" loading="lazy" />
            <span v-if="hintModes.showCategoryOverlay" class="card-overlay" aria-hidden="true">
              <span v-for="(entry, index) in cardOverlayEntries(card)" :key="`${card.id}-${entry.position}`" class="card-overlay-value" :class="`position-${index + 1}`">{{ entry.label }}</span>
            </span>
          </button>
        </TransitionGroup>
      </section>
      <div class="game-bottom"><span>{{ selectedCardIds.length }} / 3 selected</span><button v-if="game.canDealThree" class="secondary-button" :disabled="busy" @click="dealThree">No Set? Deal 3</button><span v-else-if="game.status === 'active'" class="helper-copy">Select any three cards to test them.</span></div>
      <footer class="footer"><span>Only the four shown categories count.</span><span>Everything stays on your machine.</span></footer>
    </template>

    <Transition name="fade">
      <div v-if="lightboxOpen" class="lightbox-backdrop" role="presentation" @click.self="dismissReward">
        <section class="reward-lightbox" role="dialog" aria-modal="true" aria-labelledby="reward-title">
          <button ref="lightboxCloseButton" class="lightbox-close" aria-label="Close matched cards" @click="dismissReward">×</button>
          <p class="eyebrow">SET FOUND</p><h2 id="reward-title">A lovely connection.</h2>
          <div class="trophy-cards"><article v-for="card in matchedCards" :key="card.id" class="trophy-card"><img :src="card.imageUrl" alt="Matched game card" /><dl><div v-for="category in game.categories" :key="category.id"><dt>{{ category.name }}</dt><dd>{{ card.features[category.id]?.label }}</dd></div></dl></article></div>
          <button class="primary-button continue-button" @click="dismissReward">{{ game?.status === 'active' ? 'Keep playing' : 'See results' }} <span aria-hidden="true">→</span></button>
        </section>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="isLocalClient && galleryLightboxCard" class="lightbox-backdrop" role="presentation" @click.self="galleryLightboxCard = null">
        <section class="reward-lightbox gallery-image-lightbox" :class="{ maximized: galleryImageMaximized }" role="dialog" aria-modal="true" aria-labelledby="gallery-lightbox-title">
          <button class="lightbox-close" aria-label="Close gallery image" @click="galleryLightboxCard = null">×</button>
          <p class="eyebrow">GALLERY CARD</p>
          <h2 id="gallery-lightbox-title">{{ galleryLightboxCard.id }}</h2>
          <div class="gallery-lightbox-path">{{ galleryLightboxCard.directory || '(root)' }}/{{ galleryLightboxCard.filename || galleryLightboxCard.image || '' }}</div>
          <div class="gallery-lightbox-nav">
            <button class="secondary-button" @click="previousGalleryCard">← Previous</button>
            <button class="secondary-button" @click="nextGalleryCard">Next →</button>
            <button class="secondary-button" @click="galleryImageMaximized = !galleryImageMaximized">{{ galleryImageMaximized ? 'Fit to dialog' : 'Maximize image' }}</button>
          </div>
          <img class="gallery-lightbox-image" :src="galleryCardImageUrl(galleryLightboxCard)" :alt="`Large gallery image ${galleryLightboxCard.id}`" />
          <dl class="gallery-lightbox-meta">
            <div v-for="category in activeGallery?.categories ?? []" :key="category.id">
              <dt>{{ category.name }}</dt>
              <dd>{{ galleryLightboxCard.featureSummary?.[category.id] ? valueName(category.id, galleryLightboxCard.featureSummary[category.id]) : 'Missing' }}</dd>
            </div>
          </dl>
          <div class="gallery-lightbox-actions"><button class="primary-button" @click="openGalleryCardEditor">Edit this card</button></div>
        </section>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="isLocalClient && galleryEditCard" class="lightbox-backdrop editor-backdrop" role="presentation" @click.self="galleryEditCard = null">
        <section class="reward-lightbox gallery-card-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="card-editor-title">
          <button class="lightbox-close" aria-label="Close card editor" @click="galleryEditCard = null">×</button>
          <p class="eyebrow">EDIT GALLERY CARD</p>
          <h2 id="card-editor-title">{{ galleryEditCard.id }}</h2>
          <div class="gallery-edit-preview" @dragover.prevent @drop.prevent="onGalleryImageDrop">
            <img :src="galleryCardImageUrl(galleryEditCard)" :alt="`Preview of ${galleryEditCard.filename}`" />
            <span>Drop an image here to replace this one</span>
          </div>
          <section class="card-assignment-editor" aria-labelledby="card-assignment-heading">
            <div class="editor-section-heading"><h3 id="card-assignment-heading">Choose values</h3><span>Click one value in each category. Saving replaces any existing value.</span></div>
            <div v-for="category in activeGallery?.categories ?? []" :key="category.id" class="editor-category-values">
              <strong>{{ category.name }}</strong>
              <div class="gallery-value-filter-pills">
                <button v-for="value in category.values" :key="value.id" class="gallery-value-pill" :class="{ active: galleryEditValues[category.id] === value.id }" :aria-pressed="galleryEditValues[category.id] === value.id" @click="selectGalleryEditValue(category.id, value.id)">{{ value.label }}</button>
              </div>
            </div>
          </section>
          <div class="card-replace-controls">
            <button class="secondary-button" :disabled="galleryEditorBusy" @click="galleryImageInput?.click()">{{ galleryEditorBusy ? 'Saving…' : 'Choose replacement image' }}</button>
            <input ref="galleryImageInput" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="replaceGalleryCardImage($event.target.files?.[0])" />
            <span>PNG, JPEG, GIF, or WebP · up to 8 MB</span>
          </div>
          <p v-if="galleryEditorError" class="error-text" role="alert">{{ galleryEditorError }}</p>
          <div class="editor-dialog-actions">
            <button class="secondary-button" :disabled="galleryEditorBusy" @click="returnToGalleryImage">Back to image</button>
            <button class="primary-button" :disabled="galleryEditorBusy || !Object.keys(galleryEditValues).some((id) => galleryEditValues[id])" @click="saveGalleryCardAssignment">{{ galleryEditorBusy ? 'Saving…' : 'Save changes' }}</button>
          </div>
        </section>
      </div>
    </Transition>
  </main>
</template>
