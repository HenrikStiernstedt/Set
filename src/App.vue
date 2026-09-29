<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

const apiStatus = ref('checking');
const apiMessage = ref('Connecting to the local game service…');
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
const lightboxOpen = ref(false);
const lightboxCloseButton = ref(null);
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
    const data = await requestJson('/api/galleries');
    galleries.value = data.galleries ?? [];
    apiStatus.value = 'online';
    apiMessage.value = `Local service online · ${galleries.value.length} ${galleries.value.length === 1 ? 'gallery' : 'galleries'} found`;
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
  void loadFilenameProfile(galleryId);
  void refreshReadiness();
}

async function loadFilenameProfile(galleryId) {
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
  lightboxOpen.value = false;
  message.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
    const result = await requestJson(`/api/games/${game.value.id}/match`, {
      method: 'POST',
      body: JSON.stringify({ cardIds: [...selectedCardIds.value] }),
    });
    game.value = { ...result.game, _clientStartedAt: game.value._clientStartedAt };
    selectedCardIds.value = [];
    if (result.valid) {
      matchedCards.value = result.matched;
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
    const result = await requestJson(`/api/games/${game.value.id}/deal`, { method: 'POST', body: '{}' });
    game.value = { ...result.game, _clientStartedAt: game.value._clientStartedAt };
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
  if (event.key === 'Escape' && lightboxOpen.value) dismissReward();
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

        <section v-if="activeGallery" class="category-setup" aria-labelledby="category-heading">
          <div class="section-title-row"><div><p class="eyebrow">02 / GAME RULES</p><h2 id="category-heading">Choose four categories</h2></div><span class="selection-counter">{{ selectedCategoryIds.length }} <span>selected · choose 4</span></span></div>
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

        <section v-if="activeGallery" class="filename-tagging-panel">
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
        <TransitionGroup name="card" tag="div" class="board-grid" :class="{ 'expanded-board': game.board.length > 15 }">
          <button v-for="card in game.board" :key="card.id" class="playing-card" :class="{ selected: selectedCardIds.includes(card.id) }" :aria-pressed="selectedCardIds.includes(card.id)" :aria-label="cardLabel(card)" :disabled="game.status !== 'active' || busy || lightboxOpen" @click="toggleCard(card)">
            <img class="card-art-image" :src="card.imageUrl" alt="" loading="lazy" />
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
  </main>
</template>
