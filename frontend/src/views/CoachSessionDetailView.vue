<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import FeedbackForm from '../components/workout/FeedbackForm.vue'
import FeedbackList from '../components/workout/FeedbackList.vue'
import { formatDate, t } from '../utils/i18n'
import { workoutItemStatusTone, workoutSessionStatusTone } from '../utils/studioBadges'
import { activeStudio } from '../utils/studioContext'
import { useCoachSessionFeedback } from '../utils/coachFeedbackState'
import { getCoachedMemberWorkoutSession } from '../utils/workoutSessionApi'
import { workoutErrorMessage } from '../utils/workoutSessionErrors'
import { toastError, toastSuccess } from '../utils/toast'

const DATE_TIME_OPTIONS = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const memberMembershipId = computed(() => String(route.params.memberMembershipId || ''))
const sessionId = computed(() => String(route.params.sessionId || ''))

const session = ref(null)
const isLoading = ref(true)
const loadError = ref('')

const {
  entries: feedbackEntries, isLoading: isFeedbackLoading, loadError: feedbackLoadError,
  isSubmitting: isFeedbackSubmitting, submitError: feedbackSubmitError,
  load: loadFeedback, submit: submitFeedback, reset: resetFeedback,
} = useCoachSessionFeedback()
const feedbackFormRef = ref(null)

function targetSummary(exercise) {
  const parts = []
  if (exercise.targetSets) {
    const repsRange = exercise.targetRepsMin != null || exercise.targetRepsMax != null
      ? `${exercise.targetRepsMin ?? '–'}–${exercise.targetRepsMax ?? '–'} ${t('common.reps')}`
      : ''
    parts.push(repsRange ? `${exercise.targetSets} × ${repsRange}` : `${exercise.targetSets} ${t('common.sets')}`)
  }
  if (exercise.targetWeight != null) parts.push(`${exercise.targetWeight} ${t('common.kg')}`)
  if (exercise.targetDurationMinutes != null) parts.push(`${exercise.targetDurationMinutes} ${t('common.minutesShort')}`)
  if (exercise.targetDistanceKm != null) parts.push(`${exercise.targetDistanceKm} ${t('common.km')}`)
  if (exercise.targetRpe != null) parts.push(`RPE ${exercise.targetRpe}`)
  if (exercise.restSeconds != null) parts.push(t('studios.workoutSessions.restSeconds', { seconds: exercise.restSeconds }))
  return parts.join(' · ')
}

function actualSummary(set) {
  const parts = []
  if (set.actualReps != null) parts.push(`${set.actualReps} ${t('common.reps')}`)
  if (set.actualWeight != null) parts.push(`${set.actualWeight} ${t('common.kg')}`)
  if (set.actualDurationMinutes != null) parts.push(`${set.actualDurationMinutes} ${t('common.minutesShort')}`)
  if (set.actualDistanceKm != null) parts.push(`${set.actualDistanceKm} ${t('common.km')}`)
  if (set.actualRpe != null) parts.push(`RPE ${set.actualRpe}`)
  return parts.join(' · ') || '—'
}

async function load() {
  isLoading.value = true
  loadError.value = ''
  session.value = null
  try {
    const result = await getCoachedMemberWorkoutSession(studioId.value, memberMembershipId.value, sessionId.value)
    session.value = result.workoutSession
  } catch (error) {
    loadError.value = error.status === 404
      ? t('studios.coachResults.detailLoadError')
      : workoutErrorMessage(error)
  } finally {
    isLoading.value = false
  }
  if (session.value) await loadFeedback(studioId.value, sessionId.value)
}

async function handleFeedbackSubmit(body) {
  const result = await submitFeedback(studioId.value, sessionId.value, body)
  if (result.ok) {
    feedbackFormRef.value?.clear()
    toastSuccess(t('studios.coachResults.feedbackSentToast'))
  } else {
    toastError(feedbackSubmitError.value)
  }
}

function backToSessions() {
  router.push({ name: 'studio-coach-results', params: { studioId: studioId.value } })
}

