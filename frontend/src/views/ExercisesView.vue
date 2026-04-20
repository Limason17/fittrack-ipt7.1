<script setup>
const exerciseItems = [
  { name: 'Bankdrücken', category: 'Brust', note: 'Klassische Grundübung' },
  { name: 'Kniebeugen', category: 'Beine', note: 'Stabilität und Kraft' },
  { name: 'Klimmzüge', category: 'Rücken', note: 'Eigengewicht' },
  { name: 'Schulterdrücken', category: 'Schultern', note: 'Oberkörperdruck' },
]
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">Übungen</span>
        <h1 class="page-title">Deine Übungsübersicht</h1>
        <p class="page-subtitle">
          Hier kannst du deine wichtigsten Übungen sammeln und geordnet anzeigen.
        </p>
      </div>

      <div class="toolbar">
        <input class="input" type="text" placeholder="Übung suchen" />
        <button class="btn btn-primary">Neue Übung</button>
      </div>

      <div class="grid-2">
        <article v-for="exercise in exerciseItems" :key="exercise.name" class="exercise-card card">
          <h2>{{ exercise.name }}</h2>
          <p>{{ exercise.category }}</p>
          <span>{{ exercise.note }}</span>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 2rem;
}

.toolbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.exercise-card {
  padding: 1.5rem;
}

.exercise-card h2 {
  font-size: 1.15rem;
  font-weight: 750;
  margin-bottom: 0.4rem;
}

.exercise-card p {
  color: var(--text-soft);
  margin-bottom: 0.7rem;
}

.exercise-card span {
  color: var(--text-muted);
  font-size: 0.95rem;
}

@media (max-width: 900px) {
  .toolbar {
    grid-template-columns: 1fr;
  }
}
</style>