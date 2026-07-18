<script setup>
import { useRoute } from 'vue-router'
import { t } from '../utils/i18n'

const route = useRoute()
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <article class="card studio-detail-card">
        <span class="eyebrow">403</span>
        <h1 class="page-title">{{ t('studios.accessDeniedTitle') }}</h1>
        <p class="page-subtitle">{{ t('studios.permissionDenied') }}</p>
        <div class="studio-form-actions">
          <RouterLink class="btn btn-primary" :to="{ name: 'studio-dashboard', params: { studioId: route.params.studioId } }">
            {{ t('studios.backToStudio') }}
          </RouterLink>
          <RouterLink class="btn btn-secondary" :to="{ name: 'studios' }">{{ t('studios.allStudios') }}</RouterLink>
        </div>
      </article>
    </div>
  </section>
</template>
