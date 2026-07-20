<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Pagination from '../components/ui/Pagination.vue'
import Tabs from '../components/ui/Tabs.vue'
import { formatDate, t } from '../utils/i18n'
import { workoutSessionStatusTone } from '../utils/studioBadges'
import { activeStudio } from '../utils/studioContext'
import { listOwnWorkoutSessions } from '../utils/workoutSessionApi'
import { workoutErrorMessage } from '../utils/workoutSessionErrors'

const DATE_TIME_OPTIONS = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }

const route = useRoute()
const studioId = computed(() => String(route.params.studioId || ''))

const sessions = ref([])
const pagination = ref(null)
const page = ref(1)
const statusFilter = ref('all')
const isLoading = ref(true)
const errorMessage = ref('')
// Total across every status, captured the first time the (default) unfiltered
// "all" load succeeds. Used only to tell apart the two empty states below -
// never displayed as a count itself, so it is not a fabricated statistic.
const overallTotal = ref(null)

const filterTabs = computed(() => [
  { value: 'all', label: t('studios.workoutSessions.filterAll') },
  { value: 'in_progress', label: t('studios.workoutSessions.sessionStatuses.in_progress') },
  { value: 'completed', label: t('studios.workoutSessions.sessionStatuses.completed') },
  { value: 'aborted', label: t('studios.workoutSessions.sessionStatuses.aborted') },
])
const hasAnySessionsEver = computed(() => (overallTotal.value ?? 0) > 0)
const isFilteredEmpty = computed(() => (
  !sessions.value.length && statusFilter.value !== 'all' && hasAnySessionsEver.value
))

let generation = 0

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentPage = page.value
  const currentFilter = statusFilter.value
  sessions.value = []
  pagination.value = null
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listOwnWorkoutSessions(currentStudioId, {
      page: currentPage,
      limit: 20,
      status: currentFilter === 'all' ? undefined : currentFilter,
    })
    if (
      current !== generation || currentStudioId !== studioId.value ||
      currentPage !== page.value || currentFilter !== statusFilter.value
    ) return
    sessions.value = result.workoutSessions || []
    pagination.value = result.pagination || null
    if (currentFilter === 'all') overallTotal.value = result.pagination?.total ?? 0
  } catch (error) {
    if (current === generation) errorMessage.value = workoutErrorMessage(error)
  } finally {
    if (current === generation) isLoading.value = false
  }
}

function selectFilter(value) {
  if (value === statusFilter.value) return
  statusFilter.value = value
  page.value = 1
  load()
}

function changePage(nextPage) {
  const totalPages = pagination.value?.totalPages || 0
  if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page.value) return
  page.value = nextPage
  load()
}

watch(studioId, () => {
  page.value = 1
  statusFilter.value = 'all'
  overallTotal.value = null
  load()
}, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader
        :eyebrow="activeStudio?.name"
        :title="t('studios.workoutSessions.historyTitle')"
        :subtitle="t('studios.workoutSessions.historySubtitle')"
      />

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
      </div>

      <article v-else class="card">
        <Tabs :tabs="filterTabs" :model-value="statusFilter" :label="t('studios.workoutSessions.historyTitle')" @update:model-value="selectFilter" />

        <EmptyState
          v-if="!sessions.length"
          :title="isFilteredEmpty ? t('studios.workoutSessions.historyEmptyFiltered') : t('studios.workoutSessions.historyEmpty')"
          :description="isFilteredEmpty ? t('studios.workoutSessions.historyEmptyFilteredHint') : t('studios.workoutSessions.historyEmptyHint')"
        />
        <div v-else class="table-wrap table-stack">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('studios.workoutSessions.columnDate') }}</th>
                <th>{{ t('studios.workoutSessions.columnProgram') }}</th>
                <th>{{ t('studios.workoutSessions.columnDay') }}</th>
                <th>{{ t('studios.workoutSessions.columnStatus') }}</th>
                <th>{{ t('studios.workoutSessions.columnFinishedAt') }}</th>
                <th>{{ t('studios.workoutSessions.columnActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="workoutSession in sessions" :key="workoutSession.id">
                <td :data-label="t('studios.workoutSessions.columnDate')">{{ formatDate(workoutSession.startedAt, DATE_TIME_OPTIONS) }}</td>
                <td :data-label="t('studios.workoutSessions.columnProgram')">{{ workoutSession.program.name }}</td>
                <td :data-label="t('studios.workoutSessions.columnDay')">{{ workoutSession.programDay.name }}</td>
                <td :data-label="t('studios.workoutSessions.columnStatus')">
                  <Badge :tone="workoutSessionStatusTone(workoutSession.status)">
                    {{ t(`studios.workoutSessions.sessionStatuses.${workoutSession.status}`) }}
                  </Badge>
                </td>
                <td :data-label="t('studios.workoutSessions.columnFinishedAt')">
                  {{ formatDate(workoutSession.completedAt || workoutSession.abortedAt, DATE_TIME_OPTIONS) || '—' }}
                </td>
                <td :data-label="t('studios.workoutSessions.columnActions')">
                  <RouterLink
                    class="btn btn-secondary btn-sm"
                    :to="{ name: 'studio-workout-session-detail', params: { studioId, sessionId: workoutSession.id } }"
                  >
                    {{ workoutSession.status === 'in_progress' ? t('studios.workoutSessions.resumeAction') : t('studios.workoutSessions.viewDetailsAction') }}
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Pagination
          v-if="pagination && sessions.length"
          :page="page"
          :total-pages="pagination.totalPages || 1"
          :item-label="t('studios.workoutSessions.pagination', { count: pagination.total ?? sessions.length })"
          @change="changePage"
        />
      </article>
    </div>
  </section>
</template>
