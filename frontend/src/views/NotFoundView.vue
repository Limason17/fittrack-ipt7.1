<script setup>
import { t } from '../utils/i18n'
</script>

<template>
  <section class="section">
    <div class="page-container not-found card">
      <span class="eyebrow">404</span>
      <h1 class="page-title">{{ t('routing.notFoundTitle') }}</h1>
      <p class="page-subtitle">{{ t('routing.notFoundText') }}</p>
      <RouterLink class="btn btn-primary" to="/">
        {{ t('routing.backHome') }}
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.not-found {
  max-width: 760px;
  padding: clamp(1.25rem, 4vw, 2.5rem);
}

.not-found .page-subtitle {
  margin-bottom: 1.5rem;
}
</style>
