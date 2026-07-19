<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Pagination from '../components/ui/Pagination.vue'
import Tabs from '../components/ui/Tabs.vue'
import { formatDate, t } from '../utils/i18n'
import { assignmentStatusTone } from '../utils/studioBadges'
import { listMemberships } from '../utils/studioApi'
import {
  createProgramAssignment,
  listCoachingRelationships,
  listProgramAssignments,
  listTrainingPrograms,
  listProgramVersions,
  updateProgramAssignment,
} from '../utils/studioTrainingApi'
import { TRAINING_MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))

const assignments = ref([])
const pagination = ref(null)
const page = ref(1)
const statusFilter = ref('all')
const isLoading = ref(true)
const errorMessage = ref('')

const filterTabs = computed(() => [
  { value: 'all', label: t('studios.assignments.filterAll') },
  { value: 'active', label: t('studios.assignments.filterActive') },
  { value: 'completed', label: t('studios.assignments.filterCompleted') },
  { value: 'cancelled', label: t('studios.assignments.filterCancelled') },
])
const filteredAssignments = computed(() => statusFilter.value === 'all'
  ? assignments.value
  : assignments.value.filter((item) => item.status === statusFilter.value))

const showForm = ref(false)
const members = ref([])
const relationships = ref([])
const programs = ref([])
const versions = ref([])
const selectedMemberId = ref('')
const selectedProgramId = ref('')
const selectedVersionId = ref('')
const selectedRelationshipId = ref('')
const startsOn = ref('')
const endsOn = ref('')
const isSaving = ref(false)
const formError = ref('')
const referenceLoaded = ref(false)
const isLoadingVersions = ref(false)

const eligibleRelationships = computed(() => relationships.value.filter(
  (relationship) => relationship.status === 'active' && relationship.member.membershipId === selectedMemberId.value
))

let generation = 0

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

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentPage = page.value
  assignments.value = []
  pagination.value = null
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listProgramAssignments(currentStudioId, { page: currentPage, limit: 20 })
    if (current !== generation || currentStudioId !== studioId.value || currentPage !== page.value) return
    assignments.value = result.programAssignments || []
    pagination.value = result.pagination || null
  } catch (error) {
    if (current === generation) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.assignments.loadError')
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

async function loadReferenceData() {
  const currentStudioId = studioId.value
  referenceLoaded.value = false
  try {
    const [membershipResult, relationshipResult, programResult] = await Promise.all([
      listMemberships(currentStudioId, { page: 1, limit: 100 }),
      listCoachingRelationships(currentStudioId, { page: 1, limit: 100 }),
      listTrainingPrograms(currentStudioId, { page: 1, limit: 100 }),
    ])
    if (currentStudioId !== studioId.value) return
    members.value = (membershipResult.memberships || []).filter(
      (item) => item.status === 'active' && item.role === 'member'
    )
    relationships.value = relationshipResult.coachingRelationships || []
    programs.value = (programResult.trainingPrograms || []).filter((item) => item.status === 'active')
    referenceLoaded.value = true
  } catch {
    referenceLoaded.value = false
  }
}

async function loadVersionsForProgram() {
  versions.value = []
  selectedVersionId.value = ''
  if (!selectedProgramId.value) return
  isLoadingVersions.value = true
  try {
    const result = await listProgramVersions(studioId.value, selectedProgramId.value, { page: 1, limit: 100 })
    versions.value = (result.programVersions || []).filter((item) => item.status === 'published')
  } catch {
    versions.value = []
  } finally {
    isLoadingVersions.value = false
  }
}

watch(selectedProgramId, loadVersionsForProgram)
watch(selectedMemberId, () => { selectedRelationshipId.value = '' })

function toggleForm() {
  showForm.value = !showForm.value
  formError.value = ''
  if (showForm.value && !referenceLoaded.value) loadReferenceData()
}

async function submit() {
  const current = generation
  const currentStudioId = studioId.value
  formError.value = ''
  if (!selectedMemberId.value || !selectedVersionId.value || !selectedRelationshipId.value) {
    formError.value = t('common.requiredFields')
    return
  }
  isSaving.value = true
  try {
    await createProgramAssignment(currentStudioId, {
      programVersionId: selectedVersionId.value,
      memberMembershipId: selectedMemberId.value,
      coachingRelationshipId: selectedRelationshipId.value,
      startsOn: startsOn.value || undefined,
      endsOn: endsOn.value || undefined,
    })
    if (current !== generation || currentStudioId !== studioId.value) return
    selectedMemberId.value = ''
    selectedProgramId.value = ''
    selectedVersionId.value = ''
    selectedRelationshipId.value = ''
    startsOn.value = ''
    endsOn.value = ''
    showForm.value = false
    toastSuccess(t('studios.assignments.created'))
    page.value = 1
    await load()
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      const message = error.status === 403 ? t('studios.permissionDenied') : t('studios.assignments.createError')
      formError.value = message
      toastError(message)
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) isSaving.value = false
  }
}

