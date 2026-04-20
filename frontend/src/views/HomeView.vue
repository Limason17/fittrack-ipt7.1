<script setup>
import { RouterLink } from 'vue-router'

const features = [
  {
    title: 'Übungen sammeln',
    text: 'Lege deine wichtigsten Übungen zentral ab und halte dein Training übersichtlich.',
  },
  {
    title: 'Workouts planen',
    text: 'Baue dir einen klaren Trainingsplan auf, statt überall Notizen zu verteilen.',
  },
  {
    title: 'Fortschritt sehen',
    text: 'Verfolge Gewichte, Wiederholungen und deine Entwicklung mit mehr Struktur.',
  },
]
</script>

<template>
  <section class="section">
    <div class="page-container hero">
      <div class="hero-left">
        <span class="eyebrow">Einfaches Trainingstracking</span>
        <h1 class="page-title hero-title">
          Eine ruhigere Art, dein Training zu organisieren.
        </h1>
        <p class="page-subtitle">
          FitTrack soll sich nicht wie ein lautes Fitness-Template anfühlen,
          sondern wie ein klares Werkzeug, das du wirklich gern benutzt.
        </p>

        <div class="hero-actions">
          <RouterLink to="/register" class="btn btn-primary">Jetzt starten</RouterLink>
          <RouterLink to="/login" class="btn btn-secondary">Login</RouterLink>
        </div>
      </div>

      <div class="hero-right card">
        <div class="preview-top">
          <span>Diese Woche</span>
          <strong>4 Einheiten geplant</strong>
        </div>

        <div class="preview-list">
          <div class="preview-item">
            <span>Montag</span>
            <strong>Push</strong>
          </div>
          <div class="preview-item">
            <span>Mittwoch</span>
            <strong>Pull</strong>
          </div>
          <div class="preview-item">
            <span>Freitag</span>
            <strong>Legs</strong>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section features-section">
    <div class="page-container">
      <div class="grid-3">
        <article v-for="feature in features" :key="feature.title" class="feature-card card">
          <h2>{{ feature.title }}</h2>
          <p>{{ feature.text }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 2rem;
  align-items: center;
}

.hero-title {
  max-width: 700px;
}

.hero-actions {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
  flex-wrap: wrap;
}

.hero-right {
  padding: 1.5rem;
  background: #fcfbf8;
}

.preview-top {
  display: flex;
  flex-direction: column;
  margin-bottom: 1.5rem;
}

.preview-top span {
  color: var(--text-soft);
  margin-bottom: 0.35rem;
}

.preview-top strong {
  font-size: 1.35rem;
  font-weight: 750;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.preview-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.95rem 1rem;
  border-radius: 14px;
  background: #fff;
  border: 1px solid var(--border);
}

.preview-item span {
  color: var(--text-soft);
}

.preview-item strong {
  font-weight: 700;
}

.feature-card {
  padding: 1.6rem;
}

.feature-card h2 {
  font-size: 1.15rem;
  font-weight: 750;
  margin-bottom: 0.65rem;
}

.feature-card p {
  color: var(--text-soft);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }
}
</style>