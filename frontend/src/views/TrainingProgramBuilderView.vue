<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { t } from '../utils/i18n'
import { programStatusTone, programVersionStatusTone } from '../utils/studioBadges'
import {
  createProgramDay,
  createProgramExercise,
  createProgramVersion,
  deleteProgramDay,
  deleteProgramExercise,
  getProgramVersion,
  getTrainingProgram,
  listProgramVersions,
  publishProgramVersion,
  updateProgramDay,
  updateProgramExercise,
  updateProgramVersion,
  updateTrainingProgram,
} from '../utils/studioTrainingApi'
import { TRAINING_MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const programId = computed(() => String(route.params.programId || ''))

const program = ref(null)
const versions = ref([])
const selectedVersionId = ref('')
const selectedVersion = ref(null)
const isLoading = ref(true)
const isLoadingVersion = ref(false)
const errorMessage = ref('')

const isDraft = computed(() => selectedVersion.value?.status === 'draft')
const isArchived = computed(() => program.value?.status === 'archived')

let generation = 0

async function reconcileStudioAccess(expectedGeneration) {
  const selected = await refreshSelectedStudio(studioId.value).catch(() => null)
  if (expectedGeneration !== generation || selected?.ignored) return false
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

function handleLoadError(error, current, fallbackKey) {
  if (current !== generation) return
  errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t(fallbackKey)
}

async function loadProgram() {
  const current = generation
  try {
    const result = await getTrainingProgram(studioId.value, programId.value)
    if (current !== generation) return
    program.value = result.trainingProgram
  } catch (error) {
    if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current)) return
    handleLoadError(error, current, 'studios.trainingPrograms.loadError')
  }
}

async function loadVersions({ selectId } = {}) {
  const current = generation
  try {
    const result = await listProgramVersions(studioId.value, programId.value, { page: 1, limit: 100 })
    if (current !== generation) return
    versions.value = result.programVersions || []
    const preferredId = selectId || selectedVersionId.value
    const stillExists = versions.value.some((version) => version.id === preferredId)
    const nextId = stillExists ? preferredId : versions.value[0]?.id || ''
    if (nextId !== selectedVersionId.value) {
      selectedVersionId.value = nextId
    } else if (nextId) {
      await loadSelectedVersion()
    }
  } catch (error) {
    if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current)) return
    handleLoadError(error, current, 'studios.programBuilder.loadError')
  }
}

async function loadSelectedVersion() {
  const current = generation
  const versionId = selectedVersionId.value
  if (!versionId) {
    selectedVersion.value = null
    return
  }
  isLoadingVersion.value = true
  try {
    const result = await getProgramVersion(studioId.value, programId.value, versionId)
    if (current !== generation || versionId !== selectedVersionId.value) return
    selectedVersion.value = result.programVersion
  } catch (error) {
    if ([403, 404].includes(error.status) && !await reconcileStudioAccess(current)) return
    handleLoadError(error, current, 'studios.programBuilder.loadError')
  } finally {
    if (current === generation && versionId === selectedVersionId.value) isLoadingVersion.value = false
  }
}

async function loadAll() {
  const current = ++generation
  program.value = null
  versions.value = []
  selectedVersionId.value = ''
  selectedVersion.value = null
  isLoading.value = true
  errorMessage.value = ''
  await Promise.all([loadProgram(), loadVersions()])
  if (current === generation) isLoading.value = false
}

watch(selectedVersionId, () => { loadSelectedVersion() })
watch([studioId, programId], loadAll, { immediate: true })

// ---- Program actions ----

const pendingArchive = ref(false)
const isArchiving = ref(false)

function requestArchive() { pendingArchive.value = true }
function cancelArchive() { pendingArchive.value = false }

async function confirmArchive() {
  pendingArchive.value = false
  isArchiving.value = true
  try {
    const result = await updateTrainingProgram(studioId.value, programId.value, { status: 'archived' })
    program.value = result.trainingProgram
    toastSuccess(t('studios.trainingPrograms.archived'))
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.trainingPrograms.archiveError'))
  } finally {
    isArchiving.value = false
  }
}

// ---- Version actions ----

const isCreatingVersion = ref(false)
const notesDraft = ref('')
const isSavingNotes = ref(false)
const isPublishing = ref(false)
const pendingPublish = ref(false)

