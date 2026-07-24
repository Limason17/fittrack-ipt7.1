<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { confirmEmailChange } from '../utils/accountApi'
import { t } from '../utils/i18n'

const route = useRoute()
const isConfirming = ref(false)
const isConfirmed = ref(false)
const errorMessage = ref('')
let generation = 0

// Deliberately requires an explicit click rather than auto-confirming on
// mount: this route just renders the frontend page (a plain GET), which a
// corporate mail-security link-scanner may prefetch on its own before the
// real user ever opens the message. Auto-firing the confirmation POST from
// that prefetch would burn the one-time token before the account owner
// gets to it - the same reason invitation-accept requires an explicit
// click rather than confirming as soon as the link is opened.
watch(
  () => route.params.token,
  () => {
    generation += 1
    isConfirming.value = false
    isConfirmed.value = false
    errorMessage.value = ''
  },
  { immediate: true }
)

async function confirm() {
  const current = generation
  const token = String(route.params.token || '')
  errorMessage.value = ''
  isConfirming.value = true
  try {
    await confirmEmailChange(token)
    if (current !== generation || token !== String(route.params.token || '')) return
    isConfirmed.value = true
  } catch {
    if (current === generation && token === String(route.params.token || '')) {
      errorMessage.value = t('accountEmailChangeConfirm.errorGeneric')
    }
  } finally {
    if (current === generation && token === String(route.params.token || '')) {
      isConfirming.value = false
    }
  }
}

onBeforeUnmount(() => { generation += 1 })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <article class="card studio-detail-card">
        <span class="eyebrow">{{ t('accountEmailChangeConfirm.eyebrow') }}</span>
        <template v-if="isConfirmed">
          <h1 class="page-title">{{ t('accountEmailChangeConfirm.successTitle') }}</h1>
          <p class="page-subtitle">{{ t('accountEmailChangeConfirm.successText') }}</p>
          <div class="studio-form-actions">
            <RouterLink replace class="btn btn-primary" :to="{ name: 'login' }">
              {{ t('accountEmailChangeConfirm.toLogin') }}
            </RouterLink>
          </div>
        </template>
        <template v-else>
          <h1 class="page-title">{{ t('accountEmailChangeConfirm.title') }}</h1>
          <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
          <div class="studio-form-actions">
            <RouterLink replace class="btn btn-secondary" :to="{ name: 'home' }">{{ t('common.cancel') }}</RouterLink>
            <button class="btn btn-primary" type="button" :disabled="isConfirming" @click="confirm">
              <span v-if="isConfirming" class="spinner" aria-hidden="true"></span>
              {{ isConfirming ? t('accountEmailChangeConfirm.confirming') : t('accountEmailChangeConfirm.title') }}
            </button>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>
