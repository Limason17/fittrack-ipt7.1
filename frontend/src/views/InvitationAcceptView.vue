<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { logout, safeInternalRedirect } from '../utils/auth'
import { t } from '../utils/i18n'
import { acceptInvitation } from '../utils/studioApi'
import { addAndSelectStudio } from '../utils/studioContext'

const route = useRoute()
const router = useRouter()
const isAccepting = ref(false)
const errorMessage = ref('')
let generation = 0

watch(
  () => route.params.token,
  () => {
    generation += 1
    isAccepting.value = false
    errorMessage.value = ''
  },
  { immediate: true }
)

async function accept() {
  const current = generation
  const token = String(route.params.token || '')
  errorMessage.value = ''
  isAccepting.value = true
  try {
    const result = await acceptInvitation(token)
    if (current !== generation || token !== String(route.params.token || '')) return
    const studio = {
      ...result.studio,
      membership: result.membership || result.studio?.membership,
    }
    const selected = addAndSelectStudio(studio)
    if (!selected) throw new Error('Accepted invitation did not return an active membership.')
    await router.replace({ name: 'studio-dashboard', params: { studioId: selected.id } })
  } catch (error) {
    if (current === generation && token === String(route.params.token || '')) {
      errorMessage.value = error.status === 403
        ? t('studios.invitationAccept.forbidden')
        : t('studios.invitationAccept.error')
    }
  } finally {
    if (current === generation && token === String(route.params.token || '')) {
      isAccepting.value = false
    }
  }
}

async function switchAccount() {
  const redirect = safeInternalRedirect(route.fullPath)
  await logout()
  await router.replace({ name: 'login', query: { redirect } })
}

onBeforeUnmount(() => { generation += 1 })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <article class="card studio-detail-card">
        <span class="eyebrow">{{ t('studios.invitationAccept.eyebrow') }}</span>
        <h1 class="page-title">{{ t('studios.invitationAccept.title') }}</h1>
        <p class="page-subtitle">{{ t('studios.invitationAccept.subtitle') }}</p>
        <p class="studio-help">{{ t('studios.invitationAccept.accountNotice') }}</p>
        <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
        <div class="studio-form-actions">
          <RouterLink replace class="btn btn-secondary" :to="{ name: 'home' }">{{ t('common.cancel') }}</RouterLink>
          <button class="btn btn-secondary" type="button" :disabled="isAccepting" @click="switchAccount">
            {{ t('studios.invitationAccept.switchAccount') }}
          </button>
          <button class="btn btn-primary" type="button" :disabled="isAccepting" @click="accept">
            {{ isAccepting ? t('common.saving') : t('studios.invitationAccept.submit') }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
