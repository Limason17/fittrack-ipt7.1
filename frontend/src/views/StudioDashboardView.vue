<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import StudioSubnav from '../components/StudioSubnav.vue'
import { t } from '../utils/i18n'
import { getMyMembership, getStudio } from '../utils/studioApi'
import { refreshSelectedStudio, selectStudio, updateAuthorizedStudio } from '../utils/studioContext'

const route = useRoute()
const router = useRouter()
const studio = ref(null)
const membership = ref(null)
const isLoading = ref(true)
const errorMessage = ref('')
let loadGeneration = 0

const studioId = computed(() => String(route.params.studioId || ''))
const role = computed(() => membership.value?.role || studio.value?.membership?.role || null)

function roleLabel(value) {
  return t(`studios.roles.${value}`)
}

async function loadStudio() {
  const generation = ++loadGeneration
  const currentStudioId = studioId.value
  studio.value = null
  membership.value = null
  errorMessage.value = ''
  isLoading.value = true
  try {
    const [studioResult, membershipResult] = await Promise.all([
      getStudio(currentStudioId),
      getMyMembership(currentStudioId),
    ])
    if (generation !== loadGeneration || currentStudioId !== studioId.value) return
    const freshStudio = {
      ...studioResult.studio,
      membership: membershipResult.membership,
    }
    if (freshStudio.membership?.status !== 'active') {
      selectStudio(null)
      await router.replace({ name: 'studios' })
      return
    }
    studio.value = freshStudio
    membership.value = freshStudio.membership
    updateAuthorizedStudio(freshStudio)
  } catch (error) {
    if (generation !== loadGeneration || currentStudioId !== studioId.value) return
    if (error.status === 404) {
      const selected = await refreshSelectedStudio(currentStudioId).catch(() => null)
      if (
        generation !== loadGeneration ||
        currentStudioId !== studioId.value ||
        selected?.ignored
      ) return
      if (!selected) {
        selectStudio(null)
        await router.replace({ name: 'studios' })
        return
      }
    }
    errorMessage.value = error.status === 403
      ? t('studios.permissionDenied')
      : t('studios.loadError')
  } finally {
    if (generation === loadGeneration) isLoading.value = false
  }
}

watch(studioId, loadStudio, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
      <div v-if="isLoading" class="card empty-state" aria-live="polite">{{ t('common.loading') }}</div>

      <template v-else-if="studio">
        <header class="studio-page-header">
          <div>
            <span class="eyebrow">{{ t('studios.dashboard') }}</span>
            <h1 class="page-title">{{ studio.name }}</h1>
            <p class="page-subtitle">{{ t('studios.dashboardSubtitle') }}</p>
          </div>
          <span class="pill studio-pill-active">{{ roleLabel(role) }}</span>
        </header>

        <StudioSubnav :studio-id="studioId" :role="role" />

        <article class="card studio-detail-card">
          <h2>{{ t('studios.details') }}</h2>
          <dl class="studio-details">
            <div><dt>{{ t('studios.fields.slug') }}</dt><dd>{{ studio.slug }}</dd></div>
            <div><dt>{{ t('studios.fields.locale') }}</dt><dd>{{ studio.defaultLocale }}</dd></div>
            <div><dt>{{ t('studios.fields.timezone') }}</dt><dd>{{ studio.defaultTimezone }}</dd></div>
            <div><dt>{{ t('studios.fields.weightUnit') }}</dt><dd>{{ studio.defaultWeightUnit }}</dd></div>
          </dl>
        </article>
      </template>
    </div>
  </section>
</template>
