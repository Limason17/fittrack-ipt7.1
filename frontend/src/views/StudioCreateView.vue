<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import PageHeader from '../components/ui/PageHeader.vue'
import { t } from '../utils/i18n'
import { createStudio } from '../utils/studioApi'
import { addAndSelectStudio } from '../utils/studioContext'

const router = useRouter()
const name = ref('')
const slug = ref('')
const defaultLocale = ref('de')
const defaultTimezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zurich')
const defaultWeightUnit = ref('kg')
const errorMessage = ref('')
const isSaving = ref(false)

const slugPreview = computed(() => {
  const source = slug.value || name.value
  return source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
})

async function submit() {
  errorMessage.value = ''
  if (!name.value.trim()) {
    errorMessage.value = t('studios.create.nameRequired')
    return
  }
  isSaving.value = true
  try {
    const payload = {
      name: name.value.trim(),
      defaultLocale: defaultLocale.value,
      defaultTimezone: defaultTimezone.value,
      defaultWeightUnit: defaultWeightUnit.value,
    }
    if (slug.value.trim()) payload.slug = slugPreview.value
    const result = await createStudio(payload)
    const selected = addAndSelectStudio(result.studio)
    if (!selected) throw new Error('Created studio did not include an active membership.')
    await router.push({ name: 'studio-dashboard', params: { studioId: selected.id } })
  } catch (error) {
    errorMessage.value = error.data?.error?.fields?.slug || t('studios.create.error')
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="t('studios.eyebrow')" :title="t('studios.create.title')" :subtitle="t('studios.create.subtitle')" />

      <form class="card studio-form-card studio-form" @submit.prevent="submit">
        <div class="studio-form-grid">
          <div class="form-group studio-form-wide">
            <label class="form-label" for="studio-name">{{ t('studios.fields.name') }}</label>
            <input id="studio-name" v-model="name" class="input" maxlength="100" required autocomplete="organization" />
          </div>
          <div class="form-group studio-form-wide">
            <label class="form-label" for="studio-slug">{{ t('studios.fields.slugOptional') }}</label>
            <input id="studio-slug" v-model="slug" class="input" maxlength="80" autocomplete="off" />
            <p class="studio-slug-preview">{{ t('studios.create.slugPreview') }}: {{ slugPreview || '-' }}</p>
          </div>
          <div class="form-group">
            <label class="form-label" for="studio-locale">{{ t('studios.fields.locale') }}</label>
            <select id="studio-locale" v-model="defaultLocale" class="select"><option value="de">Deutsch</option><option value="en">English</option></select>
          </div>
          <div class="form-group">
            <label class="form-label" for="studio-timezone">{{ t('studios.fields.timezone') }}</label>
            <input id="studio-timezone" v-model="defaultTimezone" class="input" maxlength="64" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="studio-weight-unit">{{ t('studios.fields.weightUnit') }}</label>
            <select id="studio-weight-unit" v-model="defaultWeightUnit" class="select"><option value="kg">kg</option><option value="lb">lb</option></select>
          </div>
        </div>

        <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
        <div class="form-actions">
          <RouterLink class="btn btn-secondary" :to="{ name: 'studios' }">{{ t('common.cancel') }}</RouterLink>
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            <span v-if="isSaving" class="spinner" aria-hidden="true"></span>
            {{ isSaving ? t('common.saving') : t('studios.create.submit') }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