watch(selectedVersion, (version) => { notesDraft.value = version?.notes || '' })

async function createNewVersion() {
  isCreatingVersion.value = true
  try {
    const result = await createProgramVersion(studioId.value, programId.value, {})
    toastSuccess(t('studios.programBuilder.versionCreated'))
    await loadVersions({ selectId: result.programVersion.id })
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.versionCreateError'))
  } finally {
    isCreatingVersion.value = false
  }
}

async function saveNotes() {
  if (!selectedVersion.value) return
  isSavingNotes.value = true
  try {
    const result = await updateProgramVersion(studioId.value, programId.value, selectedVersion.value.id, {
      notes: notesDraft.value.trim() || null,
    })
    selectedVersion.value = { ...selectedVersion.value, notes: result.programVersion.notes }
    toastSuccess(t('studios.programBuilder.notesSaved'))
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.notesSaveError'))
  } finally {
    isSavingNotes.value = false
  }
}

function requestPublish() { pendingPublish.value = true }
function cancelPublish() { pendingPublish.value = false }

async function confirmPublish() {
  pendingPublish.value = false
  if (!selectedVersion.value) return
  isPublishing.value = true
  try {
    await publishProgramVersion(studioId.value, programId.value, selectedVersion.value.id)
    toastSuccess(t('studios.programBuilder.published'))
    await Promise.all([loadProgram(), loadVersions({ selectId: selectedVersionId.value })])
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.publishError'))
  } finally {
    isPublishing.value = false
  }
}

// ---- Day actions ----

const newDayForm = reactive({ name: '', instructions: '' })
const isAddingDay = ref(false)
const dayEdits = reactive({})
const editingDayId = ref(null)
const mutatingDayId = ref(null)
const pendingRemoveDay = ref(null)

async function addDay() {
  if (!newDayForm.name.trim()) {
    toastError(t('studios.programBuilder.nameRequired'))
    return
  }
  isAddingDay.value = true
  try {
    await createProgramDay(studioId.value, programId.value, selectedVersionId.value, {
      name: newDayForm.name.trim(),
      instructions: newDayForm.instructions.trim() || null,
    })
    newDayForm.name = ''
    newDayForm.instructions = ''
    toastSuccess(t('studios.programBuilder.dayAdded'))
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.dayAddError'))
  } finally {
    isAddingDay.value = false
  }
}

function startEditDay(day) {
  dayEdits[day.id] = { name: day.name, instructions: day.instructions || '' }
  editingDayId.value = day.id
}

function cancelEditDay() {
  editingDayId.value = null
}

async function saveDay(day) {
  const draft = dayEdits[day.id]
  if (!draft.name.trim()) {
    toastError(t('studios.programBuilder.nameRequired'))
    return
  }
  mutatingDayId.value = day.id
  try {
    await updateProgramDay(studioId.value, programId.value, selectedVersionId.value, day.id, {
      name: draft.name.trim(),
      instructions: draft.instructions.trim() || null,
    })
    editingDayId.value = null
    toastSuccess(t('studios.programBuilder.dayUpdated'))
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.dayUpdateError'))
  } finally {
    mutatingDayId.value = null
  }
}

async function setDayPosition(day, position) {
  if (position === day.position) return
  mutatingDayId.value = day.id
  try {
    await updateProgramDay(studioId.value, programId.value, selectedVersionId.value, day.id, { position })
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.dayUpdateError'))
  } finally {
    mutatingDayId.value = null
  }
}

function moveDay(day, targetIndex) {
  const days = selectedVersion.value?.days || []
  if (targetIndex < 0 || targetIndex >= days.length) return
  setDayPosition(day, targetIndex + 1)
}

function requestRemoveDay(day) { pendingRemoveDay.value = day }
function cancelRemoveDay() { pendingRemoveDay.value = null }

async function confirmRemoveDay() {
  const day = pendingRemoveDay.value
  pendingRemoveDay.value = null
  if (!day) return
  mutatingDayId.value = day.id
  try {
    await deleteProgramDay(studioId.value, programId.value, selectedVersionId.value, day.id)
    toastSuccess(t('studios.programBuilder.dayRemoved'))
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.dayRemoveError'))
  } finally {
    mutatingDayId.value = null
  }
}

