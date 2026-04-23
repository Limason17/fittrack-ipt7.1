<script setup>
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { authUser, authToken, logout } from '../utils/auth'

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
        <RouterLink to="/" class="brand">FitTrack</RouterLink>

        <div v-if="loggedIn" class="nav-links">
          <RouterLink to="/exercises">Übungen</RouterLink>
          <RouterLink to="/workouts">Workouts</RouterLink>
          <RouterLink to="/progress">Fortschritt</RouterLink>
        </div>

        <div class="nav-actions">
          <template v-if="loggedIn">
            <span class="user-name">
              {{ user?.username || 'Angemeldet' }}
            </span>
            <button class="btn btn-primary" @click="handleLogout">
              Logout
            </button>
          </template>

          <template v-else>
            <RouterLink to="/login" class="btn btn-secondary">Login</RouterLink>
            <RouterLink to="/register" class="btn btn-primary">Registrieren</RouterLink>
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
  padding: 1rem 0;
  background: #d9d1c6;
  border-bottom: 1px solid var(--border);
}

.nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0.2rem 0;
}

.brand {
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.nav-links {
  display: flex;
  gap: 2rem;
}

.nav-links a {
  color: var(--text-soft);
  font-weight: 600;
}

.nav-links a.router-link-active,
.nav-links a:hover {
  color: var(--text);
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.user-name {
  font-weight: 700;
  color: var(--text);
}

@media (max-width: 900px) {
  .nav-inner {
    flex-direction: column;
    align-items: flex-start;
  }

  .nav-links,
  .nav-actions {
    flex-wrap: wrap;
  }
}
</style>