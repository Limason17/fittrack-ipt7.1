<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { useRouter } from 'vue-router'

import Modal from '../ui/Modal.vue'
import { t } from '../../utils/i18n'
import { authUser, clearAuthState } from '../../utils/auth'
import { getAccountDeletionPreview, requestAccountDeletion } from '../../utils/accountApi'
import { toastSuccess } from '../../utils/toast'
import { createRetryCountdown } from '../../utils/retryCountdown'

const router = useRouter()

const titleId = `account-deletion-title-${useId()}`
const passwordId = `account-deletion-password-${useId()}`
const passwordErrorId = `${passwordId}-error`
const phraseId = `account-deletion-phrase-${useId()}`
const phraseErrorId = `${phraseId}-error`

// 'preview' | 'confirm' - one persistent Modal instance hosts both steps, so
// the focus trap/backdrop/Escape wiring (Modal.vue -> useModalFocus) never
// has to tear down and re-initialize between them.
const dialogOpen = ref(false)
const step = ref('preview')

const preview = ref(null)
const previewLoading = ref(false)
const previewError = ref('')
let previewGeneration = 0

const currentPassword = ref('')
const confirmationPhrase = ref('')
const passwordFieldError = ref('')
const phraseFieldError = ref('')
const formError = ref('')
const submitting = ref(false)
const passwordInputRef = ref(null)

const { secondsRemaining: rateLimitSeconds, start: startRateLimitCountdown, clear: clearRateLimitCountdown } =
  createRetryCountdown()
const rateLimited = computed(() => rateLimitSeconds.value > 0)

const hasBlockers = computed(() => Array.isArray(preview.value?.blockers) && preview.value.blockers.length > 0)
const blockerStudios = computed(() => (preview.value?.blockers || []).flatMap((blocker) => blocker.studios || []))
const previewUnavailable = computed(() => preview.value?.alreadyDeleted === true)

const expectedPhrase = computed(() => authUser.value?.username || '')
// Exact, case-sensitive, no trim: the backend compares confirmationPhrase
// against the username with strict equality (accountDeletionService.js) -
// silently correcting whitespace here would let a submit enable itself for
// an input the server would still reject.
const phraseMatches = computed(() => expectedPhrase.value !== '' && confirmationPhrase.value === expectedPhrase.value)
const phraseMessage = computed(() => {
  if (phraseFieldError.value) return { text: phraseFieldError.value, tone: 'error' }
  if (confirmationPhrase.value && !phraseMatches.value) {
    return { text: t('profile.security.dangerZone.phraseMismatch'), tone: 'warning' }
  }
  return null
})

const canSubmit = computed(
  () => Boolean(currentPassword.value) && phraseMatches.value && !submitting.value && !rateLimited.value
)

function countRow(key, labelKey, value) {
  return { key, label: t(`profile.security.dangerZone.${labelKey}`), value: Number(value) }
}

const removedRows = computed(() => {
  const p = preview.value
  if (!p || previewUnavailable.value) return []
  return [
    countRow('workouts', 'countWorkouts', p.personalDataCounts?.workouts),
    countRow('progressEntries', 'countProgressEntries', p.personalDataCounts?.progressEntries),
    countRow('personalExercises', 'countPersonalExercises', p.personalDataCounts?.personalExercises),
    countRow('personalCalendarEntriesToDelete', 'countPersonalCalendarEntries', p.impact?.personalCalendarEntriesToDelete),
    countRow('runningWorkoutSessions', 'countRunningWorkoutSessions', p.impact?.runningWorkoutSessions),
    countRow('activeAssignments', 'countActiveAssignments', p.impact?.activeAssignments),
    countRow('activeCoachingRelationships', 'countActiveCoachingRelationships', p.impact?.activeCoachingRelationships),
    countRow('activeScheduleRules', 'countActiveScheduleRules', p.impact?.activeScheduleRules),
    countRow('futureStudioCalendarEntries', 'countFutureStudioCalendarEntries', p.impact?.futureStudioCalendarEntries),
  ].filter((row) => row.value > 0)
})

