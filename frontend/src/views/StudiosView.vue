<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { t } from '../utils/i18n'
import { roleTone } from '../utils/studioBadges'
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
      <PageHeader :eyebrow="t('studios.eyebrow')" :title="t('studios.title')" :subtitle="t('studios.subtitle')">
        <template #actions>
          <RouterLink class="btn btn-primary" :to="{ name: 'studio-create' }">
            {{ t('studios.create.action') }}
          </RouterLink>
        </template>
      </PageHeader>

      <p v-if="studioContextStatus === 'error'" class="message message-error" role="alert">
        {{ t('studios.loadError') }}
        <button class="btn btn-secondary btn-sm" type="button" @click="refresh">{{ t('common.retry') }}</button>
      </p>

      <div v-if="studioContextStatus === 'loading'" class="studio-grid" aria-busy="true">
        <div class="card skeleton" style="height: 150px;"></div>
        <div class="card skeleton" style="height: 150px;"></div>
      </div>

      <div v-else class="studio-grid">
        <article class="card studio-card" :class="{ 'studio-card-active': activeStudioId === null }">
          <div class="studio-card-header">
            <h2>{{ t('studios.personal') }}</h2>
            <Badge v-if="activeStudioId === null" tone="success">{{ t('studios.active') }}</Badge>
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
            <Badge v-if="activeStudioId === studio.id" tone="success">{{ t('studios.active') }}</Badge>
          </div>
          <p class="studio-meta">
            <Badge :tone="roleTone(studio.membership.role)">{{ roleLabel(studio.membership.role) }}</Badge>
            <span>{{ studio.slug }}</span>
          </p>
          <button class="btn btn-secondary" type="button" @click="openStudio(studio)">
            {{ t('studios.openStudio') }}
          </button>
        </article>

        <EmptyState
          v-if="studioContextStatus === 'ready' && activeStudios.length === 0"
          :title="t('studios.emptyTitle')"
          :description="t('studios.empty')"
        />
      </div>
    </div>
  </section>
</template>
