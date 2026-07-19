<script setup>
import { useRoute } from 'vue-router'
import { t } from '../utils/i18n'

const route = useRoute()
</script>

<template>
  <section class="section">
    <div class="page-container status-page">
      <span class="status-page-code" aria-hidden="true">403</span>
      <h1 class="page-title">{{ t('studios.accessDeniedTitle') }}</h1>
      <p class="page-subtitle">{{ t('studios.permissionDenied') }}</p>
      <div class="status-page-actions">
        <RouterLink class="btn btn-primary" :to="{ name: 'studio-dashboard', params: { studioId: route.params.studioId } }">
          {{ t('studios.backToStudio') }}
        </RouterLink>
        <RouterLink class="btn btn-secondary" :to="{ name: 'studios' }">{{ t('studios.allStudios') }}</RouterLink>
      </div>
    </div>
  </section>
</template>
