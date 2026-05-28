<script setup>
import { RouterView } from 'vue-router'
import Navbar from './components/Navbar.vue'
import { t } from './utils/i18n'
</script>

<template>
  <div class="app-shell">
    <Navbar />
    <main>
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
