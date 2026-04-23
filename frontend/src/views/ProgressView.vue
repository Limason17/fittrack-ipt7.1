<script setup>
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">Fortschritt</span>
        <h1 class="page-title">Deine Entwicklung</h1>
        <p class="page-subtitle">
          Hier wirst du später sehen, wie sich deine Leistungen mit der Zeit verändern.
        </p>
      </div>

      <div class="progress-empty card">
        <h2>Noch keine Fortschrittsdaten vorhanden</h2>
        <p>
          Sobald du Trainingseinträge erfasst, kannst du hier frühere und aktuelle Werte
          miteinander vergleichen.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 2rem;
}

.progress-empty {
  padding: 1.6rem;
}

.progress-empty h2 {
  font-size: 1.1rem;
  font-weight: 750;
  margin-bottom: 0.5rem;
}

.progress-empty p {
  color: var(--text-soft);
}
</style>