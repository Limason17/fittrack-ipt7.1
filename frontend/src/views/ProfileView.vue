<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AccountDeletionDangerZone from '../components/profile/AccountDeletionDangerZone.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import { authUser, logout, logoutAll } from '../utils/auth'
import {
  changePassword,
  getCurrentEmailChangeRequest,
  requestEmailChange,
  revokeEmailChangeRequest,
} from '../utils/accountApi'
import { formatDate, languages, locale, setLanguage, t } from '../utils/i18n'
import { distanceUnit, setDistanceUnit, setWeightUnit, weightUnit } from '../utils/units'
import { toastError, toastSuccess } from '../utils/toast'
import { createRetryCountdown } from '../utils/retryCountdown'

const router = useRouter()
const activeTab = ref('account')
const tabs = [
  { value: 'account', label: t('profile.accountTab') },
  { value: 'security', label: t('profile.securityTab') },
  { value: 'preferences', label: t('profile.preferencesTab') },
]

async function chooseLanguage(code) {
  await setLanguage(code)
  toastSuccess(t('studios.settings.saved'))
}

async function chooseWeightUnit(unit) {
  await setWeightUnit(unit)
  toastSuccess(t('studios.settings.saved'))
}

async function chooseDistanceUnit(unit) {
  await setDistanceUnit(unit)
  toastSuccess(t('studios.settings.saved'))
}

const loggingOutAll = ref(false)
const pendingLogoutAll = ref(false)

async function handleLogout() {
  await logout()
  router.push('/login')
}

function requestLogoutAll() {
  pendingLogoutAll.value = true
}

function cancelLogoutAll() {
  pendingLogoutAll.value = false
}

async function confirmLogoutAll() {
  pendingLogoutAll.value = false
  loggingOutAll.value = true
  try {
    await logoutAll()
  } finally {
    loggingOutAll.value = false
  }
  router.push('/login')
}

// ---- Password change ----
const currentPassword = ref('')
const newPassword = ref('')
const newPasswordConfirmation = ref('')
const showPasswords = ref(false)
const passwordSaving = ref(false)
const passwordError = ref('')
const { secondsRemaining: passwordRetrySeconds, start: startPasswordRetryCountdown } = createRetryCountdown()
const passwordRateLimited = computed(() => passwordRetrySeconds.value > 0)

function passwordFieldType() {
  return showPasswords.value ? 'text' : 'password'
}

function resetPasswordForm() {
  currentPassword.value = ''
  newPassword.value = ''
  newPasswordConfirmation.value = ''
}

function mapPasswordError(error) {
  const code = error?.data?.error?.code
  if (error?.status === 429) {
    startPasswordRetryCountdown(error.retryAfterSeconds)
    return t('profile.security.rateLimited')
  }
  if (code === 'CURRENT_PASSWORD_INVALID') return t('profile.security.currentPasswordInvalid')
  if (code === 'NEW_PASSWORD_SAME_AS_CURRENT') return t('profile.security.newPasswordSameAsCurrent')
  if (code === 'PASSWORD_CONFIRMATION_MISMATCH') return t('profile.security.passwordMismatch')
  if (code === 'VALIDATION_ERROR') return t('auth.passwordLength')
  return t('profile.security.genericError')
}

async function submitPasswordChange() {
  passwordError.value = ''
  if (!currentPassword.value || !newPassword.value || !newPasswordConfirmation.value) {
    passwordError.value = t('auth.fillFields')
    return
  }
  if (newPassword.value.length < 6) {
    passwordError.value = t('auth.passwordLength')
    return
  }
  if (newPassword.value !== newPasswordConfirmation.value) {
    passwordError.value = t('profile.security.passwordMismatch')
    return
  }
  passwordSaving.value = true
  try {
    await changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
      newPasswordConfirmation: newPasswordConfirmation.value,
    })
    resetPasswordForm()
    toastSuccess(t('profile.security.passwordChanged'))
    // The password change already revoked every session server-side
    // (see accountService.js) - this is purely a local state clear plus
    // navigation, not another server round trip.
    await logout()
    router.push({ name: 'login' })
  } catch (error) {
    passwordError.value = mapPasswordError(error)
  } finally {
    passwordSaving.value = false
  }
}