const preservedRows = computed(() => {
  const p = preview.value
  if (!p || previewUnavailable.value) return []
  return [
    countRow('studioWorkoutSessions', 'countStudioWorkoutSessions', p.preservedHistoryCounts?.studioWorkoutSessions),
    countRow('programAssignments', 'countProgramAssignments', p.preservedHistoryCounts?.programAssignments),
    countRow('coachFeedbackReceived', 'countCoachFeedbackReceived', p.preservedHistoryCounts?.coachFeedbackReceived),
    countRow('coachFeedbackAuthored', 'countCoachFeedbackAuthored', p.preservedHistoryCounts?.coachFeedbackAuthored),
  ].filter((row) => row.value > 0)
})

async function loadPreview() {
  const generation = ++previewGeneration
  previewLoading.value = true
  previewError.value = ''
  try {
    const result = await getAccountDeletionPreview()
    if (generation !== previewGeneration) return
    preview.value = result.deletionPreview
  } catch {
    if (generation !== previewGeneration) return
    preview.value = null
    previewError.value = t('profile.security.dangerZone.previewError')
  } finally {
    if (generation === previewGeneration) previewLoading.value = false
  }
}

function openDangerZone() {
  dialogOpen.value = true
  step.value = 'preview'
  loadPreview()
}

function resetDialogState() {
  previewGeneration += 1
  step.value = 'preview'
  preview.value = null
  previewLoading.value = false
  previewError.value = ''
  currentPassword.value = ''
  confirmationPhrase.value = ''
  passwordFieldError.value = ''
  phraseFieldError.value = ''
  formError.value = ''
  submitting.value = false
  clearRateLimitCountdown()
}

// Wired to Modal's @close, which fires on both Escape and a backdrop click -
// guarding here covers both the same way, and keeps a delete request that is
// already in flight from being abandoned mid-air (Section 14).
function requestClose() {
  if (submitting.value) return
  dialogOpen.value = false
  resetDialogState()
}

function goToConfirmStep() {
  if (hasBlockers.value || previewUnavailable.value || !preview.value) return
  step.value = 'confirm'
  nextTick(() => passwordInputRef.value?.focus())
}

async function submitDeletion() {
  if (submitting.value || !canSubmit.value) return
  formError.value = ''
  passwordFieldError.value = ''
  phraseFieldError.value = ''
  submitting.value = true
  try {
    await requestAccountDeletion({
      currentPassword: currentPassword.value,
      confirmationPhrase: confirmationPhrase.value,
    })
    await finishSuccessfulDeletion()
  } catch (error) {
    handleDeletionError(error)
  } finally {
    submitting.value = false
  }
}

function handleDeletionError(error) {
  const code = error?.data?.error?.code
  // Another request (a second tab, or a retry racing this one) already
  // completed the deletion - the account is gone either way, so this is
  // treated exactly like a local success rather than as a failure.
  if (code === 'ACCOUNT_ALREADY_DELETED') {
    finishSuccessfulDeletion()
    return
  }
  // Race between preview and execute (Section 8): a studio ownership change
  // landed in between. The dialog stays open, falls back to the preview
  // step with fresh data, and never claims success.
  if (code === 'ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED') {
    formError.value = ''
    step.value = 'preview'
    loadPreview()
    return
  }
  if (code === 'CURRENT_PASSWORD_INVALID') {
    passwordFieldError.value = t('profile.security.dangerZone.errorPasswordInvalid')
    currentPassword.value = ''
    return
  }
  if (code === 'ACCOUNT_DELETION_PHRASE_MISMATCH') {
    phraseFieldError.value = t('profile.security.dangerZone.errorPhraseMismatch')
    return
  }
  if (error?.status === 429) {
    startRateLimitCountdown(error.retryAfterSeconds)
    formError.value = t('profile.security.dangerZone.errorRateLimited')
    return
  }
  // Every deletion-receipt/service-availability failure (Section 11) is a
  // 503 - deliberately matched by status alone rather than enumerating each
  // ACCOUNT_DELETION_SERVICE_UNAVAILABLE/DELETION_RECEIPT_* code, so no
  // internal subsystem detail (receipt, HMAC, doctor) ever needs to reach
  // this mapping to stay covered.
  if (error?.status === 503) {
    formError.value = t('profile.security.dangerZone.errorServiceUnavailable')
    return
  }
  formError.value = t('profile.security.dangerZone.errorGeneric')
}

