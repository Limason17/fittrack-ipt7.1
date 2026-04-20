<script setup>
const progressItems = [
  { exercise: 'Bankdrücken', before: '60 kg', now: '67.5 kg' },
  { exercise: 'Kniebeugen', before: '80 kg', now: '95 kg' },
  { exercise: 'Klimmzüge', before: '8 Wdh.', now: '12 Wdh.' },
]
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">Fortschritt</span>
        <h1 class="page-title">Deine Entwicklung</h1>
        <p class="page-subtitle">
          Vergleiche frühere Leistungen mit deinem aktuellen Stand.
        </p>
      </div>

      <div class="grid-3">
        <article v-for="item in progressItems" :key="item.exercise" class="progress-card card">
          <h2>{{ item.exercise }}</h2>
          <div class="values">
            <div>
              <span>Vorher</span>
              <strong>{{ item.before }}</strong>
            </div>
            <div>
              <span>Jetzt</span>
              <strong>{{ item.now }}</strong>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 2rem;
}

.progress-card {
  padding: 1.5rem;
}

.progress-card h2 {
  font-size: 1.1rem;
  font-weight: 750;
  margin-bottom: 1rem;
}

.values {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.values span {
  display: block;
  color: var(--text-soft);
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
}

.values strong {
  font-size: 1.15rem;
  font-weight: 750;
}
</style>