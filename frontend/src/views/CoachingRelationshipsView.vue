<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Pagination from '../components/ui/Pagination.vue'
import { formatDate, t } from '../utils/i18n'
import { coachingStatusTone } from '../utils/studioBadges'
import { listMemberships } from '../utils/studioApi'
import { createCoachingRelationship, endCoachingRelationship, listCoachingRelationships } from '../utils/studioTrainingApi'
import { TRAINING_MANAGEMENT_ROLES, activeStudio, canManageActiveStudio, refreshSelectedStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))

const relationships = ref([])
const pagination = ref(null)
const page = ref(1)
const isLoading = ref(true)
const errorMessage = ref('')

const coachCandidates = ref([])
const memberCandidates = ref([])
const membersLoaded = ref(false)
const coachMembershipId = ref('')
const memberMembershipId = ref('')
const isSaving = ref(false)
const formError = ref('')

const endingId = ref(null)
const pendingEnd = ref(null)

let generation = 0

function displayName(membership) {
  const user = membership?.user || {}
  return user.displayName || user.username || t('studios.members.member')
}

async function reconcileStudioAccess(expectedGeneration, expectedStudioId) {
  const selected = await refreshSelectedStudio(expectedStudioId).catch(() => null)
  if (expectedGeneration !== generation || expectedStudioId !== studioId.value || selected?.ignored) return false
  if (!selected) {
    await router.replace({ name: 'studios' })
    return false
  }
  if (!TRAINING_MANAGEMENT_ROLES.includes(selected.membership?.role)) {
    await router.replace({ name: 'studio-access-denied', params: { studioId: selected.id } })
    return false
  }
  return true
}

async function loadMemberCandidates() {
  const currentStudioId = studioId.value
  membersLoaded.value = false
  try {
    const result = await listMemberships(currentStudioId, { page: 1, limit: 100 })
    if (currentStudioId !== studioId.value) return
    const memberships = result.memberships || []
    coachCandidates.value = memberships.filter(
      (item) => item.status === 'active' && ['owner', 'admin', 'trainer'].includes(item.role)
    )
    memberCandidates.value = memberships.filter((item) => item.status === 'active' && item.role === 'member')
    membersLoaded.value = true
  } catch {
    membersLoaded.value = false
  }
}

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentPage = page.value
  relationships.value = []
  pagination.value = null
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listCoachingRelationships(currentStudioId, { page: currentPage, limit: 20 })
    if (current !== generation || currentStudioId !== studioId.value || currentPage !== page.value) return
    relationships.value = result.coachingRelationships || []
    pagination.value = result.pagination || null
  } catch (error) {
    if (current === generation) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.coaching.loadError')
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

async function submit() {
  const current = generation
  const currentStudioId = studioId.value
  formError.value = ''
  if (!coachMembershipId.value || !memberMembershipId.value) {
    formError.value = t('common.requiredFields')
    return
  }
  isSaving.value = true
  try {
    await createCoachingRelationship(currentStudioId, {
      coachMembershipId: coachMembershipId.value,
      memberMembershipId: memberMembershipId.value,
    })
    if (current !== generation || currentStudioId !== studioId.value) return
    coachMembershipId.value = ''
    memberMembershipId.value = ''
    toastSuccess(t('studios.coaching.created'))
    page.value = 1
    await load()
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      const message = error.status === 403 ? t('studios.permissionDenied') : t('studios.coaching.createError')
      formError.value = message
      toastError(message)
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) isSaving.value = false
  }
}

function requestEnd(relationship) {
  pendingEnd.value = relationship
}

function cancelEnd() {
  pendingEnd.value = null
}

async function confirmEnd() {
  const relationship = pendingEnd.value
  pendingEnd.value = null
  if (relationship) await end(relationship)
}

async function end(relationship) {
  const current = generation
  const currentStudioId = studioId.value
  endingId.value = relationship.id
  errorMessage.value = ''
  try {
    const result = await endCoachingRelationship(currentStudioId, relationship.id)
    if (current !== generation || currentStudioId !== studioId.value) return
    relationships.value = relationships.value.map((item) =>
      item.id === relationship.id ? result.coachingRelationship : item
    )
    toastSuccess(t('studios.coaching.ended'))
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      const message = error.status === 403 ? t('studios.permissionDenied') : t('studios.coaching.endError')
      errorMessage.value = message
      toastError(message)
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) endingId.value = null
  }
}