// ---- Exercise actions ----

function emptyExerciseForm() {
  return {
    exerciseNameSnapshot: '',
    instructions: '',
    targetSets: '',
    targetRepsMin: '',
    targetRepsMax: '',
    targetWeight: '',
    targetDurationMinutes: '',
    targetDistanceKm: '',
    targetRpe: '',
    restSeconds: '',
  }
}

function exercisePayload(form) {
  const num = (value) => (value === '' || value === null || value === undefined ? null : Number(value))
  return {
    exerciseNameSnapshot: form.exerciseNameSnapshot.trim(),
    instructions: form.instructions.trim() || null,
    targetSets: num(form.targetSets),
    targetRepsMin: num(form.targetRepsMin),
    targetRepsMax: num(form.targetRepsMax),
    targetWeight: num(form.targetWeight),
    targetDurationMinutes: num(form.targetDurationMinutes),
    targetDistanceKm: num(form.targetDistanceKm),
    targetRpe: num(form.targetRpe),
    restSeconds: num(form.restSeconds),
  }
}

const addingExerciseForDay = ref(null)
const exerciseForms = reactive({})
const editingExerciseId = ref(null)
const mutatingExerciseId = ref(null)
const pendingRemoveExercise = ref(null)

function openAddExercise(day) {
  exerciseForms[`new-${day.id}`] = emptyExerciseForm()
  addingExerciseForDay.value = day.id
}

function cancelAddExercise() {
  addingExerciseForDay.value = null
}

async function submitAddExercise(day) {
  const form = exerciseForms[`new-${day.id}`]
  if (!form.exerciseNameSnapshot.trim()) {
    toastError(t('studios.programBuilder.nameRequired'))
    return
  }
  mutatingExerciseId.value = `new-${day.id}`
  try {
    await createProgramExercise(studioId.value, programId.value, selectedVersionId.value, day.id, exercisePayload(form))
    addingExerciseForDay.value = null
    toastSuccess(t('studios.programBuilder.exerciseAdded'))
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.exerciseAddError'))
  } finally {
    mutatingExerciseId.value = null
  }
}

function startEditExercise(exercise) {
  exerciseForms[exercise.id] = {
    exerciseNameSnapshot: exercise.exerciseNameSnapshot,
    instructions: exercise.instructions || '',
    targetSets: exercise.targetSets ?? '',
    targetRepsMin: exercise.targetRepsMin ?? '',
    targetRepsMax: exercise.targetRepsMax ?? '',
    targetWeight: exercise.targetWeight ?? '',
    targetDurationMinutes: exercise.targetDurationMinutes ?? '',
    targetDistanceKm: exercise.targetDistanceKm ?? '',
    targetRpe: exercise.targetRpe ?? '',
    restSeconds: exercise.restSeconds ?? '',
  }
  editingExerciseId.value = exercise.id
}

function cancelEditExercise() {
  editingExerciseId.value = null
}

async function saveExercise(day, exercise) {
  const form = exerciseForms[exercise.id]
  if (!form.exerciseNameSnapshot.trim()) {
    toastError(t('studios.programBuilder.nameRequired'))
    return
  }
  mutatingExerciseId.value = exercise.id
  try {
    await updateProgramExercise(
      studioId.value, programId.value, selectedVersionId.value, day.id, exercise.id, exercisePayload(form)
    )
    editingExerciseId.value = null
    toastSuccess(t('studios.programBuilder.exerciseUpdated'))
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.exerciseUpdateError'))
  } finally {
    mutatingExerciseId.value = null
  }
}

async function setExercisePosition(day, exercise, position) {
  if (position === exercise.position) return
  mutatingExerciseId.value = exercise.id
  try {
    await updateProgramExercise(studioId.value, programId.value, selectedVersionId.value, day.id, exercise.id, { position })
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.exerciseUpdateError'))
  } finally {
    mutatingExerciseId.value = null
  }
}

function moveExercise(day, exercise, targetIndex) {
  const exercises = day.exercises || []
  if (targetIndex < 0 || targetIndex >= exercises.length) return
  setExercisePosition(day, exercise, targetIndex + 1)
}