watch([studioId, memberMembershipId, sessionId], () => {
  session.value = null
  resetFeedback()
  load()
}, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="activeStudio?.name" :title="t('studios.coachResults.detailTitle')">
        <template v-if="session" #badge>
          <Badge :tone="workoutSessionStatusTone(session.status)">
            {{ t(`studios.workoutSessions.sessionStatuses.${session.status}`) }}
          </Badge>
        </template>
        <template #actions>
          <button type="button" class="btn btn-secondary" @click="backToSessions">
            {{ t('studios.coachResults.backToSessions') }}
          </button>
        </template>
      </PageHeader>

      <p v-if="loadError" class="message message-error" role="alert">{{ loadError }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 3rem;"></div>
        <div class="skeleton skeleton-text" style="height: 6rem;"></div>
      </div>

      <template v-else-if="session">
        <p class="studio-help" role="status">{{ t('studios.coachResults.readOnlyHint') }}</p>

        <article class="card session-meta">
          <dl class="studio-details">
            <div>
              <dt>{{ t('studios.coachResults.memberLabel') }}</dt>
              <dd>{{ session.member?.displayName }}</dd>
            </div>
            <div>
              <dt>{{ t('studios.programBuilder.versionLabel', { number: session.programVersion.versionNumber }) }}</dt>
              <dd>{{ session.program.name }} — {{ session.programDay.name }}</dd>
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
          </dl>
          <div v-if="session.memberNote" class="form-group">
            <span class="form-label">{{ t('studios.workoutSessions.sessionNote') }}</span>
            <p class="studio-muted">{{ session.memberNote }}</p>
          </div>
        </article>

        <div class="coach-exercise-list">
          <section v-for="exercise in session.exercises" :key="exercise.id" class="card coach-exercise-panel">
            <header class="coach-exercise-head">
              <div>
                <span class="exercise-position">{{ t('studios.workoutSessions.exerciseNumber', { number: exercise.position }) }}</span>
                <h3>{{ exercise.exerciseNameSnapshot }}</h3>
              </div>
              <Badge :tone="workoutItemStatusTone(exercise.status)">
                {{ t(`studios.workoutSessions.itemStatuses.${exercise.status}`) }}
              </Badge>
            </header>
            <p v-if="exercise.instructionsSnapshot" class="studio-muted">{{ exercise.instructionsSnapshot }}</p>
            <p class="studio-meta">{{ t('studios.workoutSessions.targets') }}: {{ targetSummary(exercise) }}</p>
            <p v-if="exercise.memberNote" class="studio-muted">{{ exercise.memberNote }}</p>

            <div class="coach-set-list">
              <div v-for="set in exercise.sets" :key="set.id" class="coach-set-row">
                <div class="coach-set-row-head">
                  <span class="set-row-position">{{ t('studios.workoutSessions.setNumber', { number: set.position }) }}</span>
                  <Badge :tone="workoutItemStatusTone(set.status)">{{ t(`studios.workoutSessions.itemStatuses.${set.status}`) }}</Badge>
                </div>
                <dl class="coach-plan-vs-actual">
                  <div>
                    <dt>{{ t('studios.coachResults.targetColumn') }}</dt>
                    <dd>{{ targetSummary(exercise) || '—' }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('studios.coachResults.actualColumn') }}</dt>
                    <dd>{{ actualSummary(set) }}</dd>
                  </div>
                </dl>
                <p v-if="set.memberNote" class="studio-muted">{{ set.memberNote }}</p>
              </div>
            </div>
          </section>
        </div>

        <article class="card feedback-section">
          <h2 class="studio-section-title">{{ t('studios.coachResults.feedbackSectionTitle') }}</h2>

          <div v-if="isFeedbackLoading" class="skeleton skeleton-text" style="height: 2.5rem;" aria-busy="true"></div>
          <p v-else-if="feedbackLoadError" class="message message-error" role="alert">{{ feedbackLoadError }}</p>
          <FeedbackList
            v-else
            :entries="feedbackEntries"
            :empty-title="t('studios.coachResults.feedbackEmpty')"
          />

          <p v-if="session.status === 'in_progress'" class="message message-info" role="status">
            {{ t('studios.coachResults.feedbackNotYetAvailable') }}
          </p>
          <FeedbackForm
            v-else
            ref="feedbackFormRef"
            :is-submitting="isFeedbackSubmitting"
            :error-message="feedbackSubmitError"
            @submit="handleFeedbackSubmit"
          />
        </article>
      </template>
    </div>
  </section>
</template>

<style scoped>
.session-meta {
  display: grid;
  gap: 0.85rem;
  margin-bottom: 1rem;
}

.coach-exercise-list {
  display: grid;
  gap: 1rem;
  margin-bottom: 1rem;
}

.coach-exercise-panel {
  display: grid;
  gap: 0.6rem;
}

.coach-exercise-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.coach-exercise-head h3 {
  margin: 0.15rem 0 0;
  overflow-wrap: anywhere;
}

.exercise-position {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.coach-set-list {
  display: grid;
  gap: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}

.coach-set-row {
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
  display: grid;
  gap: 0.5rem;
}

.coach-set-row-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.set-row-position {
  font-weight: 750;
}

.coach-plan-vs-actual {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.6rem;
}

.coach-plan-vs-actual dt {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.coach-plan-vs-actual dd {
  overflow-wrap: anywhere;
}

.feedback-section {
  display: grid;
  gap: 1rem;
}

.studio-section-title {
  font-size: var(--text-lg);
}
</style>
