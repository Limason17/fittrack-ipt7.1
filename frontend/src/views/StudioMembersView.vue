<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import StudioSubnav from '../components/StudioSubnav.vue'
import { formatDate, t } from '../utils/i18n'
import { listMemberships, updateMembership } from '../utils/studioApi'
import { MEMBERSHIP_VIEW_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'

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
const successMessage = ref('')
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
  successMessage.value = ''
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

async function changePage(nextPage) {
  const totalPages = pagination.value?.totalPages || 0
  if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page.value) return
  page.value = nextPage
  await load()
}

async function saveMembership(membership) {
  const current = generation
  const currentStudioId = studioId.value
  const changes = { ...drafts[membership.id] }
  savingId.value = membership.id
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await updateMembership(currentStudioId, membership.id, changes)
    if (current !== generation || currentStudioId !== studioId.value) return
    const index = memberships.value.findIndex((entry) => entry.id === membership.id)
    if (index !== -1) memberships.value[index] = result.membership
    initializeDraft(result.membership)
    if (result.membership.id === activeStudio.value?.membership?.id) {
      if (!await reconcileStudioAccess(current, currentStudioId)) return
    }
    successMessage.value = t('studios.members.saved')
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.members.saveError')
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
      <header class="studio-page-header">
        <div>
          <span class="eyebrow">{{ activeStudio?.name }}</span>
          <h1 class="page-title">{{ t('studios.members.title') }}</h1>
          <p class="page-subtitle">{{ t('studios.members.subtitle') }}</p>
        </div>
        <RouterLink v-if="canManage" class="btn btn-primary" :to="{ name: 'studio-invitations', params: { studioId } }">
          {{ t('studios.invitations.new') }}
        </RouterLink>
      </header>

      <StudioSubnav :studio-id="studioId" :role="activeStudio?.membership?.role" />
      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="message message-success" role="status">{{ successMessage }}</p>
      <div v-if="isLoading" class="card empty-state">{{ t('common.loading') }}</div>

      <article v-else class="card studio-list-card">
        <ul v-if="memberships.length" class="studio-list">
          <li v-for="membership in memberships" :key="membership.id" class="studio-list-row">
            <div class="studio-identity">
              <strong>{{ identity(membership).name }}</strong>
              <span v-if="identity(membership).email">{{ identity(membership).email }}</span>
              <span v-else-if="membership.status === 'left'">{{ t('studios.members.identityRedacted') }}</span>
              <span v-if="membership.joinedAt">{{ t('studios.members.joined') }} {{ formatDate(membership.joinedAt) }}</span>
            </div>
            <template v-if="canManage">
              <label>
                <span class="visually-hidden">{{ t('studios.members.roleFor', { name: identity(membership).name }) }}</span>
                <select v-model="drafts[membership.id].role" class="studio-inline-select" :disabled="!canEdit(membership)">
                  <option v-for="candidateRole in membershipRoleOptions(membership)" :key="candidateRole" :value="candidateRole">
                    {{ t(`studios.roles.${candidateRole}`) }}
                  </option>
                </select>
              </label>
              <label>
                <span class="visually-hidden">{{ t('studios.members.statusFor', { name: identity(membership).name }) }}</span>
                <select v-model="drafts[membership.id].status" class="studio-inline-select" :disabled="!canEdit(membership)">
                  <option value="active">{{ t('studios.statuses.active') }}</option>
                  <option value="suspended">{{ t('studios.statuses.suspended') }}</option>
                  <option value="left">{{ t('studios.statuses.left') }}</option>
                </select>
              </label>
              <button
                class="btn btn-secondary"
                type="button"
                :disabled="!canEdit(membership) || savingId === membership.id"
                @click="saveMembership(membership)"
              >
                {{ savingId === membership.id ? t('common.saving') : t('common.save') }}
              </button>
            </template>
            <template v-else>
              <span class="pill">{{ t(`studios.roles.${membership.role}`) }}</span>
              <span class="pill studio-pill-active">{{ t(`studios.statuses.${membership.status}`) }}</span>
            </template>
          </li>
        </ul>
        <p v-else class="empty-state">{{ t('studios.members.empty') }}</p>
        <div v-if="pagination" class="studio-pagination">
          <span class="studio-help">{{ t('studios.members.pagination', { count: pagination.total ?? memberships.length }) }}</span>
          <button class="btn btn-secondary" type="button" :disabled="page <= 1" @click="changePage(page - 1)">
            {{ t('common.previous') }}
          </button>
          <span class="studio-help">{{ t('common.pageOf', { page, total: pagination.totalPages || 1 }) }}</span>
          <button class="btn btn-secondary" type="button" :disabled="page >= (pagination.totalPages || 1)" @click="changePage(page + 1)">
            {{ t('common.next') }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
