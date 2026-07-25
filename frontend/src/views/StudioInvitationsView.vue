<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Pagination from '../components/ui/Pagination.vue'
import { formatDate, t } from '../utils/i18n'
import { invitationStatusTone, roleTone } from '../utils/studioBadges'
import { createInvitation, listInvitations, resendInvitation, revokeInvitation } from '../utils/studioApi'
import { MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'

const RESENDABLE_STATUSES = ['pending', 'expired']
const RESEND_ERROR_KEYS = {
  INVITATION_ALREADY_ACCEPTED: 'studios.invitations.resendAlreadyAccepted',
  INVITATION_REVOKED: 'studios.invitations.resendRevoked',
  INVITATION_NOT_RESENDABLE: 'studios.invitations.resendNotResendable',
  INVITATION_EMAIL_ALREADY_MEMBER: 'studios.invitations.resendEmailAlreadyMember',
  INVITATION_RESEND_RATE_LIMITED: 'studios.invitations.resendRateLimited',
  INVITATION_RESEND_CONFLICT: 'studios.invitations.resendConflict',
  INVITATION_DELIVERY_FAILED: 'studios.invitations.resendDeliveryFailed',
  INVITATION_DELIVERY_RECOVERY_FAILED: 'studios.invitations.resendDeliveryFailed',
}
// A failed delivery changes server-side state (the invitation is marked
// expired so it stays resendable, see docs/STAGE_3C_PILOT_UX_POLISH.md) -
// the row must be reloaded from the server afterwards rather than left
// showing whatever status it had before the attempt.
const RESEND_ERRORS_REQUIRING_RELOAD = new Set([
  'INVITATION_DELIVERY_FAILED',
  'INVITATION_DELIVERY_RECOVERY_FAILED',
])

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
const resendingId = ref(null)
const errorMessage = ref('')
const successMessage = ref('')
const pendingRevoke = ref(null)
const pendingResend = ref(null)
let generation = 0
const isOwner = computed(() => activeStudio.value?.membership?.role === 'owner')

function displayEmail(invitation) {
  return RESENDABLE_STATUSES.includes(invitation.status) && invitation.email
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
  resendingId.value = null
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

function changePage(nextPage) {
  const totalPages = pagination.value?.totalPages || 0
  if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page.value) return
  page.value = nextPage
  load()
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
    const confirmation = result.delivery?.delivered
      ? t('studios.invitations.sent')
      : t('studios.invitations.created')
    successMessage.value = confirmation
    toastSuccess(confirmation)
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

function requestRevoke(invitation) {
  pendingRevoke.value = invitation
}

function cancelRevoke() {
  pendingRevoke.value = null
}

async function confirmRevoke() {
  const invitation = pendingRevoke.value
  pendingRevoke.value = null
  if (invitation) await revoke(invitation)
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
    toastSuccess(t('studios.invitations.revoked'))
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      const message = error.status === 403 ? t('studios.permissionDenied') : t('studios.invitations.revokeError')
      errorMessage.value = message
      toastError(message)
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) revokingId.value = null
  }
}

function requestResend(invitation) {
  pendingResend.value = invitation
}

function cancelResend() {
  pendingResend.value = null
}

async function confirmResendAction() {
  const invitation = pendingResend.value
  pendingResend.value = null
  if (invitation) await resend(invitation)
}

