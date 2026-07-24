<script setup>
import { computed, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppHeader from './components/layout/AppHeader.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import ToastHost from './components/ui/ToastHost.vue'
import { authToken, safeInternalRedirect } from './utils/auth'
import { t } from './utils/i18n'

const route = useRoute()
const sensitiveRoute = computed(() => {
  if (route.meta.sensitiveHistory === true) return true
  const redirect = safeInternalRedirect(route.query.redirect, '')
  return redirect.startsWith('/invitations/') || redirect.startsWith('/account/email-change/')
})

const sidebarOpen = ref(false)
const loggedIn = computed(() => !!authToken.value)

watch(() => route.fullPath, () => { sidebarOpen.value = false })
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'app-shell-no-sidebar': sensitiveRoute || !loggedIn }"
  >
    <a v-if="!sensitiveRoute" class="skip-link" href="#main-content">{{ t('routing.skipToContent') }}</a>
    <AppSidebar v-if="!sensitiveRoute && loggedIn" :open="sidebarOpen" @close="sidebarOpen = false" />
    <AppHeader v-if="!sensitiveRoute" :sidebar-open="sidebarOpen" @toggle-sidebar="sidebarOpen = !sidebarOpen" />
    <main id="main-content" tabindex="-1">
      <RouterView />
    </main>
    <ToastHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: var(--shell-sidebar-width) 1fr;
  grid-template-rows: var(--shell-header-height) 1fr;
  grid-template-areas:
    "sidebar header"
    "sidebar main";
  min-height: 100vh;
}

.app-shell-no-sidebar {
  grid-template-columns: 1fr;
  grid-template-areas:
    "header"
    "main";
}

.app-shell main {
  grid-area: main;
  min-width: 0;
}

@media (max-width: 1023px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-areas:
      "header"
      "main";
  }
}
</style>
