<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { t } from '../utils/i18n'
import {
  activeStudioId,
  authorizedStudios,
  hydrateStudioContext,
  selectStudio,
  studioContextStatus,
} from '../utils/studioContext'

const router = useRouter()
const activeStudios = computed(() => authorizedStudios.value.filter((studio) => (
  studio.status === 'active' && studio.membership?.status === 'active'
)))

function roleLabel(role) {
  return t(`studios.roles.${role}`)
}

async function openPersonal() {
  selectStudio(null)
  await router.push({ name: 'home' })
}

async function openStudio(studio) {
  selectStudio(studio.id)
  await router.push({ name: 'studio-dashboard', params: { studioId: studio.id } })
}

function refresh() {
  hydrateStudioContext({ force: true }).catch(() => {})
}
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <header class="studio-page-header">
        <div>
          <span class="eyebrow">{{ t('studios.eyebrow') }}</span>
          <h1 class="page-title">{{ t('studios.title') }}</h1>
          <p class="page-subtitle">{{ t('studios.subtitle') }}</p>
        </div>
        <RouterLink class="btn btn-primary" :to="{ name: 'studio-create' }">
          {{ t('studios.create.action') }}
        </RouterLink>
      </header>

      <p v-if="studioContextStatus === 'error'" class="message message-error" role="alert">
        {{ t('studios.loadError') }}
        <button class="btn btn-secondary" type="button" @click="refresh">{{ t('common.retry') }}</button>
      </p>

      <div class="studio-grid" :aria-busy="studioContextStatus === 'loading'">
        <article class="card studio-card" :class="{ 'studio-card-active': activeStudioId === null }">
          <div class="studio-card-header">
            <h2>{{ t('studios.personal') }}</h2>
            <span v-if="activeStudioId === null" class="pill studio-pill-active">{{ t('studios.active') }}</span>
          </div>
          <p class="studio-muted">{{ t('studios.personalDescription') }}</p>
          <button class="btn btn-secondary" type="button" @click="openPersonal">
            {{ t('studios.openPersonal') }}
          </button>
        </article>

        <article
          v-for="studio in activeStudios"
          :key="studio.id"
          class="card studio-card"
          :class="{ 'studio-card-active': activeStudioId === studio.id }"
        >
          <div class="studio-card-header">
            <h2>{{ studio.name }}</h2>
            <span v-if="activeStudioId === studio.id" class="pill studio-pill-active">{{ t('studios.active') }}</span>
          </div>
          <p class="studio-meta">
            <span class="pill">{{ roleLabel(studio.membership.role) }}</span>
            <span>{{ studio.slug }}</span>
          </p>
          <button class="btn btn-secondary" type="button" @click="openStudio(studio)">
            {{ t('studios.openStudio') }}
          </button>
        </article>
      </div>

      <p v-if="studioContextStatus === 'ready' && activeStudios.length === 0" class="card empty-state">
        {{ t('studios.empty') }}
      </p>
    </div>
  </section>
</template>
