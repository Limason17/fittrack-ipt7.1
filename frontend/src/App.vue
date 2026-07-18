<script setup>
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import Navbar from './components/Navbar.vue'
import { safeInternalRedirect } from './utils/auth'
import { t } from './utils/i18n'

const route = useRoute()
const sensitiveRoute = computed(() => {
  if (route.meta.sensitiveHistory === true) return true
  const redirect = safeInternalRedirect(route.query.redirect, '')
  return redirect.startsWith('/invitations/')
})
</script>

<template>
  <div class="app-shell">
    <a v-if="!sensitiveRoute" class="skip-link" href="#main-content">{{ t('routing.skipToContent') }}</a>
    <Navbar v-if="!sensitiveRoute" />
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
  </div>
</template>
