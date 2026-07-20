<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import ExercisePanel from '../components/workout/ExercisePanel.vue'
import SaveStatusIndicator from '../components/workout/SaveStatusIndicator.vue'
import { formatDate, t } from '../utils/i18n'
import { workoutSessionStatusTone } from '../utils/studioBadges'
import { activeStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'
import { useWorkoutSession } from '../utils/workoutSessionState'

const DATE_TIME_OPTIONS = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const sessionId = computed(() => String(route.params.sessionId || ''))

const {
  session, isLoading, loadError, isCompleting, isAborting, completionError, abortError,
  addingSetFor, addSetError, isMutable, hasUnsettledWork,
  loadSession, reloadSession, reset,
  updateSessionNote, retrySessionNote,
  updateExercise, retryExercise,
  updateSet, retrySet,
  addSet, completeSession, abortSession,
} = useWorkoutSession()

const noteDraft = ref('')
watch(() => session.value?.memberNote, (value) => { noteDraft.value = value || '' }, { immediate: true })
function commitSessionNote() {
  const trimmed = noteDraft.value.trim()
  if (trimmed.length > 500) return
  if ((trimmed || null) === (session.value?.memberNote || null)) return
  updateSessionNote(trimmed || null)
}

const pendingCompleteConfirm = ref(false)
const pendingAbortConfirm = ref(false)
const incompleteSummary = ref('')
const highlightedExerciseId = ref(null)
const highlightedSetId = ref(null)

const canAttemptComplete = computed(() => isMutable() && !hasUnsettledWork())
const blockedReason = computed(() => {
  if (!isMutable()) return ''
  if (hasUnsettledWork()) return t('studios.workoutSessions.blockedBySaves')
  return ''
})

async function scrollToIncomplete(location) {
  highlightedExerciseId.value = location.exerciseId
  highlightedSetId.value = location.setId
  await nextTick()
  const targetId = location.setId ? `set-${location.setId}` : `exercise-${location.exerciseId}`
  const el = document.getElementById(targetId)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el?.focus()
}

function clearHighlight() {
  highlightedExerciseId.value = null
  highlightedSetId.value = null
  incompleteSummary.value = ''
}

async function confirmComplete() {
  pendingCompleteConfirm.value = false
  const result = await completeSession()
  if (result.ok) {
    toastSuccess(t('studios.workoutSessions.completedToast'))
    clearHighlight()
    return
  }
  if (result.incomplete) {
    incompleteSummary.value = t('studios.workoutSessions.incompleteSummary')
    if (result.firstIncomplete) await scrollToIncomplete(result.firstIncomplete)
  } else {
    toastError(completionError.value)
  }
}

async function confirmAbort() {
  pendingAbortConfirm.value = false
  const result = await abortSession()
  if (result.ok) toastSuccess(t('studios.workoutSessions.abortedToast'))
  else toastError(abortError.value)
}

function goToHistory() {
  router.push({ name: 'studio-workout-sessions', params: { studioId: studioId.value } })
}

watch([studioId, sessionId], () => {
  clearHighlight()
  loadSession(studioId.value, sessionId.value)
}, { immediate: true })

onUnmounted(reset)
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader
        :eyebrow="activeStudio?.name"
        :title="session ? (session.programDay.name || session.program.name) : t('studios.workoutSessions.detailTitle')"
        :subtitle="session ? session.program.name : ''"
      >
        <template v-if="session" #badge>
          <Badge :tone="workoutSessionStatusTone(session.status)">
            {{ t(`studios.workoutSessions.sessionStatuses.${session.status}`) }}
          </Badge>
        </template>
        <template v-if="session" #actions>
          <button type="button" class="btn btn-secondary" @click="goToHistory">
            {{ t('studios.workoutSessions.backToHistory') }}
          </button>
          <template v-if="isMutable()">
            <button type="button" class="btn btn-danger" :disabled="isAborting" @click="pendingAbortConfirm = true">
              {{ t('studios.workoutSessions.abortAction') }}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="!canAttemptComplete || isCompleting"
              @click="pendingCompleteConfirm = true"
            >
              <span v-if="isCompleting" class="spinner" aria-hidden="true"></span>
              {{ t('studios.workoutSessions.completeAction') }}
            </button>
          </template>
        </template>
      </PageHeader>

      <div v-if="session" class="card workout-session-meta">
        <dl class="studio-details">
          <div>
            <dt>{{ t('studios.programBuilder.versionLabel', { number: session.programVersion.versionNumber }) }}</dt>
            <dd>{{ session.program.name }}</dd>
          </div>
          <div>
            <dt>{{ t('studios.workoutSessions.startedAt') }}</dt>
            <dd>{{ formatDate(session.startedAt, DATE_TIME_OPTIONS) }}</dd>
          </div>
          <div v-if="session.completedAt">
            <dt>{{ t('studios.workoutSessions.completedAt') }}</dt>
            <dd>{{ formatDate(session.completedAt, DATE_TIME_OPTIONS) }}</dd>
          </div>
          <div v-if="session.abortedAt">
            <dt>{{ t('studios.workoutSessions.abortedAtLabel') }}</dt>
            <dd>{{ formatDate(session.abortedAt, DATE_TIME_OPTIONS) }}</dd>
          </div>
          <div>
            <dt>{{ t('studios.workoutSessions.saveStatusLabel') }}</dt>
            <dd><SaveStatusIndicator :status="session._save.status" /></dd>
          </div>
        </dl>

        <p v-if="!isMutable()" class="message message-info" role="status">
          {{ t(`studios.workoutSessions.readOnlyHint.${session.status}`) }}
        </p>

        <div class="form-group workout-session-note">
          <label class="form-label" for="session-note">{{ t('studios.workoutSessions.sessionNote') }} ({{ t('common.optional') }})</label>
          <textarea
            id="session-note"
            v-model="noteDraft"
            class="input"
            rows="2"
            maxlength="500"
            :disabled="!isMutable()"
            @blur="commitSessionNote"
          ></textarea>
        </div>
        <p v-if="session._save.status === 'error'" class="message message-error" role="alert">
          {{ session._save.error }}
          <button type="button" class="btn btn-secondary btn-sm" @click="retrySessionNote">{{ t('common.retry') }}</button>
        </p>
        <p v-if="session._save.status === 'conflict'" class="message message-warning" role="alert">
          {{ t('studios.workoutSessions.conflictHint') }}
          <button type="button" class="btn btn-secondary btn-sm" @click="reloadSession">{{ t('studios.workoutSessions.reloadAction') }}</button>
        </p>
      </div>

      <p v-if="blockedReason" class="studio-help" role="status">{{ blockedReason }}</p>
      <p v-if="incompleteSummary" class="message message-warning" role="alert" aria-live="assertive">{{ incompleteSummary }}</p>
      <p v-if="loadError" class="message message-error" role="alert">{{ loadError }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 3rem;"></div>
        <div class="skeleton skeleton-text" style="height: 6rem;"></div>
      </div>

      <div v-else-if="session" class="workout-session-exercises">
        <ExercisePanel
          v-for="exercise in session.exercises"
          :key="exercise.id"
          :exercise="exercise"
          :mutable="isMutable()"
          :adding-set="addingSetFor === exercise.id"
          :add-set-error="addSetError[exercise.id] || ''"
          :highlighted="exercise.id === highlightedExerciseId"
          :highlighted-set-id="highlightedSetId"
          @update-exercise="(patch) => updateExercise(exercise.id, patch)"
          @retry-exercise="retryExercise(exercise.id)"
          @update-set="(setId, patch) => updateSet(exercise.id, setId, patch)"
          @retry-set="(setId) => retrySet(exercise.id, setId)"
          @add-set="addSet(exercise.id)"
          @reload="reloadSession"
        />
      </div>

      <ConfirmDialog
        :open="pendingCompleteConfirm"
        :title="t('studios.workoutSessions.confirmComplete.title')"
        :description="t('studios.workoutSessions.confirmComplete.description')"
        :confirm-label="t('studios.workoutSessions.completeAction')"
        :busy="isCompleting"
        @confirm="confirmComplete"
        @cancel="pendingCompleteConfirm = false"
      />
      <ConfirmDialog
        :open="pendingAbortConfirm"
        :title="t('studios.workoutSessions.confirmAbort.title')"
        :description="t('studios.workoutSessions.confirmAbort.description')"
        tone="danger"
        :confirm-label="t('studios.workoutSessions.abortAction')"
        :busy="isAborting"
        @confirm="confirmAbort"
        @cancel="pendingAbortConfirm = false"
      />
    </div>
  </section>
</template>

<style scoped>
.workout-session-meta {
  display: grid;
  gap: 0.85rem;
}

.workout-session-note textarea {
  resize: vertical;
  min-height: 2.5rem;
}

.workout-session-exercises {
  display: grid;
  gap: 1rem;
}

@media (max-width: 480px) {
  .workout-session-exercises {
    gap: 0.75rem;
  }
}
</style>