async function finishSuccessfulDeletion() {
  dialogOpen.value = false
  resetDialogState()
  // The deletion transaction already revoked every session and the response
  // already cleared session cookies server-side (accountRouter.js) - no
  // further logout/refresh request is issued against an account that can no
  // longer authenticate. clearAuthState() is the same local-only cleanup the
  // cross-tab "session-invalidated" listener uses (auth.js), and it already
  // runs every registered auth-cleanup handler, including
  // clearStudioContext() (studioContext.js).
  clearAuthState()
  toastSuccess(t('profile.security.dangerZone.deletionSuccessToast'))
  await router.push({ name: 'login' })
}

onBeforeUnmount(resetDialogState)
</script>

<template>
  <article class="card profile-section danger-zone-card">
    <span class="danger-zone-eyebrow">{{ t('profile.security.dangerZone.title') }}</span>
    <h2>{{ t('profile.security.dangerZone.sectionTitle') }}</h2>
    <p class="studio-help">{{ t('profile.security.dangerZone.description') }}</p>
    <div class="form-actions">
      <button type="button" class="btn btn-danger" @click="openDangerZone">
        {{ t('profile.security.dangerZone.openAction') }}
      </button>
    </div>
  </article>

  <Modal :open="dialogOpen" :title-id="titleId" size="lg" @close="requestClose">
    <template v-if="step === 'preview'">
      <h2 :id="titleId">{{ t('profile.security.dangerZone.previewTitle') }}</h2>

      <div v-if="previewLoading" class="skeleton skeleton-text" aria-busy="true" aria-live="polite" style="height: 3rem;">
        <span class="visually-hidden">{{ t('profile.security.dangerZone.previewLoading') }}</span>
      </div>

      <p v-else-if="previewError" role="alert" class="message message-error">{{ previewError }}</p>

      <template v-else-if="preview && !previewUnavailable">
        <div v-if="hasBlockers" class="message message-warning" role="alert">
          <p class="danger-zone-blocker-title">{{ t('profile.security.dangerZone.blockerTitle') }}</p>
          <p>{{ t('profile.security.dangerZone.blockerExplanation') }}</p>
          <p class="danger-zone-blocker-studios-label">{{ t('profile.security.dangerZone.blockerStudiosLabel') }}</p>
          <ul>
            <li v-for="studio in blockerStudios" :key="studio.studioId">{{ studio.studioName }}</li>
          </ul>
        </div>

        <template v-else>
          <section class="danger-zone-group">
            <h3>{{ t('profile.security.dangerZone.impactGroupRemoved') }}</h3>
            <ul v-if="removedRows.length" class="danger-zone-list">
              <li v-for="row in removedRows" :key="row.key">{{ row.label }}: <strong>{{ row.value }}</strong></li>
            </ul>
            <p v-else class="studio-help">{{ t('profile.security.dangerZone.impactNone') }}</p>
          </section>

          <section class="danger-zone-group">
            <h3>{{ t('profile.security.dangerZone.impactGroupPreserved') }}</h3>
            <ul v-if="preservedRows.length" class="danger-zone-list">
              <li v-for="row in preservedRows" :key="row.key">{{ row.label }}: <strong>{{ row.value }}</strong></li>
            </ul>
            <p v-else class="studio-help">{{ t('profile.security.dangerZone.impactNone') }}</p>
          </section>

          <section v-if="preview.notices" class="danger-zone-group">
            <h3>{{ t('profile.security.dangerZone.impactGroupNotices') }}</h3>
            <ul class="danger-zone-list">
              <li v-if="preview.notices.freeTextRetention">{{ preview.notices.freeTextRetention }}</li>
              <li v-if="preview.notices.backupRetention">{{ preview.notices.backupRetention }}</li>
              <li>{{ t('profile.security.dangerZone.emailReuseNotice') }}</li>
            </ul>
          </section>
        </template>
      </template>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" data-autofocus @click="requestClose">
          {{ hasBlockers ? t('profile.security.dangerZone.blockerClose') : t('profile.security.dangerZone.cancelAction') }}
        </button>
        <button v-if="previewError" type="button" class="btn btn-primary" @click="loadPreview">
          {{ t('profile.security.dangerZone.retryAction') }}
        </button>
        <button
          v-else-if="preview && !hasBlockers && !previewUnavailable"
          type="button"
          class="btn btn-primary"
          @click="goToConfirmStep"
        >
          {{ t('profile.security.dangerZone.continueAction') }}
        </button>
      </div>
    </template>

    <template v-else>
      <h2 :id="titleId">{{ t('profile.security.dangerZone.confirmTitle') }}</h2>
      <p class="studio-help">{{ t('profile.security.dangerZone.confirmDescription') }}</p>

      <form class="danger-zone-confirm-form" @submit.prevent="submitDeletion">
        <div class="form-group">
          <label class="form-label" :for="passwordId">{{ t('profile.security.dangerZone.passwordLabel') }}</label>
          <input
            :id="passwordId"
            ref="passwordInputRef"
            v-model="currentPassword"
            class="input"
            type="password"
            autocomplete="current-password"
            :aria-invalid="Boolean(passwordFieldError)"
            :aria-describedby="passwordFieldError ? passwordErrorId : undefined"
            required
          />
          <p v-if="passwordFieldError" :id="passwordErrorId" role="alert" class="message message-error">
            {{ passwordFieldError }}
          </p>
        </div>

        <div class="form-group">
          <label class="form-label" :for="phraseId">{{ t('profile.security.dangerZone.phraseLabel') }}</label>
          <p class="studio-help">{{ t('profile.security.dangerZone.phraseHint', { username: expectedPhrase }) }}</p>
          <input
            :id="phraseId"
            v-model="confirmationPhrase"
            class="input"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            :aria-invalid="Boolean(phraseMessage)"
            :aria-describedby="phraseMessage ? phraseErrorId : undefined"
            required
          />
          <p
            v-if="phraseMessage"
            :id="phraseErrorId"
            :role="phraseMessage.tone === 'error' ? 'alert' : 'status'"
            :class="phraseMessage.tone === 'error' ? 'message message-error' : 'message message-warning'"
          >
            {{ phraseMessage.text }}
          </p>
        </div>

        <p v-if="formError" role="alert" class="message message-error">
          {{ formError }}
          <span v-if="rateLimited"> {{ t('common.retryAfter', { seconds: rateLimitSeconds }) }}</span>
        </p>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="requestClose">
            {{ t('profile.security.dangerZone.cancelAction') }}
          </button>
          <button type="submit" class="btn btn-danger" :disabled="!canSubmit" :aria-busy="submitting">
            <span v-if="submitting" class="spinner" aria-hidden="true"></span>
            {{ submitting ? t('profile.security.dangerZone.deleting') : t('profile.security.dangerZone.deleteAction') }}
          </button>
        </div>
      </form>
    </template>
  </Modal>
</template>

<style scoped>
.danger-zone-card {
  margin-top: 1.5rem;
}

.danger-zone-eyebrow {
  display: inline-block;
  font-size: var(--text-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.danger-zone-group h3 {
  font-size: var(--text-sm);
  margin-bottom: 0.4rem;
}

.danger-zone-list {
  display: grid;
  gap: 0.3rem;
  padding-left: 1.1rem;
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.danger-zone-blocker-title,
.danger-zone-blocker-studios-label {
  font-weight: 800;
}

.danger-zone-confirm-form {
  display: grid;
  gap: 1rem;
}
</style>
