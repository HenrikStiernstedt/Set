<script setup>
import { onMounted, ref } from 'vue';

const apiStatus = ref('checking');
const apiMessage = ref('Connecting to the local game service…');

onMounted(async () => {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    apiStatus.value = 'online';
    apiMessage.value = `Local service online · ${health.mode} mode`;
  } catch {
    apiStatus.value = 'offline';
    apiMessage.value = 'Start the Node service to connect the app.';
  }
});
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Set Gallery home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>set<span class="brand-light">gallery</span></span>
      </a>
      <span class="local-label"><span class="local-dot"></span> PRIVATE BY DESIGN</span>
    </header>

    <section class="hero" aria-labelledby="welcome-title">
      <div class="hero-copy">
        <p class="eyebrow">YOUR COLLECTION. YOUR RULES.</p>
        <h1 id="welcome-title">A different kind<br />of picture <em>game.</em></h1>
        <p class="intro">Build a Set game from the images you love. Choose a gallery, find the pattern, and see what connections you can make.</p>
        <div class="actions">
          <button class="primary-button" disabled title="Gallery setup arrives in the next build step">Explore galleries <span aria-hidden="true">↗</span></button>
          <span class="coming-note">Gallery setup is coming next</span>
        </div>
      </div>

      <div class="sample-board" aria-label="Decorative example cards">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
        <article class="mini-card card-a"><span class="shape shape-circle"></span><span class="shape shape-circle"></span></article>
        <article class="mini-card card-b"><span class="shape shape-diamond"></span><span class="shape shape-diamond"></span><span class="shape shape-diamond"></span></article>
        <article class="mini-card card-c"><span class="shape shape-wave"></span></article>
        <span class="spark spark-one">✳</span><span class="spark spark-two">✦</span>
        <span class="board-caption">three cards · one connection</span>
      </div>
    </section>

    <section class="status-panel" aria-label="Build status">
      <div class="status-indicator" :class="apiStatus"><span class="pulse"></span></div>
      <div class="status-copy"><strong>Milestone 0 · Project foundation</strong><span>{{ apiMessage }}</span></div>
      <span class="status-tag">SCAFFOLD</span>
    </section>

    <footer class="footer">
      <span>Made for curious minds.</span>
      <span>Everything stays on your machine.</span>
    </footer>
  </main>
</template>
