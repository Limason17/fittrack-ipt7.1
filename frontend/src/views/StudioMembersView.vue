<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Pagination from '../components/ui/Pagination.vue'
import { formatDate, t } from '../utils/i18n'
import { membershipStatusTone, roleTone } from '../utils/studioBadges'
import { listMemberships, updateMembership } from '../utils/studioApi'
import { MEMBERSHIP_VIEW_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const memberships = ref([])
const pagination = ref(null)
const page = ref(1)
const drafts = reactive({})
const savingId = ref(null)
const isLoading = ref(true)
const errorMessage = ref('')
const pendingSave = ref(null)
let generation = 0
const actorRole = computed(() => activeStudio.value?.membership?.role)
const canManage = computed(() => ['owner', 'admin'].includes(actorRole.value))
const roleOptions = computed(() => actorRole.value === 'owner'
  ? ['owner', 'admin', 'trainer', 'member']
  : ['trainer', 'member'])

function canEdit(membership) {
  if (membership.status === 'left') return false
  if (actorRole.value === 'owner') return true
  return actorRole.value === 'admin' && !['owner', 'admin'].includes(membership.role)
}

function membershipRoleOptions(membership) {
  return roleOptions.value.includes(membership.role)
    ? roleOptions.value
    : [membership.role, ...roleOptions.value]
}

function identity(membership) {
  if (membership.status === 'left') return { name: t('studios.members.formerMember'), email: '' }
  const user = membership.user || {}
  return {
    name: user.displayName || user.username || membership.username || user.name || t('studios.members.member'),
    email: user.email || membership.email || '',
  }
}

function initializeDraft(membership) {
  drafts[membership.id] = {
    role: membership.role,
    status: membership.status,
  }
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
  if (!MEMBERSHIP_VIEW_ROLES.includes(selected.membership?.role)) {
    await router.replace({ name: 'studio-access-denied', params: { studioId: selected.id } })
    return false
  }
  return true
}

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentPage = page.value
  memberships.value = []
  pagination.value = null
  savingId.value = null
  for (const key of Object.keys(drafts)) delete drafts[key]
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listMemberships(currentStudioId, { page: currentPage, limit: 20 })
    if (current !== generation || currentStudioId !== studioId.value || currentPage !== page.value) return
    memberships.value = result.memberships || []
    pagination.value = result.pagination || null
    for (const membership of memberships.value) initializeDraft(membership)
  } catch (error) {
    if (current === generation) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.members.loadError')
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

function requestSave(membership) {
  const draft = drafts[membership.id]
  const roleChanged = draft.role !== membership.role
  const statusChanged = draft.status !== membership.status
  if (!roleChanged && !statusChanged) return
  pendingSave.value = { membership, roleChanged, statusChanged }
}

const confirmTitle = computed(() => {
  if (!pendingSave.value) return ''
  const { membership, statusChanged, roleChanged } = pendingSave.value
  if (statusChanged) return t(`studios.confirmStatusChange.${statusKey(membership)}.title`)
  if (roleChanged) return t('studios.confirmRoleChange.title')
  return ''
})

const confirmDescription = computed(() => {
  if (!pendingSave.value) return ''
  const { membership, statusChanged, roleChanged } = pendingSave.value
  const name = identity(membership).name
  if (statusChanged) {
    return t(`studios.confirmStatusChange.${statusKey(membership)}.description`, { name })
  }
  if (roleChanged) {
    return t('studios.confirmRoleChange.description', {
      name,
      before: t(`studios.roles.${membership.role}`),
      after: t(`studios.roles.${drafts[membership.id].role}`),
    })
  }
  return ''
})

function statusKey(membership) {
  const nextStatus = drafts[membership.id].status
  if (nextStatus === 'suspended') return 'suspend'
  if (nextStatus === 'active') return 'reactivate'
  return 'left'
}

function cancelSave() {
  pendingSave.value = null
}

async function confirmSave() {
  if (!pendingSave.value) return
  const { membership } = pendingSave.value
  pendingSave.value = null
  await saveMembership(membership)
}

async function saveMembership(membership) {
  const current = generation
  const currentStudioId = studioId.value
  const changes = { ...drafts[membership.id] }
  savingId.value = membership.id
  errorMessage.value = ''
  try {
    const result = await updateMembership(currentStudioId, membership.id, changes)
    if (current !== generation || currentStudioId !== studioId.value) return
    const index = memberships.value.findIndex((entry) => entry.id === membership.id)
    if (index !== -1) memberships.value[index] = result.membership
    initializeDraft(result.membership)
    if (result.membership.id === activeStudio.value?.membership?.id) {
      if (!await reconcileStudioAccess(current, currentStudioId)) return
    }
    toastSuccess(t('studios.members.saved'))
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      const message = error.status === 403 ? t('studios.permissionDenied') : t('studios.members.saveError')
      errorMessage.value = message
      toastError(message)
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) savingId.value = null
  }
}