watch(studioId, () => {
  page.value = 1
  load()
  if (canManageActiveStudio.value) loadMemberCandidates()
}, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="activeStudio?.name" :title="t('studios.coaching.title')" :subtitle="t('studios.coaching.subtitle')" />

      <p v-if="!canManageActiveStudio" class="studio-help">{{ t('studios.coaching.ownHint') }}</p>

      <form v-if="canManageActiveStudio" class="card studio-form-card studio-form" @submit.prevent="submit">
        <h2 class="studio-form-title">{{ t('studios.coaching.new') }}</h2>
        <div class="studio-form-grid">
          <div class="form-group">
            <label class="form-label" for="coaching-coach">{{ t('studios.coaching.coach') }}</label>
            <select id="coaching-coach" v-model="coachMembershipId" class="select" :disabled="!membersLoaded">
              <option value="" disabled>{{ t('studios.coaching.selectCoach') }}</option>
              <option v-for="candidate in coachCandidates" :key="candidate.id" :value="candidate.id">
                {{ displayName(candidate) }} · {{ t(`studios.roles.${candidate.role}`) }}
              </option>
            </select>
            <p v-if="membersLoaded && !coachCandidates.length" class="studio-help">{{ t('studios.coaching.noEligibleCoaches') }}</p>
          </div>
          <div class="form-group">
            <label class="form-label" for="coaching-member">{{ t('studios.coaching.member') }}</label>
            <select id="coaching-member" v-model="memberMembershipId" class="select" :disabled="!membersLoaded">
              <option value="" disabled>{{ t('studios.coaching.selectMember') }}</option>
              <option v-for="candidate in memberCandidates" :key="candidate.id" :value="candidate.id">
                {{ displayName(candidate) }}
              </option>
            </select>
            <p v-if="membersLoaded && !memberCandidates.length" class="studio-help">{{ t('studios.coaching.noEligibleMembers') }}</p>
          </div>
        </div>
        <p v-if="formError" class="message message-error" role="alert">{{ formError }}</p>
        <div class="form-actions">
          <span class="studio-help" style="margin-right: auto;">{{ t('studios.coaching.serverAuthority') }}</span>
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            <span v-if="isSaving" class="spinner" aria-hidden="true"></span>
            {{ isSaving ? t('common.saving') : t('studios.coaching.submit') }}
          </button>
        </div>
      </form>

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
      </div>

      <article v-else class="card">
        <EmptyState v-if="!relationships.length" :title="t('studios.coaching.empty')" />
        <div v-else class="table-wrap table-stack">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('studios.coaching.columnCoach') }}</th>
                <th>{{ t('studios.coaching.columnMember') }}</th>
                <th>{{ t('studios.coaching.columnStatus') }}</th>
                <th>{{ t('studios.coaching.columnStarted') }}</th>
                <th>{{ t('studios.coaching.columnEnded') }}</th>
                <th v-if="canManageActiveStudio">{{ t('studios.coaching.columnActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="relationship in relationships" :key="relationship.id">
                <td :data-label="t('studios.coaching.columnCoach')">
                  <div class="studio-identity">
                    <strong>{{ relationship.coach.displayName }}</strong>
                  </div>
                </td>
                <td :data-label="t('studios.coaching.columnMember')">
                  <div class="studio-identity">
                    <strong>{{ relationship.member.displayName }}</strong>
                  </div>
                </td>
                <td :data-label="t('studios.coaching.columnStatus')">
                  <Badge :tone="coachingStatusTone(relationship.status)">
                    {{ t(`studios.trainingStatuses.${relationship.status}`) }}
                  </Badge>
                </td>
                <td :data-label="t('studios.coaching.columnStarted')">{{ formatDate(relationship.startedAt) }}</td>
                <td :data-label="t('studios.coaching.columnEnded')">
                  {{ relationship.endedAt ? formatDate(relationship.endedAt) : '—' }}
                </td>
                <td v-if="canManageActiveStudio" :data-label="t('studios.coaching.columnActions')">
                  <div class="table-actions">
                    <button
                      v-if="relationship.status === 'active'"
                      class="btn btn-danger btn-sm"
                      type="button"
                      :disabled="endingId === relationship.id"
                      @click="requestEnd(relationship)"
                    >
                      <span v-if="endingId === relationship.id" class="spinner" aria-hidden="true"></span>
                      {{ t('studios.coaching.endAction') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Pagination
          v-if="pagination && relationships.length"
          :page="page"
          :total-pages="pagination.totalPages || 1"
          :item-label="t('studios.coaching.pagination', { count: pagination.total ?? relationships.length })"
          @change="changePage"
        />
      </article>

      <ConfirmDialog
        :open="!!pendingEnd"
        :title="t('studios.coaching.confirmEnd.title')"
        :description="pendingEnd ? t('studios.coaching.confirmEnd.description', {
          coach: pendingEnd.coach.displayName,
          member: pendingEnd.member.displayName,
        }) : ''"
        :confirm-label="t('studios.coaching.endAction')"
        tone="danger"
        :busy="!!endingId"
        @confirm="confirmEnd"
        @cancel="cancelEnd"
      />
    </div>
  </section>
</template>

<style scoped>
.studio-form-title {
  font-size: var(--text-lg);
}
</style>
