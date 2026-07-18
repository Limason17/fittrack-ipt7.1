<script setup>
import { t } from '../utils/i18n'
</script>

<template>
  <section class="section">
    <div class="page-container status-page">
      <span class="status-page-code" aria-hidden="true">404</span>
      <h1 class="page-title">{{ t('routing.notFoundTitle') }}</h1>
      <p class="page-subtitle">{{ t('routing.notFoundText') }}</p>
      <div class="status-page-actions">
        <RouterLink class="btn btn-primary" to="/">
          {{ t('routing.backHome') }}
        </RouterLink>
      </div>
    </div>
  </section>
</template>