function requestRemoveExercise(day, exercise) { pendingRemoveExercise.value = { day, exercise } }
function cancelRemoveExercise() { pendingRemoveExercise.value = null }

async function confirmRemoveExercise() {
  const pending = pendingRemoveExercise.value
  pendingRemoveExercise.value = null
  if (!pending) return
  mutatingExerciseId.value = pending.exercise.id
  try {
    await deleteProgramExercise(studioId.value, programId.value, selectedVersionId.value, pending.day.id, pending.exercise.id)
    toastSuccess(t('studios.programBuilder.exerciseRemoved'))
    await loadSelectedVersion()
  } catch (error) {
    toastError(error.status === 403 ? t('studios.permissionDenied') : t('studios.programBuilder.exerciseRemoveError'))
  } finally {
    mutatingExerciseId.value = null
  }
}
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <RouterLink :to="{ name: 'studio-training-programs', params: { studioId } }" class="studio-help">
        ← {{ t('studios.programBuilder.backToList') }}
      </RouterLink>

      <div v-if="isLoading" class="card skeleton skeleton-text" style="height: 8rem;" aria-busy="true"></div>

      <template v-else-if="program">
        <PageHeader :eyebrow="activeStudio?.name" :title="program.name" :subtitle="program.description || ''">
          <template #badge>
            <Badge :tone="programStatusTone(program.status)">{{ t(`studios.trainingStatuses.${program.status}`) }}</Badge>
          </template>
          <template v-if="!isArchived" #actions>
            <button class="btn btn-secondary" type="button" :disabled="isArchiving" @click="requestArchive">
              {{ t('studios.trainingPrograms.archiveAction') }}
            </button>
          </template>
        </PageHeader>

        <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

        <article class="card">
          <div class="studio-toolbar">
            <h2 class="studio-section-title">{{ t('studios.programBuilder.versionsTitle') }}</h2>
            <button
              v-if="!isArchived"
              class="btn btn-primary btn-sm"
              type="button"
              :disabled="isCreatingVersion"
              @click="createNewVersion"
            >
              <span v-if="isCreatingVersion" class="spinner" aria-hidden="true"></span>
              {{ t('studios.programBuilder.newVersion') }}
            </button>
          </div>
          <div v-if="versions.length" class="version-tabs" role="tablist" :aria-label="t('studios.programBuilder.versionsTitle')">
            <button
              v-for="version in versions"
              :key="version.id"
              type="button"
              role="tab"
              class="version-tab"
              :aria-selected="version.id === selectedVersionId"
              @click="selectedVersionId = version.id"
            >
              {{ t('studios.programBuilder.versionLabel', { number: version.versionNumber }) }}
              <Badge :tone="programVersionStatusTone(version.status)">{{ t(`studios.trainingStatuses.${version.status}`) }}</Badge>
            </button>
          </div>
          <EmptyState v-else :title="t('studios.programBuilder.emptyDays')" />
        </article>

        <div v-if="isLoadingVersion" class="card skeleton skeleton-text" style="height: 6rem;" aria-busy="true"></div>

        <template v-else-if="selectedVersion">
          <article class="card">
            <p v-if="!isDraft" class="message message-info" role="status">{{ t('studios.programBuilder.publishedNotice') }}</p>

            <div class="form-group">
              <label class="form-label" :for="`version-notes-${selectedVersion.id}`">{{ t('studios.programBuilder.notes') }}</label>
              <textarea
                :id="`version-notes-${selectedVersion.id}`"
                v-model="notesDraft"
                class="input"
                rows="2"
                maxlength="500"
                :readonly="!isDraft"
                :placeholder="t('studios.programBuilder.notesPlaceholder')"
              ></textarea>
            </div>
            <div v-if="isDraft" class="form-actions">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="isSavingNotes" @click="saveNotes">
                <span v-if="isSavingNotes" class="spinner" aria-hidden="true"></span>
                {{ t('studios.programBuilder.saveNotes') }}
              </button>
              <button class="btn btn-primary btn-sm" type="button" :disabled="isPublishing" @click="requestPublish">
                {{ t('studios.programBuilder.publishAction') }}
              </button>
            </div>
          </article>

          <article class="card">
            <h2 class="studio-section-title">{{ t('studios.programBuilder.daysTitle') }}</h2>
            <EmptyState v-if="!selectedVersion.days.length" :title="t('studios.programBuilder.emptyDays')" />

            <ul v-else class="program-day-list">
              <li v-for="(day, dayIndex) in selectedVersion.days" :key="day.id" class="program-day-card">
                <div v-if="editingDayId === day.id" class="studio-form">
                  <div class="form-group">
                    <label class="form-label" :for="`day-name-${day.id}`">{{ t('studios.programBuilder.dayName') }}</label>
                    <input :id="`day-name-${day.id}`" v-model="dayEdits[day.id].name" class="input" type="text" maxlength="120" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" :for="`day-instructions-${day.id}`">{{ t('studios.programBuilder.dayInstructions') }}</label>
                    <textarea :id="`day-instructions-${day.id}`" v-model="dayEdits[day.id].instructions" class="input" rows="2" maxlength="1000"></textarea>
                  </div>
                  <div class="form-actions">
                    <button class="btn btn-secondary btn-sm" type="button" @click="cancelEditDay">{{ t('studios.programBuilder.cancel') }}</button>
                    <button class="btn btn-primary btn-sm" type="button" :disabled="mutatingDayId === day.id" @click="saveDay(day)">
                      <span v-if="mutatingDayId === day.id" class="spinner" aria-hidden="true"></span>
                      {{ t('common.save') }}
                    </button>
                  </div>
                </div>
                <div v-else class="program-day-header">
                  <div>
                    <h3>{{ day.name }}</h3>
                    <p v-if="day.instructions" class="studio-muted">{{ day.instructions }}</p>
                  </div>
                  <div v-if="isDraft" class="reorder-controls" role="group" :aria-label="t('studios.programBuilder.positionFor', { name: day.name })">
                    <button type="button" class="btn btn-secondary btn-sm" :disabled="dayIndex === 0 || mutatingDayId === day.id" @click="moveDay(day, dayIndex - 1)">
                      {{ t('studios.programBuilder.moveUp') }}
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" :disabled="dayIndex === selectedVersion.days.length - 1 || mutatingDayId === day.id" @click="moveDay(day, dayIndex + 1)">
                      {{ t('studios.programBuilder.moveDown') }}
                    </button>
                    <label>
                      <span class="visually-hidden">{{ t('studios.programBuilder.positionLabel') }}</span>
                      <select class="select studio-inline-select" :value="day.position" @change="setDayPosition(day, Number($event.target.value))">
                        <option v-for="n in selectedVersion.days.length" :key="n" :value="n">{{ n }}</option>
                      </select>
                    </label>
                    <button class="btn btn-secondary btn-sm" type="button" @click="startEditDay(day)">{{ t('common.edit') }}</button>
                    <button class="btn btn-danger btn-sm" type="button" :disabled="mutatingDayId === day.id" @click="requestRemoveDay(day)">
                      {{ t('studios.programBuilder.removeDay') }}
                    </button>
                  </div>
                </div>

                <h4 class="studio-section-title">{{ t('studios.programBuilder.exercisesTitle') }}</h4>
                <EmptyState v-if="!day.exercises.length" :title="t('studios.programBuilder.emptyExercises')" />
                <ul v-else class="program-exercise-list">
                  <li v-for="(exercise, exerciseIndex) in day.exercises" :key="exercise.id" class="program-exercise-row">
                    <template v-if="editingExerciseId === exercise.id">
                      <div class="studio-form-grid">
                        <div class="form-group">
                          <label class="form-label" :for="`ex-name-${exercise.id}`">{{ t('studios.programBuilder.exerciseName') }}</label>
                          <input :id="`ex-name-${exercise.id}`" v-model="exerciseForms[exercise.id].exerciseNameSnapshot" class="input" type="text" maxlength="80" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-instructions-${exercise.id}`">{{ t('studios.programBuilder.exerciseInstructions') }}</label>
                          <input :id="`ex-instructions-${exercise.id}`" v-model="exerciseForms[exercise.id].instructions" class="input" type="text" maxlength="500" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-sets-${exercise.id}`">{{ t('studios.programBuilder.targetSets') }}</label>
                          <input :id="`ex-sets-${exercise.id}`" v-model="exerciseForms[exercise.id].targetSets" class="input" type="number" min="1" max="20" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-reps-min-${exercise.id}`">{{ t('studios.programBuilder.targetRepsMin') }}</label>
                          <input :id="`ex-reps-min-${exercise.id}`" v-model="exerciseForms[exercise.id].targetRepsMin" class="input" type="number" min="1" max="100" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-reps-max-${exercise.id}`">{{ t('studios.programBuilder.targetRepsMax') }}</label>
                          <input :id="`ex-reps-max-${exercise.id}`" v-model="exerciseForms[exercise.id].targetRepsMax" class="input" type="number" min="1" max="100" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-weight-${exercise.id}`">{{ t('studios.programBuilder.targetWeight') }}</label>
                          <input :id="`ex-weight-${exercise.id}`" v-model="exerciseForms[exercise.id].targetWeight" class="input" type="number" min="0" step="0.5" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-duration-${exercise.id}`">{{ t('studios.programBuilder.targetDuration') }}</label>
                          <input :id="`ex-duration-${exercise.id}`" v-model="exerciseForms[exercise.id].targetDurationMinutes" class="input" type="number" min="1" max="600" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-distance-${exercise.id}`">{{ t('studios.programBuilder.targetDistance') }}</label>
                          <input :id="`ex-distance-${exercise.id}`" v-model="exerciseForms[exercise.id].targetDistanceKm" class="input" type="number" min="0" step="0.1" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-rpe-${exercise.id}`">{{ t('studios.programBuilder.targetRpe') }}</label>
                          <input :id="`ex-rpe-${exercise.id}`" v-model="exerciseForms[exercise.id].targetRpe" class="input" type="number" min="0" max="10" step="0.5" />
                        </div>
                        <div class="form-group">
                          <label class="form-label" :for="`ex-rest-${exercise.id}`">{{ t('studios.programBuilder.restSeconds') }}</label>
                          <input :id="`ex-rest-${exercise.id}`" v-model="exerciseForms[exercise.id].restSeconds" class="input" type="number" min="0" max="3600" />
                        </div>
                      </div>
                      <div class="form-actions">
                        <button class="btn btn-secondary btn-sm" type="button" @click="cancelEditExercise">{{ t('studios.programBuilder.cancel') }}</button>
                        <button class="btn btn-primary btn-sm" type="button" :disabled="mutatingExerciseId === exercise.id" @click="saveExercise(day, exercise)">
                          <span v-if="mutatingExerciseId === exercise.id" class="spinner" aria-hidden="true"></span>
                          {{ t('common.save') }}
                        </button>
                      </div>
                    </template>
                    <template v-else>
                      <div class="program-exercise-header">
                        <strong>{{ exercise.exerciseNameSnapshot }}</strong>
                        <span class="studio-meta">
                          <span v-if="exercise.targetSets">{{ exercise.targetSets }} × {{ exercise.targetRepsMin ?? '–' }}–{{ exercise.targetRepsMax ?? '–' }} {{ t('common.reps') }}</span>
                          <span v-if="exercise.targetWeight">{{ exercise.targetWeight }} {{ t('common.kg') }}</span>
                          <span v-if="exercise.targetDurationMinutes">{{ exercise.targetDurationMinutes }} {{ t('common.minutesShort') }}</span>
                          <span v-if="exercise.targetDistanceKm">{{ exercise.targetDistanceKm }} {{ t('common.km') }}</span>
                          <span v-if="exercise.targetRpe">RPE {{ exercise.targetRpe }}</span>
                          <span v-if="exercise.restSeconds">{{ exercise.restSeconds }}s {{ t('studios.programBuilder.restSeconds') }}</span>
                        </span>
                        <p v-if="exercise.instructions" class="studio-muted">{{ exercise.instructions }}</p>
                      </div>
                      <div v-if="isDraft" class="reorder-controls" role="group" :aria-label="t('studios.programBuilder.positionFor', { name: exercise.exerciseNameSnapshot })">
                        <button type="button" class="btn btn-secondary btn-sm" :disabled="exerciseIndex === 0 || mutatingExerciseId === exercise.id" @click="moveExercise(day, exercise, exerciseIndex - 1)">
                          {{ t('studios.programBuilder.moveUp') }}
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" :disabled="exerciseIndex === day.exercises.length - 1 || mutatingExerciseId === exercise.id" @click="moveExercise(day, exercise, exerciseIndex + 1)">
                          {{ t('studios.programBuilder.moveDown') }}
                        </button>
                        <label>
                          <span class="visually-hidden">{{ t('studios.programBuilder.positionLabel') }}</span>
                          <select class="select studio-inline-select" :value="exercise.position" @change="setExercisePosition(day, exercise, Number($event.target.value))">
                            <option v-for="n in day.exercises.length" :key="n" :value="n">{{ n }}</option>
                          </select>
                        </label>
                        <button class="btn btn-secondary btn-sm" type="button" @click="startEditExercise(exercise)">{{ t('common.edit') }}</button>
                        <button class="btn btn-danger btn-sm" type="button" :disabled="mutatingExerciseId === exercise.id" @click="requestRemoveExercise(day, exercise)">
                          {{ t('studios.programBuilder.removeExercise') }}
                        </button>
                      </div>
                    </template>
                  </li>
                </ul>

                <div v-if="isDraft">
                  <button v-if="addingExerciseForDay !== day.id" class="btn btn-secondary btn-sm" type="button" @click="openAddExercise(day)">
                    {{ t('studios.programBuilder.addExercise') }}
                  </button>
                  <div v-else class="studio-form-grid">
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-name-${day.id}`">{{ t('studios.programBuilder.exerciseName') }}</label>
                      <input :id="`new-ex-name-${day.id}`" v-model="exerciseForms[`new-${day.id}`].exerciseNameSnapshot" class="input" type="text" maxlength="80" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-instructions-${day.id}`">{{ t('studios.programBuilder.exerciseInstructions') }}</label>
                      <input :id="`new-ex-instructions-${day.id}`" v-model="exerciseForms[`new-${day.id}`].instructions" class="input" type="text" maxlength="500" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-sets-${day.id}`">{{ t('studios.programBuilder.targetSets') }}</label>
                      <input :id="`new-ex-sets-${day.id}`" v-model="exerciseForms[`new-${day.id}`].targetSets" class="input" type="number" min="1" max="20" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-reps-min-${day.id}`">{{ t('studios.programBuilder.targetRepsMin') }}</label>
                      <input :id="`new-ex-reps-min-${day.id}`" v-model="exerciseForms[`new-${day.id}`].targetRepsMin" class="input" type="number" min="1" max="100" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-reps-max-${day.id}`">{{ t('studios.programBuilder.targetRepsMax') }}</label>
                      <input :id="`new-ex-reps-max-${day.id}`" v-model="exerciseForms[`new-${day.id}`].targetRepsMax" class="input" type="number" min="1" max="100" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-weight-${day.id}`">{{ t('studios.programBuilder.targetWeight') }}</label>
                      <input :id="`new-ex-weight-${day.id}`" v-model="exerciseForms[`new-${day.id}`].targetWeight" class="input" type="number" min="0" step="0.5" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-duration-${day.id}`">{{ t('studios.programBuilder.targetDuration') }}</label>
                      <input :id="`new-ex-duration-${day.id}`" v-model="exerciseForms[`new-${day.id}`].targetDurationMinutes" class="input" type="number" min="1" max="600" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-distance-${day.id}`">{{ t('studios.programBuilder.targetDistance') }}</label>
                      <input :id="`new-ex-distance-${day.id}`" v-model="exerciseForms[`new-${day.id}`].targetDistanceKm" class="input" type="number" min="0" step="0.1" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-rpe-${day.id}`">{{ t('studios.programBuilder.targetRpe') }}</label>
                      <input :id="`new-ex-rpe-${day.id}`" v-model="exerciseForms[`new-${day.id}`].targetRpe" class="input" type="number" min="0" max="10" step="0.5" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" :for="`new-ex-rest-${day.id}`">{{ t('studios.programBuilder.restSeconds') }}</label>
                      <input :id="`new-ex-rest-${day.id}`" v-model="exerciseForms[`new-${day.id}`].restSeconds" class="input" type="number" min="0" max="3600" />
                    </div>
                    <div class="form-actions studio-form-wide">
                      <button class="btn btn-secondary btn-sm" type="button" @click="cancelAddExercise">{{ t('studios.programBuilder.cancel') }}</button>
                      <button class="btn btn-primary btn-sm" type="button" :disabled="mutatingExerciseId === `new-${day.id}`" @click="submitAddExercise(day)">
                        <span v-if="mutatingExerciseId === `new-${day.id}`" class="spinner" aria-hidden="true"></span>
                        {{ t('studios.programBuilder.addExercise') }}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            </ul>

            <form v-if="isDraft" class="studio-form" @submit.prevent="addDay">
              <h3 class="studio-section-title">{{ t('studios.programBuilder.addDay') }}</h3>
              <div class="form-group">
                <label class="form-label" for="new-day-name">{{ t('studios.programBuilder.dayName') }}</label>
                <input id="new-day-name" v-model="newDayForm.name" class="input" type="text" maxlength="120" />
              </div>
              <div class="form-group">
                <label class="form-label" for="new-day-instructions">{{ t('studios.programBuilder.dayInstructions') }}</label>
                <textarea id="new-day-instructions" v-model="newDayForm.instructions" class="input" rows="2" maxlength="1000"></textarea>
              </div>
              <div class="form-actions">
                <button class="btn btn-primary btn-sm" type="submit" :disabled="isAddingDay">
                  <span v-if="isAddingDay" class="spinner" aria-hidden="true"></span>
                  {{ t('studios.programBuilder.addDay') }}
                </button>
              </div>
            </form>
          </article>
        </template>
      </template>

      <ConfirmDialog
        :open="pendingArchive"
        :title="t('studios.trainingPrograms.confirmArchive.title')"
        :description="t('studios.trainingPrograms.confirmArchive.description')"
        tone="danger"
        :confirm-label="t('studios.trainingPrograms.archiveAction')"
        :busy="isArchiving"
        @confirm="confirmArchive"
        @cancel="cancelArchive"
      />
      <ConfirmDialog
        :open="pendingPublish"
        :title="t('studios.programBuilder.confirmPublish.title')"
        :description="t('studios.programBuilder.confirmPublish.description')"
        :confirm-label="t('studios.programBuilder.publishAction')"
        :busy="isPublishing"
        @confirm="confirmPublish"
        @cancel="cancelPublish"
      />
      <ConfirmDialog
        :open="!!pendingRemoveDay"
        :title="t('studios.programBuilder.confirmRemoveDay.title')"
        :description="pendingRemoveDay ? t('studios.programBuilder.confirmRemoveDay.description', { name: pendingRemoveDay.name }) : ''"
        tone="danger"
        :confirm-label="t('studios.programBuilder.removeDay')"
        :busy="!!mutatingDayId"
        @confirm="confirmRemoveDay"
        @cancel="cancelRemoveDay"
      />
      <ConfirmDialog
        :open="!!pendingRemoveExercise"
        :title="t('studios.programBuilder.confirmRemoveExercise.title')"
        :description="pendingRemoveExercise ? t('studios.programBuilder.confirmRemoveExercise.description', { name: pendingRemoveExercise.exercise.exerciseNameSnapshot }) : ''"
        tone="danger"
        :confirm-label="t('studios.programBuilder.removeExercise')"
        :busy="!!mutatingExerciseId"
        @confirm="confirmRemoveExercise"
        @cancel="cancelRemoveExercise"
      />
    </div>
  </section>
</template>

<style scoped>
.studio-section-title {
  font-size: var(--text-lg);
  margin-bottom: 0.6rem;
}

.version-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.version-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: var(--text-sm);
  font-weight: 650;
}

.version-tab[aria-selected='true'] {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.program-day-list,
.program-exercise-list {
  list-style: none;
  display: grid;
  gap: 1rem;
  margin: 0.75rem 0;
}

.program-exercise-list {
  gap: 0.75rem;
}

.program-day-card {
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
}

.program-day-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.program-exercise-row {
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.program-exercise-header {
  margin-bottom: 0.5rem;
}

.reorder-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

@media (max-width: 560px) {
  .program-day-header {
    flex-direction: column;
    align-items: stretch;
  }

  .reorder-controls {
    width: 100%;
  }

  .reorder-controls .btn {
    flex: 1;
  }
}
</style>