async function resend(invitation) {
  const current = generation
  const currentStudioId = studioId.value
  resendingId.value = invitation.id
  errorMessage.value = ''
  successMessage.value = ''
  deliveryLink.value = ''
  try {
    const result = await resendInvitation(currentStudioId, invitation.id)
    if (current !== generation || currentStudioId !== studioId.value) return
    invitations.value = invitations.value.map((item) => item.id === invitation.id
      ? { ...item, ...result.invitation }
      : item)
    const link = safeDeliveryLink(result.delivery)
    if (link) deliveryLink.value = link
    const confirmation = t('studios.invitations.resent')
    successMessage.value = confirmation
    toastSuccess(confirmation)
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      const code = error.data?.error?.code
      const message = error.status === 403
        ? t('studios.permissionDenied')
        : t(RESEND_ERROR_KEYS[code] || 'studios.invitations.resendError')
      if (RESEND_ERRORS_REQUIRING_RELOAD.has(code)) {
        // A failed delivery already changed the server-side status (see
        // compensateResendDeliveryFailure) - reload rather than leave the
        // row showing its pre-attempt status. load() manages its own
        // generation/staleness guard internally.
        await load({ preserveTransient: true })
      }
      errorMessage.value = message
      toastError(message)
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) resendingId.value = null
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
      <PageHeader :eyebrow="activeStudio?.name" :title="t('studios.invitations.title')" :subtitle="t('studios.invitations.subtitle')" />

      <form class="card studio-form-card studio-form" @submit.prevent="submit">
        <div class="studio-form-grid">
          <div class="form-group">
            <label class="form-label" for="invitation-email">{{ t('studios.invitations.email') }}</label>
            <input id="invitation-email" v-model="email" class="input" type="email" required autocomplete="email" />
          </div>
          <div class="form-group">
            <label class="form-label" for="invitation-role">{{ t('studios.invitations.role') }}</label>
            <select id="invitation-role" v-model="role" class="select">
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
          <button class="btn btn-secondary btn-sm" type="button" @click="copyDeliveryLink">{{ t('studios.invitations.copy') }}</button>
        </aside>
        <div class="form-actions">
          <span class="studio-help" style="margin-right: auto;">{{ t('studios.invitations.serverAuthority') }}</span>
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            <span v-if="isSaving" class="spinner" aria-hidden="true"></span>
            {{ isSaving ? t('common.saving') : t('studios.invitations.submit') }}
          </button>
        </div>
      </form>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
      </div>

      <article v-else class="card">
        <h2 class="studio-invitations-list-title">{{ t('studios.invitations.openTitle') }}</h2>
        <EmptyState v-if="!invitations.length" :title="t('studios.invitations.empty')" />
        <div v-else class="table-wrap table-stack">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('studios.invitations.email') }}</th>
                <th>{{ t('studios.invitations.role') }}</th>
                <th>{{ t('studios.members.columnStatus') }}</th>
                <th>{{ t('studios.invitations.columns.createdAt') }}</th>
                <th>{{ t('studios.invitations.columns.expiresAt') }}</th>
                <th>{{ t('studios.members.columnActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="invitation in invitations" :key="invitation.id">
                <td :data-label="t('studios.invitations.email')">
                  <div class="studio-identity">
                    <strong class="studio-truncate" :title="displayEmail(invitation)">{{ displayEmail(invitation) }}</strong>
                    <span v-if="invitation.invitedBy?.username" class="studio-truncate" :title="invitation.invitedBy.username">
                      {{ t('studios.invitations.columns.invitedBy') }} {{ invitation.invitedBy.username }}
                    </span>
                  </div>
                </td>
                <td :data-label="t('studios.invitations.role')">
                  <Badge :tone="roleTone(invitation.role)">{{ t(`studios.roles.${invitation.role}`) }}</Badge>
                </td>
                <td :data-label="t('studios.members.columnStatus')">
                  <Badge :tone="invitationStatusTone(invitation.status)">
                    {{ t(`studios.invitationStatuses.${invitation.status}`) }}
                  </Badge>
                </td>
                <td :data-label="t('studios.invitations.columns.createdAt')">{{ invitation.createdAt ? formatDate(invitation.createdAt) : '—' }}</td>
                <td :data-label="t('studios.invitations.columns.expiresAt')">{{ invitation.expiresAt ? formatDate(invitation.expiresAt) : '—' }}</td>
                <td :data-label="t('studios.members.columnActions')">
                  <div v-if="RESENDABLE_STATUSES.includes(invitation.status)" class="table-actions">
                    <button
                      class="btn btn-secondary btn-sm"
                      type="button"
                      :disabled="resendingId === invitation.id || revokingId === invitation.id"
                      :aria-label="t('studios.invitations.resendFor', { email: displayEmail(invitation) })"
                      @click="requestResend(invitation)"
                    >
                      <span v-if="resendingId === invitation.id" class="spinner" aria-hidden="true"></span>
                      {{ t('studios.invitations.resend') }}
                    </button>
                    <button
                      v-if="invitation.status === 'pending'"
                      class="btn btn-danger btn-sm"
                      type="button"
                      :disabled="revokingId === invitation.id || resendingId === invitation.id"
                      @click="requestRevoke(invitation)"
                    >
                      <span v-if="revokingId === invitation.id" class="spinner" aria-hidden="true"></span>
                      {{ t('studios.invitations.revoke') }}
                    </button>
                  </div>
                  <span v-else class="studio-help">{{ t('studios.invitations.noActions') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Pagination
          v-if="pagination && invitations.length"
          :page="page"
          :total-pages="pagination.totalPages || 1"
          :item-label="t('studios.invitations.pagination', { count: pagination.total ?? invitations.length })"
          @change="changePage"
        />
      </article>

      <ConfirmDialog
        :open="!!pendingRevoke"
        :title="t('studios.confirmRevoke.title')"
        :description="pendingRevoke ? t('studios.confirmRevoke.description', { email: displayEmail(pendingRevoke) }) : ''"
        :confirm-label="t('studios.invitations.revoke')"
        tone="danger"
        :busy="!!revokingId"
        @confirm="confirmRevoke"
        @cancel="cancelRevoke"
      />

      <ConfirmDialog
        :open="!!pendingResend"
        :title="t('studios.confirmResend.title')"
        :description="pendingResend ? t('studios.confirmResend.description', { email: displayEmail(pendingResend) }) : ''"
        :confirm-label="t('studios.invitations.resend')"
        tone="primary"
        :busy="!!resendingId"
        @confirm="confirmResendAction"
        @cancel="cancelResend"
      />
    </div>
  </section>
</template>

<style scoped>
.studio-invitations-list-title {
  font-size: var(--text-lg);
  margin-bottom: 0.85rem;
}
</style>
