<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Pagination from '../components/ui/Pagination.vue'
import { t } from '../utils/i18n'
import { programStatusTone } from '../utils/studioBadges'
import { createTrainingProgram, listTrainingPrograms } from '../utils/studioTrainingApi'
import { TRAINING_MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))

const programs = ref([])
const pagination = ref(null)
const page = ref(1)
const isLoading = ref(true)
const errorMessage = ref('')

const showForm = ref(false)
const name = ref('')
const description = ref('')
const isSaving = ref(false)
const formError = ref('')

let generation = 0

async function reconcileStudioAccess(expectedGeneration, expectedStudioId) {
  const selected = await refreshSelectedStudio(expectedStudioId).catch(() => null)
  if (expectedGeneration !== generation || expectedStudioId !== studioId.value || selected?.ignored) return false
  if (!selected) {
    await router.replace({ name: 'studios' })
    return false
  }
  if (!TRAINING_MANAGEMENT_ROLES.includes(selected.membership?.role)) {
    await router.replace({ name: 'studio-access-denied', params: { studioId: selected.id } })
    return false
  }
  return true
}

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentPage = page.value
  programs.value = []
  pagination.value = null
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listTrainingPrograms(currentStudioId, { page: currentPage, limit: 20 })
    if (current !== generation || currentStudioId !== studioId.value || currentPage !== page.value) return
    programs.value = result.trainingPrograms || []
    pagination.value = result.pagination || null
  } catch (error) {
    if (current === generation) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.trainingPrograms.loadError')
    }
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

function toggleForm() {
  showForm.value = !showForm.value
  formError.value = ''
}

async function submit() {
  const current = generation
  const currentStudioId = studioId.value
  formError.value = ''
  if (!name.value.trim()) {
    formError.value = t('studios.trainingPrograms.nameRequired')
    return
  }
  isSaving.value = true
  try {
    await createTrainingProgram(currentStudioId, {
      name: name.value.trim(),
      description: description.value.trim() || null,
    })
    if (current !== generation || currentStudioId !== studioId.value) return
    name.value = ''
    description.value = ''
    showForm.value = false
    toastSuccess(t('studios.trainingPrograms.created'))
    page.value = 1
    await load()
  } catch (error) {
    if (current === generation && currentStudioId === studioId.value) {
      if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current, currentStudioId)) return
      const message = error.status === 403 ? t('studios.permissionDenied') : t('studios.trainingPrograms.createError')
      formError.value = message
      toastError(message)
    }
  } finally {
    if (current === generation && currentStudioId === studioId.value) isSaving.value = false
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
      <PageHeader :eyebrow="activeStudio?.name" :title="t('studios.trainingPrograms.title')" :subtitle="t('studios.trainingPrograms.subtitle')">
        <template #actions>
          <button class="btn btn-primary" type="button" @click="toggleForm">
            {{ showForm ? t('common.cancel') : t('studios.trainingPrograms.new') }}
          </button>
        </template>
      </PageHeader>

      <form v-if="showForm" class="card studio-form-card studio-form" @submit.prevent="submit">
        <div class="form-group">
          <label class="form-label" for="program-name">{{ t('studios.trainingPrograms.name') }}</label>
          <input id="program-name" v-model="name" class="input" type="text" required maxlength="120" />
        </div>
        <div class="form-group">
          <label class="form-label" for="program-description">{{ t('studios.trainingPrograms.description') }}</label>
          <textarea id="program-description" v-model="description" class="input" rows="3" maxlength="500"></textarea>
        </div>
        <p v-if="formError" class="message message-error" role="alert">{{ formError }}</p>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            <span v-if="isSaving" class="spinner" aria-hidden="true"></span>
            {{ isSaving ? t('common.saving') : t('studios.trainingPrograms.submit') }}
          </button>
        </div>
      </form>

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <div v-if="isLoading" class="studio-grid" aria-live="polite" aria-busy="true">
        <div class="card skeleton skeleton-text" style="height: 6rem;"></div>
        <div class="card skeleton skeleton-text" style="height: 6rem;"></div>
      </div>

      <template v-else>
        <EmptyState v-if="!programs.length" :title="t('studios.trainingPrograms.empty')" />
        <div v-else class="studio-grid">
          <RouterLink
            v-for="program in programs"
            :key="program.id"
            :to="{ name: 'studio-training-program-detail', params: { studioId, programId: program.id } }"
            class="card studio-card"
          >
            <div class="studio-page-header">
              <h2>{{ program.name }}</h2>
              <Badge :tone="programStatusTone(program.status)">{{ t(`studios.trainingStatuses.${program.status}`) }}</Badge>
            </div>
            <p class="studio-muted">{{ program.description || t('studios.trainingPrograms.noDescription') }}</p>
            <span class="studio-help">{{ t('studios.trainingPrograms.open') }}</span>
          </RouterLink>
        </div>

        <Pagination
          v-if="pagination && programs.length"
          :page="page"
          :total-pages="pagination.totalPages || 1"
          :item-label="t('studios.trainingPrograms.pagination', { count: pagination.total ?? programs.length })"
          @change="changePage"
        />
      </template>
    </div>
  </section>
</template>
