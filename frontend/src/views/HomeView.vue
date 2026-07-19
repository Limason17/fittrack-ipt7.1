<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { apiRequest } from '../utils/api'
import { authToken, authUser } from '../utils/auth'
import { formatDate, t } from '../utils/i18n'

const loggedIn = computed(() => !!authToken.value)
const user = computed(() => authUser.value)
const features = computed(() => t('home.features'))

const quickLinks = [
  { route: '/exercises', labelKey: 'nav.exercises', actionKey: 'home.manage' },
  { route: '/workouts', labelKey: 'nav.workouts', actionKey: 'home.open' },
  { route: '/progress', labelKey: 'nav.progress', actionKey: 'home.view' },
]

const statsLoading = ref(false)
const statsError = ref('')
const workoutCount = ref(null)
const exerciseCount = ref(null)
const lastWorkout = ref(null)

async function loadStats() {
  if (!authToken.value) return
  statsLoading.value = true
  statsError.value = ''
  try {
    const [workouts, exercises] = await Promise.all([
      apiRequest('/workouts', { token: authToken.value }),
      apiRequest('/exercises', { token: authToken.value }),
    ])
    workoutCount.value = Array.isArray(workouts) ? workouts.length : 0
    exerciseCount.value = Array.isArray(exercises) ? exercises.length : 0
    lastWorkout.value = Array.isArray(workouts) && workouts.length
      ? [...workouts].sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))[0]
      : null
  } catch {
    statsError.value = t('home.statsError')
  } finally {
    statsLoading.value = false
  }
}

onMounted(loadStats)
watch(authToken, (value) => { if (value) loadStats() })
</script>

<template>
  <section class="section">
    <div class="page-container hero">
      <div class="hero-left">
        <span class="eyebrow">
          {{ loggedIn ? t('home.loggedInEyebrow') : t('home.guestEyebrow') }}
        </span>

        <h1 class="hero-title">
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

  <section v-if="loggedIn" class="section compact-section">
    <div class="page-container">
      <h2 class="stats-title">{{ t('home.statsTitle') }}</h2>
      <p v-if="statsError" class="message message-error" role="alert">{{ statsError }}</p>
      <div class="stat-grid" :aria-busy="statsLoading">
        <template v-if="statsLoading">
          <div class="card stat-card skeleton" style="height: 92px;"></div>
          <div class="card stat-card skeleton" style="height: 92px;"></div>
          <div class="card stat-card skeleton" style="height: 92px;"></div>
        </template>
        <template v-else-if="!statsError">
          <article class="card stat-card">
            <span class="stat-label">{{ t('home.statWorkouts') }}</span>
            <strong class="stat-value">{{ workoutCount ?? '–' }}</strong>
          </article>
          <article class="card stat-card">
            <span class="stat-label">{{ t('home.statExercises') }}</span>
            <strong class="stat-value">{{ exerciseCount ?? '–' }}</strong>
          </article>
          <article class="card stat-card">
            <span class="stat-label">{{ t('home.statLastActivity') }}</span>
            <strong class="stat-value stat-value-text">
              {{ lastWorkout ? `${lastWorkout.title} · ${formatDate(lastWorkout.workout_date)}` : t('home.noActivity') }}
            </strong>
          </article>
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
  margin-bottom: 0.5rem;
  font-size: clamp(1.9rem, 3.6vw, 2.75rem);
  font-weight: 850;
  letter-spacing: -0.01em;
  line-height: 1.1;
}

.hero-actions {
  display: flex;
  gap: 0.8rem;
  margin-top: 1.6rem;
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
  font-size: 1.1rem;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.preview-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 54px;
  padding: 0.8rem 0.9rem;
  border-radius: var(--radius);
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

.stats-title {
  font-size: var(--text-lg);
  margin-bottom: 0.85rem;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.stat-card {
  padding: 1rem 1.1rem;
  display: grid;
  gap: 0.3rem;
  align-content: center;
}

.stat-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.stat-value {
  font-size: 1.6rem;
  font-weight: 800;
}

.stat-value-text {
  font-size: var(--text-base);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.feature-card {
  padding: 1.25rem;
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

@media (max-width: 560px) {
  .hero {
    gap: 1.25rem;
  }

  .hero-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }

  .hero-actions .btn {
    width: 100%;
  }

  .hero-panel,
  .feature-card {
    padding: 1rem;
  }

  .preview-item {
    align-items: flex-start;
    flex-direction: column;
    min-height: auto;
    gap: 0.25rem;
  }
}
</style>
