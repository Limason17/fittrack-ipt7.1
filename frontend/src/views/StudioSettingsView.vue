<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import StudioSubnav from '../components/StudioSubnav.vue'
import { t } from '../utils/i18n'
import { getStudio, updateStudio } from '../utils/studioApi'
import { MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio, updateAuthorizedStudio } from '../utils/studioContext'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const studio = ref(null)
const form = ref({
  name: '',
  slug: '',
  defaultLocale: 'de',
  defaultTimezone: 'Europe/Zurich',
  defaultWeightUnit: 'kg',
})
const isLoading = ref(true)
const isSaving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
let generation = 0
const isOwner = computed(() => studio.value?.membership?.role === 'owner')

function applyStudio(value) {
  studio.value = value
  form.value = {
    name: value.name || '',
    slug: value.slug || '',
    defaultLocale: value.defaultLocale || 'de',
    defaultTimezone: value.defaultTimezone || 'Europe/Zurich',
    defaultWeightUnit: value.defaultWeightUnit || 'kg',
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

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  studio.value = null
  form.value = {
    name: '',
    slug: '',
    defaultLocale: 'de',
    defaultTimezone: 'Europe/Zurich',
    defaultWeightUnit: 'kg',
  }
  isSaving.value = false
  isLoading.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await getStudio(currentStudioId)
    if (current !== generation || currentStudioId !== studioId.value) return
    applyStudio({
      ...result.studio,
      membership: result.studio.membership || activeStudio.value?.membership,
    })
  } catch (error) {
    if (current === generation) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.loadError')
    }
  } finally {
    if (current === generation) isLoading.value = false
  }
}

async function save() {
  const current = generation
  const currentStudioId = studioId.value
  const currentMembership = studio.value?.membership
  errorMessage.value = ''
  successMessage.value = ''
  if (!form.value.name.trim()) {
    errorMessage.value = t('studios.create.nameRequired')
    return
  }
  isSaving.value = true
  try {
    const payload = {
      ...form.value,
      name: form.value.name.trim(),
    }
    if (!isOwner.value) delete payload.slug
    const result = await updateStudio(currentStudioId, payload)
    if (current !== generation || currentStudioId !== studioId.value) return
    const fresh = {
      ...result.studio,
      membership: result.studio.membership || currentMembership,
    }
    applyStudio(fresh)
    updateAuthorizedStudio(fresh)
    successMessage.value = t('studios.settings.saved')
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.settings.error')
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) isSaving.value = false
  }
}

watch(studioId, load, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <header>
        <span class="eyebrow">{{ studio?.name || t('studios.eyebrow') }}</span>
        <h1 class="page-title">{{ t('studios.settings.title') }}</h1>
        <p class="page-subtitle">{{ t('studios.settings.subtitle') }}</p>
      </header>

      <StudioSubnav v-if="studio" :studio-id="studioId" :role="studio.membership?.role" />
      <div v-if="isLoading" class="card empty-state">{{ t('common.loading') }}</div>

      <form v-else-if="studio" class="card studio-form-card studio-form" @submit.prevent="save">
        <div class="studio-form-grid">
          <div class="form-group studio-form-wide">
            <label class="form-label" for="settings-name">{{ t('studios.fields.name') }}</label>
            <input id="settings-name" v-model="form.name" class="input" maxlength="100" required />
          </div>
          <div v-if="isOwner" class="form-group studio-form-wide">
            <label class="form-label" for="settings-slug">{{ t('studios.fields.slug') }}</label>
            <input id="settings-slug" v-model="form.slug" class="input" maxlength="80" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="settings-locale">{{ t('studios.fields.locale') }}</label>
            <select id="settings-locale" v-model="form.defaultLocale" class="input"><option value="de">Deutsch</option><option value="en">English</option></select>
          </div>
          <div class="form-group">
            <label class="form-label" for="settings-timezone">{{ t('studios.fields.timezone') }}</label>
            <input id="settings-timezone" v-model="form.defaultTimezone" class="input" maxlength="64" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="settings-weight">{{ t('studios.fields.weightUnit') }}</label>
            <select id="settings-weight" v-model="form.defaultWeightUnit" class="input"><option value="kg">kg</option><option value="lb">lb</option></select>
          </div>
        </div>
        <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
        <p v-if="successMessage" class="message message-success" role="status">{{ successMessage }}</p>
        <div class="studio-form-actions">
          <RouterLink class="btn btn-secondary" :to="{ name: 'studio-dashboard', params: { studioId } }">{{ t('common.cancel') }}</RouterLink>
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            {{ isSaving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </form>
      <p v-if="errorMessage && !studio" class="message message-error" role="alert">{{ errorMessage }}</p>
    </div>
  </section>
</template>
