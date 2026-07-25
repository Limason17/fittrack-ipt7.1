<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Pagination from '../components/ui/Pagination.vue'
import { formatDate, t } from '../utils/i18n'
import { listAuditEvents } from '../utils/studioApi'
import { MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const events = ref([])
const pagination = ref(null)
const page = ref(1)
const isLoading = ref(true)
const errorMessage = ref('')
let generation = 0

function eventLabel(eventType) {
  const labels = t('audit.events')
  if (typeof labels === 'object' && labels?.[eventType]) return labels[eventType]
  return t('audit.unknownEvent', { type: eventType })
}

async function reconcileStudioAccess(expectedGeneration, expectedStudioId) {
  const selected = await refreshSelectedStudio(expectedStudioId).catch(() => null)
  if (
    expectedGeneration !== generation ||
    expectedStudioId !== studioId.value ||
    selected?.ignored
  ) return false
  if (!selected) {
    await router.replace({ name: 'studios' })
    return false
  }
  if (!MANAGEMENT_ROLES.includes(selected.membership?.role)) {
    await router.replace({ name: 'studio-access-denied', params: { studioId: selected.id } })
    return false
  }
  return true
}

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentPage = page.value
  events.value = []
  pagination.value = null
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listAuditEvents(currentStudioId, { page: currentPage, limit: 20 })
    if (current !== generation || currentStudioId !== studioId.value || currentPage !== page.value) return
    events.value = result.auditEvents || []
    pagination.value = result.pagination || null
  } catch (error) {
    if (current === generation) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('audit.loadError')
    }
  } finally {
    if (current === generation) isLoading.value = false
  }
}

function changePage(nextPage) {
  const totalPages = pagination.value?.totalPages || 0
  if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page.value) return
  page.value = nextPage
  load()
}

watch(studioId, () => {
  page.value = 1
  load()
}, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="activeStudio?.name" :title="t('audit.title')" :subtitle="t('audit.subtitle')" />

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
      </div>

      <article v-else class="card">
        <EmptyState v-if="!events.length" :title="t('audit.empty')" />
        <div v-else class="table-wrap table-stack">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('audit.columns.event') }}</th>
                <th>{{ t('audit.columns.actor') }}</th>
                <th>{{ t('audit.columns.target') }}</th>
                <th>{{ t('audit.columns.when') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in events" :key="event.id">
                <td :data-label="t('audit.columns.event')">
                  <span class="studio-truncate" :title="eventLabel(event.eventType)">{{ eventLabel(event.eventType) }}</span>
                </td>
                <td :data-label="t('audit.columns.actor')">
                  <span class="studio-truncate" :title="event.actor?.username || t('audit.system')">{{ event.actor?.username || t('audit.system') }}</span>
                </td>
                <td :data-label="t('audit.columns.target')">{{ event.targetType || '—' }}</td>
                <td :data-label="t('audit.columns.when')">{{ formatDate(event.createdAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Pagination
          v-if="pagination && events.length"
          :page="page"
          :total-pages="pagination.totalPages || 1"
          :item-label="t('audit.pagination', { count: pagination.total ?? events.length })"
          @change="changePage"
        />
      </article>
    </div>
  </section>
</template>
