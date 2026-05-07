<script setup>
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { authToken, authUser, logout } from '../utils/auth'
import { locale, t, toggleLanguage } from '../utils/i18n'
import fitTrackLogo from '../assets/FitTrack Logo/FitTrack Logo.png'

const router = useRouter()

const loggedIn = computed(() => !!authToken.value)
const user = computed(() => authUser.value)

function handleLogout() {
  logout()
  router.push('/login')
}
</script>

<template>
  <nav class="nav-wrap">
    <div class="page-container">
      <div class="nav-inner">
        <RouterLink to="/" class="brand" aria-label="FitTrack">
          <img class="brand-logo" :src="fitTrackLogo" alt="FitTrack" />
        </RouterLink>

        <div v-if="loggedIn" class="nav-links">
          <RouterLink to="/exercises">{{ t('nav.exercises') }}</RouterLink>
          <RouterLink to="/workouts">{{ t('nav.workouts') }}</RouterLink>
          <RouterLink to="/progress">{{ t('nav.progress') }}</RouterLink>
        </div>

        <div class="nav-actions">
          <button
              class="language-switch"
              type="button"
              :title="t('nav.languageTitle')"
              :aria-label="t('nav.languageLabel')"
              @click="toggleLanguage"
          >
            {{ locale.toUpperCase() }}
          </button>

          <template v-if="loggedIn">
            <span class="user-name">
              {{ user?.username || t('nav.loggedIn') }}
            </span>
            <button class="btn btn-primary" type="button" @click="handleLogout">
              {{ t('nav.logout') }}
            </button>
          </template>

          <template v-else>
            <RouterLink to="/login" class="btn btn-secondary">{{ t('nav.login') }}</RouterLink>
            <RouterLink to="/register" class="btn btn-primary">{{ t('nav.register') }}</RouterLink>
          </template>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.nav-wrap {
  position: sticky;
  top: 0;
  z-index: 1000;
  padding: 0.8rem 0;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(14px);
}

.nav-inner {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1.2rem;
}

.brand {
  display: inline-flex;
  align-items: center;
  width: fit-content;
}

.brand-logo {
  display: block;
  width: 132px;
  height: 42px;
  object-fit: contain;
  object-position: left center;
}

.nav-links {
  display: flex;
  justify-content: center;
  gap: 0.4rem;
}

.nav-links a {
  color: var(--text-soft);
  font-weight: 700;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
}

.nav-links a.router-link-active,
.nav-links a:hover {
  color: var(--text);
  background: var(--surface-soft);
}

.nav-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.language-switch {
  min-width: 44px;
  height: 38px;
  padding: 0 0.65rem;
  border-radius: 8px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  color: var(--text);
  font-weight: 800;
}

.language-switch:hover {
  border-color: var(--accent);
}

.user-name {
  max-width: 150px;
  overflow: hidden;
  color: var(--text-soft);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 820px) {
  .nav-inner {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .nav-links {
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 0.1rem;
  }

  .nav-actions {
    justify-content: flex-start;
  }
}
</style>
