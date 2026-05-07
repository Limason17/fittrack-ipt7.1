<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { authToken, authUser } from '../utils/auth'
import { t } from '../utils/i18n'

const loggedIn = computed(() => !!authToken.value)
const user = computed(() => authUser.value)
const features = computed(() => t('home.features'))

const quickLinks = [
  { route: '/exercises', labelKey: 'nav.exercises', actionKey: 'home.manage' },
  { route: '/workouts', labelKey: 'nav.workouts', actionKey: 'home.open' },
  { route: '/progress', labelKey: 'nav.progress', actionKey: 'home.view' },
]
</script>

<template>
  <section class="section">
    <div class="page-container hero">
      <div class="hero-left">
        <span class="eyebrow">
          {{ loggedIn ? t('home.loggedInEyebrow') : t('home.guestEyebrow') }}
        </span>

        <h1 class="page-title hero-title">
          <template v-if="loggedIn">
            {{ t('home.loggedInTitle', { username: user?.username || '' }) }}
          </template>
          <template v-else>
            {{ t('home.guestTitle') }}
          </template>
        </h1>

        <p class="page-subtitle">
          {{ loggedIn ? t('home.loggedInSubtitle') : t('home.guestSubtitle') }}
        </p>

        <div class="hero-actions">
          <template v-if="loggedIn">
            <RouterLink to="/workouts" class="btn btn-primary">{{ t('home.workoutsCta') }}</RouterLink>
            <RouterLink to="/progress" class="btn btn-secondary">{{ t('home.progressCta') }}</RouterLink>
          </template>

          <template v-else>
            <RouterLink to="/register" class="btn btn-primary">{{ t('home.start') }}</RouterLink>
            <RouterLink to="/login" class="btn btn-secondary">{{ t('home.login') }}</RouterLink>
          </template>
        </div>
      </div>

      <div class="hero-panel card">
        <template v-if="loggedIn">
          <div class="panel-top">
            <span>{{ t('home.quickAccess') }}</span>
            <strong>{{ t('home.quickQuestion') }}</strong>
          </div>

          <div class="preview-list">
            <RouterLink
                v-for="link in quickLinks"
                :key="link.route"
                :to="link.route"
                class="preview-item preview-link"
            >
              <span>{{ t(link.labelKey) }}</span>
              <strong>{{ t(link.actionKey) }}</strong>
            </RouterLink>
          </div>
        </template>

        <template v-else>
          <div class="panel-top">
            <span>{{ t('home.personalArea') }}</span>
            <strong>{{ t('home.loginRequired') }}</strong>
          </div>

          <div class="preview-list">
            <RouterLink
                v-for="link in quickLinks"
                :key="link.route"
                to="/login"
                class="preview-item preview-link"
            >
              <span>{{ t(link.labelKey) }}</span>
              <strong>{{ t('nav.login') }}</strong>
            </RouterLink>
          </div>
        </template>
      </div>
    </div>
  </section>

  <section class="section compact-section">
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
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 2rem;
  align-items: center;
}

.hero-title {
  max-width: 720px;
}

.hero-actions {
  display: flex;
  gap: 0.8rem;
  margin-top: 1.8rem;
  flex-wrap: wrap;
}

.hero-panel {
  padding: 1.2rem;
}

.panel-top {
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;
}

.panel-top span {
  color: var(--text-soft);
  margin-bottom: 0.25rem;
}

.panel-top strong {
  font-size: 1.15rem;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.preview-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 56px;
  padding: 0.8rem 0.9rem;
  border-radius: 8px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  gap: 1rem;
}

.preview-item span {
  color: var(--text-soft);
}

.preview-item strong {
  font-weight: 800;
}

.preview-link:hover {
  border-color: var(--accent);
}

.compact-section {
  padding-top: 0;
}

.feature-card {
  padding: 1.3rem;
}

.feature-card h2 {
  font-size: 1.05rem;
  font-weight: 800;
  margin-bottom: 0.5rem;
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
