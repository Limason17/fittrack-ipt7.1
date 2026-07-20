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
import { listOwnCoachingRelationships } from '../utils/studioTrainingApi'
import { listCoachedMemberWorkoutSessions } from '../utils/workoutSessionApi'
import { workoutErrorMessage } from '../utils/workoutSessionErrors'

const DATE_TIME_OPTIONS = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }

const route = useRoute()
const studioId = computed(() => String(route.params.studioId || ''))

const relationships = ref([])
const isLoadingRelationships = ref(true)
const relationshipsError = ref('')

const selectedMember = ref(null)
const sessions = ref([])
const pagination = ref(null)
const page = ref(1)
const statusFilter = ref('all')
const isLoadingSessions = ref(false)
const sessionsError = ref('')
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

let relationshipsGeneration = 0
let sessionsGeneration = 0

async function loadRelationships() {
  const current = ++relationshipsGeneration
  const currentStudioId = studioId.value
  relationships.value = []
  isLoadingRelationships.value = true
  relationshipsError.value = ''
  try {
    const result = await listOwnCoachingRelationships(currentStudioId, { status: 'active', page: 1, limit: 100 })
    if (current !== relationshipsGeneration || currentStudioId !== studioId.value) return
    relationships.value = result.coachingRelationships || []
  } catch (error) {
    if (current === relationshipsGeneration) {
      relationshipsError.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.coachResults.membersLoadError')
    }
  } finally {
    if (current === relationshipsGeneration) isLoadingRelationships.value = false
  }
}

async function loadSessions() {
  if (!selectedMember.value) return
  const current = ++sessionsGeneration
  const currentStudioId = studioId.value
  const currentMembershipId = selectedMember.value.membershipId
  const currentPage = page.value
  const currentFilter = statusFilter.value
  sessions.value = []
  pagination.value = null
  isLoadingSessions.value = true
  sessionsError.value = ''
  try {
    const result = await listCoachedMemberWorkoutSessions(currentStudioId, currentMembershipId, {
      page: currentPage,
      limit: 20,
      status: currentFilter === 'all' ? undefined : currentFilter,
    })
    if (
      current !== sessionsGeneration || currentStudioId !== studioId.value ||
      !selectedMember.value || selectedMember.value.membershipId !== currentMembershipId ||
      currentPage !== page.value || currentFilter !== statusFilter.value
    ) return
    sessions.value = result.workoutSessions || []
    pagination.value = result.pagination || null
    if (currentFilter === 'all') overallTotal.value = result.pagination?.total ?? 0
  } catch (error) {
    if (current === sessionsGeneration) sessionsError.value = workoutErrorMessage(error)
  } finally {
    if (current === sessionsGeneration) isLoadingSessions.value = false
  }
}

function selectMember(relationship) {
  selectedMember.value = { membershipId: relationship.member.membershipId, displayName: relationship.member.displayName }
  page.value = 1
  statusFilter.value = 'all'
  overallTotal.value = null
  loadSessions()
}

function backToMembers() {
  selectedMember.value = null
  sessions.value = []
  pagination.value = null
  sessionsError.value = ''
}

function selectFilter(value) {
  if (value === statusFilter.value) return
  statusFilter.value = value
  page.value = 1
  loadSessions()
}

function changePage(nextPage) {
  const totalPages = pagination.value?.totalPages || 0
  if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page.value) return
  page.value = nextPage
  loadSessions()
}

watch(studioId, () => {
  backToMembers()
  loadRelationships()
}, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader
        :eyebrow="activeStudio?.name"
        :title="t('studios.coachResults.title')"
        :subtitle="t('studios.coachResults.subtitle')"
      />

      <p v-if="relationshipsError" class="message message-error" role="alert">{{ relationshipsError }}</p>

      <div v-if="isLoadingRelationships" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 3rem;"></div>
      </div>

      <template v-else>
        <EmptyState
          v-if="!relationships.length"
          :title="t('studios.coachResults.membersEmpty')"
          :description="t('studios.coachResults.membersEmptyHint')"
        />

        <article v-else class="card">
          <template v-if="!selectedMember">
            <h2 class="studio-section-title">{{ t('studios.coachResults.membersTitle') }}</h2>
            <p class="studio-help">{{ t('studios.coachResults.selectMemberHint') }}</p>
            <ul class="coach-member-list">
              <li v-for="relationship in relationships" :key="relationship.id" class="coach-member-card">
                <div>
                  <strong>{{ relationship.member.displayName }}</strong>
                  <p class="studio-meta">{{ t('studios.coachResults.relationshipSince', { date: formatDate(relationship.startedAt) }) }}</p>
                </div>
                <button type="button" class="btn btn-primary btn-sm" @click="selectMember(relationship)">
                  {{ t('studios.coachResults.selectMemberAction') }}
                </button>
              </li>
            </ul>
          </template>

          <template v-else>
            <div class="coach-sessions-head">
              <div>
                <button type="button" class="btn btn-secondary btn-sm" @click="backToMembers">
                  {{ t('studios.coachResults.backToMembers') }}
                </button>
                <h2 class="studio-section-title">{{ t('studios.coachResults.sessionsTitle', { name: selectedMember.displayName }) }}</h2>
              </div>
            </div>

            <Tabs :tabs="filterTabs" :model-value="statusFilter" :label="t('studios.coachResults.sessionsTitle', { name: selectedMember.displayName })" @update:model-value="selectFilter" />

            <p v-if="sessionsError" class="message message-error" role="alert">{{ sessionsError }}</p>

            <div v-if="isLoadingSessions" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
              <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
              <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
            </div>

            <template v-else>
              <EmptyState
                v-if="!sessions.length"
                :title="isFilteredEmpty ? t('studios.coachResults.sessionsEmptyFiltered') : t('studios.coachResults.sessionsEmpty')"
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
                          :to="{
                            name: 'studio-coach-result-session-detail',
                            params: { studioId, memberMembershipId: selectedMember.membershipId, sessionId: workoutSession.id },
                          }"
                        >
                          {{ t('studios.workoutSessions.viewDetailsAction') }}
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
            </template>
          </template>
        </article>
      </template>
    </div>
  </section>
</template>

<style scoped>
.studio-section-title {
  font-size: var(--text-lg);
  margin-bottom: 0.4rem;
}

.coach-member-list {
  list-style: none;
  display: grid;
  gap: 0.75rem;
  margin: 0.75rem 0 0;
}

.coach-member-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
}

.coach-sessions-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.coach-sessions-head > div {
  display: grid;
  gap: 0.5rem;
}
</style>
