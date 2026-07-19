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
  return redirect.startsWith('/invitations/')
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
    <footer class="site-footer">
      <div class="page-container site-footer-inner">
        <nav class="site-footer-meta" aria-label="Footer">
          <a
            href="https://disclaimer.bbzwinf.ch/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('footer.hostingDisclaimerLink') }}
          </a>
        </nav>
      </div>
    </footer>
    <ToastHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: var(--shell-sidebar-width) 1fr;
  grid-template-rows: var(--shell-header-height) 1fr auto;
  grid-template-areas:
    "sidebar header"
    "sidebar main"
    "sidebar footer";
  min-height: 100vh;
}

.app-shell-no-sidebar {
  grid-template-columns: 1fr;
  grid-template-areas:
    "header"
    "main"
    "footer";
}

.app-shell main {
  grid-area: main;
  min-width: 0;
}

.app-shell .site-footer {
  grid-area: footer;
}

@media (max-width: 1023px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-areas:
      "header"
      "main"
      "footer";
  }
}
</style>