watch(studioId, () => {
  page.value = 1
  load()
}, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="activeStudio?.name" :title="t('studios.members.title')" :subtitle="t('studios.members.subtitle')">
        <template v-if="canManage" #actions>
          <RouterLink class="btn btn-primary" :to="{ name: 'studio-invitations', params: { studioId } }">
            {{ t('studios.invitations.new') }}
          </RouterLink>
        </template>
      </PageHeader>

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
      </div>

      <article v-else class="card">
        <EmptyState v-if="!memberships.length" :title="t('studios.members.empty')" />
        <div v-else class="table-wrap table-stack">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('studios.members.columnPerson') }}</th>
                <th>{{ t('studios.members.columnRole') }}</th>
                <th>{{ t('studios.members.columnStatus') }}</th>
                <th v-if="canManage">{{ t('studios.members.columnActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="membership in memberships" :key="membership.id">
                <td :data-label="t('studios.members.columnPerson')">
                  <div class="studio-identity">
                    <strong>{{ identity(membership).name }}</strong>
                    <span v-if="identity(membership).email">{{ identity(membership).email }}</span>
                    <span v-else-if="membership.status === 'left'">{{ t('studios.members.identityRedacted') }}</span>
                    <span v-if="membership.joinedAt">{{ t('studios.members.joined') }} {{ formatDate(membership.joinedAt) }}</span>
                  </div>
                </td>

                <template v-if="canManage && canEdit(membership)">
                  <td :data-label="t('studios.members.columnRole')">
                    <label>
                      <span class="visually-hidden">{{ t('studios.members.roleFor', { name: identity(membership).name }) }}</span>
                      <select v-model="drafts[membership.id].role" class="select studio-inline-select">
                        <option v-for="candidateRole in membershipRoleOptions(membership)" :key="candidateRole" :value="candidateRole">
                          {{ t(`studios.roles.${candidateRole}`) }}
                        </option>
                      </select>
                    </label>
                  </td>
                  <td :data-label="t('studios.members.columnStatus')">
                    <label>
                      <span class="visually-hidden">{{ t('studios.members.statusFor', { name: identity(membership).name }) }}</span>
                      <select v-model="drafts[membership.id].status" class="select studio-inline-select">
                        <option value="active">{{ t('studios.statuses.active') }}</option>
                        <option value="suspended">{{ t('studios.statuses.suspended') }}</option>
                        <option value="left">{{ t('studios.statuses.left') }}</option>
                      </select>
                    </label>
                  </td>
                  <td :data-label="t('studios.members.columnActions')">
                    <div class="table-actions">
                      <button
                        class="btn btn-secondary btn-sm"
                        type="button"
                        :disabled="savingId === membership.id"
                        @click="requestSave(membership)"
                      >
                        <span v-if="savingId === membership.id" class="spinner" aria-hidden="true"></span>
                        {{ savingId === membership.id ? t('common.saving') : t('common.save') }}
                      </button>
                    </div>
                  </td>
                </template>
                <template v-else>
                  <td :data-label="t('studios.members.columnRole')">
                    <Badge :tone="roleTone(membership.role)">{{ t(`studios.roles.${membership.role}`) }}</Badge>
                  </td>
                  <td :data-label="t('studios.members.columnStatus')">
                    <Badge :tone="membershipStatusTone(membership.status)">{{ t(`studios.statuses.${membership.status}`) }}</Badge>
                  </td>
                  <td v-if="canManage" :data-label="t('studios.members.columnActions')">
                    <span class="studio-help">{{ t('studios.members.cannotEditHint') }}</span>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>

        <Pagination
          v-if="pagination && memberships.length"
          :page="page"
          :total-pages="pagination.totalPages || 1"
          :item-label="t('studios.members.pagination', { count: pagination.total ?? memberships.length })"
          @change="changePage"
        />
      </article>

      <ConfirmDialog
        :open="!!pendingSave"
        :title="confirmTitle"
        :description="confirmDescription"
        :tone="pendingSave?.statusChanged && drafts[pendingSave.membership.id]?.status !== 'active' ? 'danger' : 'primary'"
        :busy="!!savingId"
        @confirm="confirmSave"
        @cancel="cancelSave"
      />
    </div>
  </section>
</template>