// ---- Email change ----
const openRequest = ref(null)
const emailRequestLoading = ref(true)
const emailRequestError = ref('')
const emailRequestSuccess = ref('')
const newEmail = ref('')
const emailCurrentPassword = ref('')
const emailSaving = ref(false)
const { secondsRemaining: emailRetrySeconds, start: startEmailRetryCountdown } = createRetryCountdown()
const emailRateLimited = computed(() => emailRetrySeconds.value > 0)
const revoking = ref(false)
const pendingRevoke = ref(false)
const deliveryLink = ref('')
let emailGeneration = 0

function safeDeliveryLink(delivery) {
  if (typeof delivery?.confirmUrl !== 'string') return ''
  try {
    const parsed = new URL(delivery.confirmUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

async function loadCurrentEmailChangeRequest() {
  const current = ++emailGeneration
  emailRequestLoading.value = true
  try {
    const result = await getCurrentEmailChangeRequest()
    if (current !== emailGeneration) return
    openRequest.value = result.emailChangeRequest
  } catch {
    if (current !== emailGeneration) return
    openRequest.value = null
  } finally {
    if (current === emailGeneration) emailRequestLoading.value = false
  }
}

onMounted(() => {
  loadCurrentEmailChangeRequest()
})
onBeforeUnmount(() => { deliveryLink.value = '' })

function mapEmailError(error) {
  const code = error?.data?.error?.code
  if (error?.status === 429) {
    startEmailRetryCountdown(error.retryAfterSeconds)
    return t('profile.security.rateLimited')
  }
  if (code === 'CURRENT_PASSWORD_INVALID') return t('profile.security.currentPasswordInvalid')
  if (code === 'EMAIL_UNCHANGED') return t('profile.security.emailUnchanged')
  if (code === 'EMAIL_ALREADY_IN_USE') return t('profile.security.emailAlreadyInUse')
  return t('profile.security.genericError')
}

async function submitEmailChangeRequest() {
  const current = emailGeneration
  emailRequestError.value = ''
  emailRequestSuccess.value = ''
  if (!newEmail.value.trim() || !emailCurrentPassword.value) {
    emailRequestError.value = t('auth.fillFields')
    return
  }
  emailSaving.value = true
  try {
    const result = await requestEmailChange({
      newEmail: newEmail.value.trim().toLowerCase(),
      currentPassword: emailCurrentPassword.value,
    })
    if (current !== emailGeneration) return
    openRequest.value = result.emailChangeRequest
    deliveryLink.value = safeDeliveryLink(result.delivery)
    newEmail.value = ''
    emailCurrentPassword.value = ''
    emailRequestSuccess.value = t('profile.security.emailChangeRequested')
    toastSuccess(emailRequestSuccess.value)
  } catch (error) {
    if (current === emailGeneration) emailRequestError.value = mapEmailError(error)
  } finally {
    if (current === emailGeneration) emailSaving.value = false
  }
}

async function copyDeliveryLink() {
  if (!deliveryLink.value || !navigator.clipboard) return
  await navigator.clipboard.writeText(deliveryLink.value)
}

function requestRevoke() {
  pendingRevoke.value = true
}

function cancelRevoke() {
  pendingRevoke.value = false
}

async function confirmRevoke() {
  const current = emailGeneration
  pendingRevoke.value = false
  revoking.value = true
  try {
    await revokeEmailChangeRequest()
    if (current !== emailGeneration) return
    openRequest.value = null
    deliveryLink.value = ''
    toastSuccess(t('profile.security.emailChangeRevoked'))
  } catch {
    if (current === emailGeneration) toastError(t('profile.security.genericError'))
  } finally {
    if (current === emailGeneration) revoking.value = false
  }
}
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="t('profile.eyebrow')" :title="t('profile.title')" :subtitle="t('profile.subtitle')" />

      <Tabs v-model="activeTab" :tabs="tabs" :label="t('profile.title')" />

      <article v-if="activeTab === 'account'" class="card profile-section">
        <h2>{{ t('profile.accountSectionTitle') }}</h2>
        <p class="studio-help">{{ t('profile.accountSectionHint') }}</p>
        <dl class="studio-details">
          <div><dt>{{ t('auth.username') }}</dt><dd>{{ authUser?.username }}</dd></div>
          <div><dt>{{ t('auth.email') }}</dt><dd>{{ authUser?.email }}</dd></div>
        </dl>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="handleLogout">
            {{ t('profile.logoutAction') }}
          </button>
        </div>
      </article>

      <div v-else-if="activeTab === 'security'" class="profile-security">
        <article class="card profile-section">
          <h2>{{ t('profile.security.sessionsSectionTitle') }}</h2>
          <p class="studio-help">{{ t('profile.security.sessionsSectionHint') }}</p>
          <div class="form-actions">
            <button
              type="button"
              class="btn btn-danger"
              :disabled="loggingOutAll"
              @click="requestLogoutAll"
            >
              <span v-if="loggingOutAll" class="spinner" aria-hidden="true"></span>
              {{ loggingOutAll ? t('profile.security.loggingOutAll') : t('profile.security.logoutAllAction') }}
            </button>
          </div>
        </article>

        <form class="card profile-section" @submit.prevent="submitPasswordChange">
          <h2>{{ t('profile.security.passwordSectionTitle') }}</h2>
          <p class="studio-help">{{ t('profile.security.passwordSectionHint') }}</p>

          <div class="form-group">
            <label class="form-label" for="current-password">{{ t('profile.security.currentPassword') }}</label>
            <input
              id="current-password"
              v-model="currentPassword"
              class="input"
              :type="passwordFieldType()"
              autocomplete="current-password"
              required
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="new-password">{{ t('profile.security.newPassword') }}</label>
            <input
              id="new-password"
              v-model="newPassword"
              class="input"
              :type="passwordFieldType()"
              :placeholder="t('auth.passwordPlaceholder')"
              autocomplete="new-password"
              required
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="new-password-confirmation">{{ t('profile.security.newPasswordConfirmation') }}</label>
            <input
              id="new-password-confirmation"
              v-model="newPasswordConfirmation"
              class="input"
              :type="passwordFieldType()"
              autocomplete="new-password"
              required
            />
          </div>
          <label class="profile-show-passwords">
            <input v-model="showPasswords" type="checkbox" />
            {{ showPasswords ? t('profile.security.hidePasswords') : t('profile.security.showPasswords') }}
          </label>

          <p v-if="passwordError" class="message message-error" role="alert">
            {{ passwordError }}
            <span v-if="passwordRateLimited"> {{ t('common.retryAfter', { seconds: passwordRetrySeconds }) }}</span>
          </p>

          <div class="form-actions">
            <button class="btn btn-primary" type="submit" :disabled="passwordSaving || passwordRateLimited">
              <span v-if="passwordSaving" class="spinner" aria-hidden="true"></span>
              {{ passwordSaving ? t('profile.security.changingPassword') : t('profile.security.changePasswordAction') }}
            </button>
          </div>
        </form>

        <article class="card profile-section">
          <h2>{{ t('profile.security.emailSectionTitle') }}</h2>
          <p class="studio-help">{{ t('profile.security.emailSectionHint') }}</p>
          <dl class="studio-details">
            <div><dt>{{ t('profile.security.currentEmail') }}</dt><dd>{{ authUser?.email }}</dd></div>
          </dl>

          <div v-if="emailRequestLoading" class="skeleton skeleton-text" aria-busy="true" aria-live="polite" style="height: 2.5rem;"></div>

          <div v-else-if="openRequest" class="profile-open-request" aria-live="polite">
            <h3>{{ t('profile.security.openRequestTitle') }}</h3>
            <p>{{ t('profile.security.openRequestPending', { email: openRequest.newEmail }) }}</p>
            <p class="studio-help">
              {{ t('profile.security.openRequestExpires', { date: formatDate(openRequest.expiresAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }) }}
            </p>
            <aside v-if="deliveryLink" class="studio-delivery" aria-live="polite">
              <strong>{{ t('studios.invitations.devDeliveryTitle') }}</strong>
              <p>{{ t('studios.invitations.devDeliveryHint') }}</p>
              <a :href="deliveryLink" rel="noreferrer">{{ deliveryLink }}</a>
              <button class="btn btn-secondary btn-sm" type="button" @click="copyDeliveryLink">{{ t('studios.invitations.copy') }}</button>
            </aside>
            <div class="form-actions">
              <button class="btn btn-danger" type="button" :disabled="revoking" @click="requestRevoke">
                <span v-if="revoking" class="spinner" aria-hidden="true"></span>
                {{ revoking ? t('profile.security.revoking') : t('profile.security.revokeAction') }}
              </button>
            </div>
          </div>

          <form v-else @submit.prevent="submitEmailChangeRequest">
            <div class="form-group">
              <label class="form-label" for="new-email">{{ t('profile.security.newEmail') }}</label>
              <input
                id="new-email"
                v-model="newEmail"
                class="input"
                type="email"
                autocomplete="email"
                :placeholder="t('auth.emailPlaceholder')"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="email-change-password">{{ t('profile.security.currentPassword') }}</label>
              <input
                id="email-change-password"
                v-model="emailCurrentPassword"
                class="input"
                type="password"
                autocomplete="current-password"
                required
              />
            </div>

            <p v-if="emailRequestError" class="message message-error" role="alert">
              {{ emailRequestError }}
              <span v-if="emailRateLimited"> {{ t('common.retryAfter', { seconds: emailRetrySeconds }) }}</span>
            </p>
            <p v-if="emailRequestSuccess" class="message message-success" role="status">{{ emailRequestSuccess }}</p>

            <div class="form-actions">
              <button class="btn btn-primary" type="submit" :disabled="emailSaving || emailRateLimited">
                <span v-if="emailSaving" class="spinner" aria-hidden="true"></span>
                {{ emailSaving ? t('profile.security.requestingEmailChange') : t('profile.security.requestEmailChangeAction') }}
              </button>
            </div>
          </form>
        </article>

        <AccountDeletionDangerZone />
      </div>

      <article v-else class="card profile-section">
        <h2>{{ t('profile.preferencesSectionTitle') }}</h2>
        <p class="studio-help">{{ t('profile.preferencesSectionHint') }}</p>

        <div class="profile-pref-group" role="radiogroup" :aria-label="t('routing.language')">
          <span class="form-label">{{ t('routing.language') }}</span>
          <div class="profile-pref-options">
            <button
              v-for="language in languages"
              :key="language.code"
              type="button"
              role="radio"
              class="profile-pref-btn"
              :aria-checked="locale === language.code"
              :class="{ 'profile-pref-btn-active': locale === language.code }"
              @click="chooseLanguage(language.code)"
            >
              {{ language.name }}
            </button>
          </div>
        </div>

        <div class="profile-pref-group" role="radiogroup" :aria-label="t('routing.weightUnit')">
          <span class="form-label">{{ t('routing.weightUnit') }}</span>
          <div class="profile-pref-options">
            <button
              v-for="unit in ['kg', 'lb']"
              :key="unit"
              type="button"
              role="radio"
              class="profile-pref-btn"
              :aria-checked="weightUnit === unit"
              :class="{ 'profile-pref-btn-active': weightUnit === unit }"
              @click="chooseWeightUnit(unit)"
            >
              {{ unit }}
            </button>
          </div>
        </div>

        <div class="profile-pref-group" role="radiogroup" :aria-label="t('routing.distanceUnit')">
          <span class="form-label">{{ t('routing.distanceUnit') }}</span>
          <div class="profile-pref-options">
            <button
              v-for="unit in ['km', 'mi']"
              :key="unit"
              type="button"
              role="radio"
              class="profile-pref-btn"
              :aria-checked="distanceUnit === unit"
              :class="{ 'profile-pref-btn-active': distanceUnit === unit }"
              @click="chooseDistanceUnit(unit)"
            >
              {{ unit }}
            </button>
          </div>
        </div>
      </article>

      <ConfirmDialog
        :open="pendingRevoke"
        :title="t('profile.security.confirmRevokeTitle')"
        :description="openRequest ? t('profile.security.confirmRevokeDescription', { email: openRequest.newEmail }) : ''"
        :confirm-label="t('profile.security.revokeAction')"
        tone="danger"
        :busy="revoking"
        @confirm="confirmRevoke"
        @cancel="cancelRevoke"
      />

      <ConfirmDialog
        :open="pendingLogoutAll"
        :title="t('profile.security.confirmLogoutAllTitle')"
        :description="t('profile.security.confirmLogoutAllDescription')"
        :confirm-label="t('profile.security.logoutAllAction')"
        tone="danger"
        :busy="loggingOutAll"
        @confirm="confirmLogoutAll"
        @cancel="cancelLogoutAll"
      />
    </div>
  </section>
</template>

<style scoped>
.profile-section {
  padding: 1.25rem;
  display: grid;
  gap: 1rem;
  align-content: start;
}

.profile-security {
  display: grid;
  gap: 1.25rem;
}

.profile-show-passwords {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-sm);
  color: var(--text-soft);
}

.profile-open-request {
  display: grid;
  gap: 0.4rem;
}

.profile-pref-group {
  display: grid;
  gap: 0.5rem;
}

.profile-pref-options {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.profile-pref-btn {
  min-height: 40px;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-soft);
  font-size: var(--text-sm);
  font-weight: 700;
}

.profile-pref-btn:hover {
  border-color: var(--accent);
}

.profile-pref-btn-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-hover);
}
</style>