const mutatingId = ref(null)
const pendingAction = ref(null)

function requestAction(assignment, action) {
  pendingAction.value = { assignment, action }
}

function cancelAction() {
  pendingAction.value = null
}

async function confirmAction() {
  const pending = pendingAction.value
  pendingAction.value = null
  if (!pending) return
  const current = generation
  const currentStudioId = studioId.value
  mutatingId.value = pending.assignment.id
  try {
    const result = await updateProgramAssignment(currentStudioId, pending.assignment.id, { status: pending.action })
    if (current !== generation || currentStudioId !== studioId.value) return
    assignments.value = assignments.value.map((item) =>
      item.id === pending.assignment.id ? result.programAssignment : item
    )
    toastSuccess(t(`studios.assignments.${pending.action === 'completed' ? 'completed' : 'cancelled'}`))
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      toastError(error.status === 403
        ? t('studios.permissionDenied')
        : t(`studios.assignments.${pending.action === 'completed' ? 'completeError' : 'cancelError'}`))
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) mutatingId.value = null
  }
}

watch(studioId, () => {
  page.value = 1
  statusFilter.value = 'all'
  load()
}, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="activeStudio?.name" :title="t('studios.assignments.title')" :subtitle="t('studios.assignments.subtitle')">
        <template #actions>
          <button class="btn btn-primary" type="button" @click="toggleForm">
            {{ showForm ? t('common.cancel') : t('studios.assignments.new') }}
          </button>
        </template>
      </PageHeader>

      <form v-if="showForm" class="card studio-form-card studio-form" @submit.prevent="submit">
        <div class="studio-form-grid">
          <div class="form-group">
            <label class="form-label" for="assignment-member">{{ t('studios.assignments.selectMember') }}</label>
            <select id="assignment-member" v-model="selectedMemberId" class="select" :disabled="!referenceLoaded">
              <option value="" disabled>{{ t('common.noSelection') }}</option>
              <option v-for="member in members" :key="member.id" :value="member.id">
                {{ member.user?.displayName || member.user?.username || t('studios.members.member') }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="assignment-program">{{ t('studios.assignments.selectProgram') }}</label>
            <select id="assignment-program" v-model="selectedProgramId" class="select" :disabled="!referenceLoaded">
              <option value="" disabled>{{ t('common.noSelection') }}</option>
              <option v-for="program in programs" :key="program.id" :value="program.id">{{ program.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="assignment-version">{{ t('studios.assignments.selectVersion') }}</label>
            <select id="assignment-version" v-model="selectedVersionId" class="select" :disabled="!selectedProgramId || isLoadingVersions">
              <option value="" disabled>{{ t('common.noSelection') }}</option>
              <option v-for="version in versions" :key="version.id" :value="version.id">
                {{ t('studios.programBuilder.versionLabel', { number: version.versionNumber }) }}
              </option>
            </select>
            <p v-if="selectedProgramId && !isLoadingVersions && !versions.length" class="studio-help">
              {{ t('studios.assignments.noPublishedVersions') }}
            </p>
          </div>
          <div class="form-group">
            <label class="form-label" for="assignment-relationship">{{ t('studios.assignments.selectCoachingRelationship') }}</label>
            <select id="assignment-relationship" v-model="selectedRelationshipId" class="select" :disabled="!selectedMemberId">
              <option value="" disabled>{{ t('common.noSelection') }}</option>
              <option v-for="relationship in eligibleRelationships" :key="relationship.id" :value="relationship.id">
                {{ relationship.coach.displayName }}
              </option>
            </select>
            <p v-if="selectedMemberId && !eligibleRelationships.length" class="studio-help">
              {{ t('studios.assignments.noEligibleRelationship') }}
            </p>
          </div>
          <div class="form-group">
            <label class="form-label" for="assignment-starts">{{ t('studios.assignments.startsOn') }}</label>
            <input id="assignment-starts" v-model="startsOn" class="input" type="date" />
          </div>
          <div class="form-group">
            <label class="form-label" for="assignment-ends">{{ t('studios.assignments.endsOn') }}</label>
            <input id="assignment-ends" v-model="endsOn" class="input" type="date" />
          </div>
        </div>
        <p v-if="formError" class="message message-error" role="alert">{{ formError }}</p>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            <span v-if="isSaving" class="spinner" aria-hidden="true"></span>
            {{ isSaving ? t('common.saving') : t('studios.assignments.submit') }}
          </button>
        </div>
      </form>

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
      </div>

      <article v-else class="card">
        <Tabs :tabs="filterTabs" :model-value="statusFilter" :label="t('studios.assignments.title')" @update:model-value="statusFilter = $event" />
        <p class="studio-help">{{ t('studios.assignments.filterHint') }}</p>
        <EmptyState v-if="!filteredAssignments.length" :title="t('studios.assignments.empty')" />
        <div v-else class="table-wrap table-stack">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('studios.assignments.columnMember') }}</th>
                <th>{{ t('studios.assignments.columnProgram') }}</th>
                <th>{{ t('studios.assignments.columnVersion') }}</th>
                <th>{{ t('studios.assignments.columnStatus') }}</th>
                <th>{{ t('studios.assignments.columnStarts') }}</th>
                <th>{{ t('studios.assignments.columnEnds') }}</th>
                <th>{{ t('studios.assignments.columnActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="assignment in filteredAssignments" :key="assignment.id">
                <td :data-label="t('studios.assignments.columnMember')">{{ assignment.member?.displayName || '—' }}</td>
                <td :data-label="t('studios.assignments.columnProgram')">{{ assignment.program.name }}</td>
                <td :data-label="t('studios.assignments.columnVersion')">
                  {{ t('studios.programBuilder.versionLabel', { number: assignment.programVersion.versionNumber }) }}
                </td>
                <td :data-label="t('studios.assignments.columnStatus')">
                  <Badge :tone="assignmentStatusTone(assignment.status)">{{ t(`studios.trainingStatuses.${assignment.status}`) }}</Badge>
                </td>
                <td :data-label="t('studios.assignments.columnStarts')">{{ assignment.startsOn ? formatDate(assignment.startsOn) : '—' }}</td>
                <td :data-label="t('studios.assignments.columnEnds')">{{ assignment.endsOn ? formatDate(assignment.endsOn) : '—' }}</td>
                <td :data-label="t('studios.assignments.columnActions')">
                  <div v-if="assignment.status === 'active'" class="table-actions">
                    <button
                      class="btn btn-secondary btn-sm"
                      type="button"
                      :disabled="mutatingId === assignment.id"
                      @click="requestAction(assignment, 'completed')"
                    >
                      {{ t('studios.assignments.completeAction') }}
                    </button>
                    <button
                      class="btn btn-danger btn-sm"
                      type="button"
                      :disabled="mutatingId === assignment.id"
                      @click="requestAction(assignment, 'cancelled')"
                    >
                      {{ t('studios.assignments.cancelAction') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Pagination
          v-if="pagination && assignments.length"
          :page="page"
          :total-pages="pagination.totalPages || 1"
          :item-label="t('studios.assignments.pagination', { count: pagination.total ?? assignments.length })"
          @change="changePage"
        />
      </article>

      <ConfirmDialog
        :open="!!pendingAction"
        :title="pendingAction?.action === 'completed' ? t('studios.assignments.confirmComplete.title') : t('studios.assignments.confirmCancel.title')"
        :description="pendingAction?.action === 'completed' ? t('studios.assignments.confirmComplete.description') : t('studios.assignments.confirmCancel.description')"
        :tone="pendingAction?.action === 'cancelled' ? 'danger' : 'primary'"
        :confirm-label="pendingAction?.action === 'completed' ? t('studios.assignments.completeAction') : t('studios.assignments.confirmCancel.confirmLabel')"
        :busy="!!mutatingId"
        @confirm="confirmAction"
        @cancel="cancelAction"
      />
    </div>
  </section>
</template>
