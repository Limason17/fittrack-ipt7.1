<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { authUser, authToken } from '../utils/auth'

const loggedIn = computed(() => !!authToken.value)
const user = computed(() => authUser.value)

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
        <span class="eyebrow">
          {{ loggedIn ? 'Dein Bereich' : 'Einfaches Trainingstracking' }}
        </span>

        <h1 class="page-title hero-title">
          <template v-if="loggedIn">
            Willkommen zurück, {{ user?.username }}.
          </template>
          <template v-else>
            Eine ruhigere Art, dein Training zu organisieren.
          </template>
        </h1>

        <p class="page-subtitle">
          <template v-if="loggedIn">
            Verwalte deine Übungen, plane deine Workouts und behalte deinen Fortschritt an einem Ort.
          </template>
          <template v-else>
            FitTrack soll sich nicht wie ein lautes Fitness-Template anfühlen,
            sondern wie ein klares Werkzeug, das du wirklich gern benutzt.
          </template>
        </p>

        <div class="hero-actions">
          <template v-if="loggedIn">
            <RouterLink to="/workouts" class="btn btn-primary">Zu deinen Workouts</RouterLink>
            <RouterLink to="/progress" class="btn btn-secondary">Fortschritt ansehen</RouterLink>
          </template>

          <template v-else>
            <RouterLink to="/register" class="btn btn-primary">Jetzt starten</RouterLink>
            <RouterLink to="/login" class="btn btn-secondary">Login</RouterLink>
          </template>
        </div>
      </div>

      <div class="hero-right card">
        <template v-if="loggedIn">
          <div class="preview-top">
            <span>Dein Schnellzugriff</span>
            <strong>Was möchtest du heute machen?</strong>
          </div>

          <div class="preview-list">
            <RouterLink to="/exercises" class="preview-item preview-link">
              <span>Übungen</span>
              <strong>Verwalten</strong>
            </RouterLink>

            <RouterLink to="/workouts" class="preview-item preview-link">
              <span>Workouts</span>
              <strong>Öffnen</strong>
            </RouterLink>

            <RouterLink to="/progress" class="preview-item preview-link">
              <span>Fortschritt</span>
              <strong>Ansehen</strong>
            </RouterLink>
          </div>
        </template>

        <template v-else>
          <div class="preview-top">
            <span>Persönlicher Bereich</span>
            <strong>Bitte zuerst einloggen</strong>
          </div>

          <div class="preview-list">
            <div class="preview-item">
              <span>Geplante Übungen</span>
              <RouterLink to="/login" class="inline-login-link">Zum Login</RouterLink>
            </div>

            <div class="preview-item">
              <span>Deine Workouts</span>
              <RouterLink to="/login" class="inline-login-link">Zum Login</RouterLink>
            </div>

            <div class="preview-item">
              <span>Dein Fortschritt</span>
              <RouterLink to="/login" class="inline-login-link">Zum Login</RouterLink>
            </div>
          </div>
        </template>
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
  gap: 1rem;
}

.preview-item span {
  color: var(--text-soft);
}

.preview-item strong {
  font-weight: 700;
}

.preview-link {
  transition: 0.2s ease;
}

.preview-link:hover {
  transform: translateY(-1px);
  background: #f8f5ef;
}

.inline-login-link {
  font-weight: 700;
  color: var(--text);
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