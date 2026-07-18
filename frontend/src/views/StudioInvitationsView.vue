<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import StudioSubnav from '../components/StudioSubnav.vue'
import { formatDate, t } from '../utils/i18n'
import { createInvitation, listInvitations, revokeInvitation } from '../utils/studioApi'
import { MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const invitations = ref([])
const pagination = ref(null)
const page = ref(1)
const email = ref('')
const role = ref('trainer')
const deliveryLink = ref('')
const isLoading = ref(true)
const isSaving = ref(false)
const revokingId = ref(null)
const errorMessage = ref('')
const successMessage = ref('')
let generation = 0
const isOwner = computed(() => activeStudio.value?.membership?.role === 'owner')

function displayEmail(invitation) {
  return invitation.status === 'pending' && invitation.email
    ? invitation.email
    : t('studios.invitations.identityRedacted')
}

function safeDeliveryLink(delivery) {
  if (typeof delivery?.acceptUrl !== 'string') return ''
  try {
    const parsed = new URL(delivery.acceptUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return ''
    return parsed.toString()
  } catch {
    return ''
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
  if (!MANAGEMENT_ROLES.includes(selected.membership?.role)) {
    await router.replace({ name: 'studio-access-denied', params: { studioId: selected.id } })
    return false
  }
  return true
}

async function load({ preserveTransient = false } = {}) {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentPage = page.value
  invitations.value = []
  pagination.value = null
  if (!preserveTransient) {
    email.value = ''
    role.value = 'trainer'
    deliveryLink.value = ''
    successMessage.value = ''
    isSaving.value = false
  }
  revokingId.value = null
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listInvitations(currentStudioId, { page: currentPage, limit: 20 })
    if (current !== generation || currentStudioId !== studioId.value || currentPage !== page.value) return false
    invitations.value = result.invitations || []
    pagination.value = result.pagination || null
    return true
  } catch (error) {
    if (current === generation) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return false
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.invitations.loadError')
    }
    return false
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

async function submit() {
  const current = generation
  let finalGeneration = current
  const currentStudioId = studioId.value
  errorMessage.value = ''
  successMessage.value = ''
  deliveryLink.value = ''
  if (!email.value.trim()) {
    errorMessage.value = t('studios.invitations.emailRequired')
    return
  }
  isSaving.value = true
  try {
    const result = await createInvitation(currentStudioId, {
      email: email.value.trim().toLowerCase(),
      role: role.value,
    })
    if (current !== generation || currentStudioId !== studioId.value) return
    deliveryLink.value = safeDeliveryLink(result.delivery)
    email.value = ''
    successMessage.value = t('studios.invitations.created')
    page.value = 1
    await load({ preserveTransient: true })
    finalGeneration = generation
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.invitations.createError')
    }
  } finally {
    if (finalGeneration === generation && currentStudioId === studioId.value) isSaving.value = false
  }
}

async function copyDeliveryLink() {
  if (!deliveryLink.value || !navigator.clipboard) return
  await navigator.clipboard.writeText(deliveryLink.value)
  successMessage.value = t('studios.invitations.copied')
}

async function revoke(invitation) {
  const current = generation
  const currentStudioId = studioId.value
  revokingId.value = invitation.id
  errorMessage.value = ''
  successMessage.value = ''
  try {
    await revokeInvitation(currentStudioId, invitation.id)
    if (current !== generation || currentStudioId !== studioId.value) return
    invitations.value = invitations.value.map((item) => item.id === invitation.id
      ? { ...item, status: 'revoked', email: null }
      : item)
    successMessage.value = t('studios.invitations.revoked')
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.invitations.revokeError')
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) revokingId.value = null
  }
}

watch(studioId, () => {
  page.value = 1
  load()
}, { immediate: true })
onBeforeUnmount(() => { deliveryLink.value = '' })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <header>
        <span class="eyebrow">{{ activeStudio?.name }}</span>
        <h1 class="page-title">{{ t('studios.invitations.title') }}</h1>
        <p class="page-subtitle">{{ t('studios.invitations.subtitle') }}</p>
      </header>

      <StudioSubnav :studio-id="studioId" :role="activeStudio?.membership?.role" />

      <form class="card studio-form-card studio-form" @submit.prevent="submit">
        <div class="studio-form-grid">
          <div class="form-group">
            <label class="form-label" for="invitation-email">{{ t('studios.invitations.email') }}</label>
            <input id="invitation-email" v-model="email" class="input" type="email" required autocomplete="email" />
          </div>
          <div class="form-group">
            <label class="form-label" for="invitation-role">{{ t('studios.invitations.role') }}</label>
            <select id="invitation-role" v-model="role" class="input">
              <option v-if="isOwner" value="admin">{{ t('studios.roles.admin') }}</option>
              <option value="trainer">{{ t('studios.roles.trainer') }}</option>
              <option value="member">{{ t('studios.roles.member') }}</option>
            </select>
          </div>
        </div>
        <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
        <p v-if="successMessage" class="message message-success" role="status">{{ successMessage }}</p>
        <aside v-if="deliveryLink" class="studio-delivery" aria-live="polite">
          <strong>{{ t('studios.invitations.devDeliveryTitle') }}</strong>
          <p>{{ t('studios.invitations.devDeliveryHint') }}</p>
          <a :href="deliveryLink" rel="noreferrer">{{ deliveryLink }}</a>
          <button class="btn btn-secondary" type="button" @click="copyDeliveryLink">{{ t('studios.invitations.copy') }}</button>
        </aside>
        <div class="studio-form-actions">
          <span class="studio-help">{{ t('studios.invitations.serverAuthority') }}</span>
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            {{ isSaving ? t('common.saving') : t('studios.invitations.submit') }}
          </button>
        </div>
      </form>

      <div v-if="isLoading" class="card empty-state">{{ t('common.loading') }}</div>
      <article v-else class="card studio-list-card">
        <h2>{{ t('studios.invitations.openTitle') }}</h2>
        <ul v-if="invitations.length" class="studio-list">
          <li v-for="invitation in invitations" :key="invitation.id" class="studio-list-row">
            <div class="studio-identity">
              <strong>{{ displayEmail(invitation) }}</strong>
              <span v-if="invitation.expiresAt">{{ t('studios.invitations.expires') }} {{ formatDate(invitation.expiresAt) }}</span>
            </div>
            <span class="pill">{{ t(`studios.roles.${invitation.role}`) }}</span>
            <span class="pill" :class="{ 'studio-pill-active': invitation.status === 'pending' }">
              {{ t(`studios.invitationStatuses.${invitation.status}`) }}
            </span>
            <button
              class="btn btn-danger"
              type="button"
              :disabled="invitation.status !== 'pending' || revokingId === invitation.id"
              @click="revoke(invitation)"
            >
              {{ t('studios.invitations.revoke') }}
            </button>
          </li>
        </ul>
        <p v-else class="empty-state">{{ t('studios.invitations.empty') }}</p>
        <div v-if="pagination" class="studio-pagination">
          <span class="studio-help">{{ t('studios.invitations.pagination', { count: pagination.total ?? invitations.length }) }}</span>
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
