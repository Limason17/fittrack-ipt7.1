<script setup>
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { authToken, authUser, logout } from '../../utils/auth'
import { locale, t, toggleLanguage } from '../../utils/i18n'
import { distanceUnit, toggleDistanceUnit, weightUnit, toggleWeightUnit } from '../../utils/units'
import Dropdown from '../ui/Dropdown.vue'
import fitTrackLogo from '../../assets/FitTrack Logo/FitTrack Logo.png'

const props = defineProps({ sidebarOpen: { type: Boolean, default: false } })
const emit = defineEmits(['toggle-sidebar'])
const router = useRouter()

const loggedIn = computed(() => !!authToken.value)
const user = computed(() => authUser.value)
const initial = computed(() => user.value?.username?.charAt(0)?.toUpperCase() || '?')

function handleLogout() {
  logout()
  router.push('/login')
}
</script>

<template>
  <header class="app-header">
    <div class="app-header-left">
      <button
        v-if="loggedIn"
        type="button"
        class="app-header-burger mobile-only"
        :class="{ active: sidebarOpen }"
        :aria-label="t(sidebarOpen ? 'routing.closeMenu' : 'routing.openMenu')"
        :aria-expanded="sidebarOpen"
        aria-controls="app-sidebar-nav"
        @click="emit('toggle-sidebar')"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <RouterLink v-if="!loggedIn" to="/" class="app-header-logo">
        <img :src="fitTrackLogo" alt="FitTrack" />
      </RouterLink>
    </div>

    <div class="app-header-right">
      <template v-if="loggedIn">
        <div class="app-header-toggles" role="group" :aria-label="t('routing.preferences')">
          <button
            type="button"
            class="app-header-toggle-btn"
            :aria-label="`${t('routing.language')}: ${locale.toUpperCase()}`"
            @click="toggleLanguage"
          >
            {{ locale.toUpperCase() }}
          </button>
          <button
            type="button"
            class="app-header-toggle-btn"
            :aria-label="`${t('routing.weightUnit')}: ${weightUnit.toUpperCase()}`"
            @click="toggleWeightUnit"
          >
            {{ weightUnit.toUpperCase() }}
          </button>
          <button
            type="button"
            class="app-header-toggle-btn"
            :aria-label="`${t('routing.distanceUnit')}: ${distanceUnit.toUpperCase()}`"
            @click="toggleDistanceUnit"
          >
            {{ distanceUnit.toUpperCase() }}
          </button>
        </div>

        <Dropdown :label="t('nav.account')" align="end">
          <template #trigger>
            <span class="app-header-avatar" aria-hidden="true">{{ initial }}</span>
          </template>
          <div class="dropdown-meta">
            <strong>{{ user?.username }}</strong>
            {{ user?.email }}
          </div>
          <div class="dropdown-divider"></div>
          <RouterLink to="/profile" role="menuitem" class="dropdown-item">{{ t('nav.profile') }}</RouterLink>
          <div class="dropdown-divider"></div>
          <button type="button" role="menuitem" class="dropdown-item dropdown-item-danger" @click.stop="handleLogout">
            {{ t('nav.logout') }}
          </button>
        </Dropdown>
      </template>

      <template v-else>
        <button
          type="button"
          class="app-header-icon-btn"
          :aria-label="`${t('routing.language')}: ${locale.toUpperCase()}`"
          @click="toggleLanguage"
        >
          {{ locale.toUpperCase() }}
        </button>
        <RouterLink to="/login" class="app-header-link">{{ t('nav.login') }}</RouterLink>
        <RouterLink to="/register" class="btn btn-primary btn-sm">{{ t('nav.register') }}</RouterLink>
      </template>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  grid-area: header;
  position: sticky;
  top: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  height: var(--shell-header-height);
  padding: 0 1.25rem;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}

.app-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.app-header-logo img {
  height: 26px;
  width: auto;
  display: block;
}

.app-header-burger {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  color: var(--text);
}

.app-header-burger:hover {
  background: var(--surface-soft);
}

.app-header-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.app-header-toggles {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface-soft);
}

.app-header-toggle-btn {
  min-width: 36px;
  min-height: 32px;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-full);
  color: var(--text-soft);
  font-size: var(--text-xs);
  font-weight: 800;
}

.app-header-toggle-btn:hover {
  background: var(--surface);
  color: var(--accent-hover);
}

.app-header-icon-btn {
  display: grid;
  place-items: center;
  min-width: 38px;
  height: 38px;
  padding: 0 0.5rem;
  border-radius: var(--radius-sm);
  color: var(--text-soft);
  font-size: var(--text-xs);
  font-weight: 800;
}

.app-header-icon-btn:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.app-header-avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 800;
}

.app-header-pref-value {
  color: var(--accent-hover);
}

.app-header-link {
  color: var(--text-soft);
  font-weight: 700;
  font-size: var(--text-sm);
  padding: 0.5rem 0.6rem;
}

.mobile-only {
  display: none;
}

@media (max-width: 1023px) {
  .mobile-only {
    display: grid;
  }
}

@media (max-width: 480px) {
  .app-header {
    padding: 0 0.85rem;
  }
}
</style>
