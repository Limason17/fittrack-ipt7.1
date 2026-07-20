<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { formatDate, t } from '../utils/i18n'
import { assignmentStatusTone, programVersionStatusTone } from '../utils/studioBadges'
import { getOwnProgramAssignmentDetail, listOwnProgramAssignments } from '../utils/studioTrainingApi'
import { activeStudio } from '../utils/studioContext'
import { listOwnWorkoutSessions } from '../utils/workoutSessionApi'
import { workoutErrorMessage } from '../utils/workoutSessionErrors'
import { startWorkoutSession } from '../utils/workoutSessionState'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))

const assignments = ref([])
const isLoading = ref(true)
const errorMessage = ref('')

const details = reactive({})
const expandedId = ref(null)
const loadingDetailId = ref(null)
const detailErrors = reactive({})

// Maps `${assignmentId}:${programDayId}` -> the member's own in_progress
// sessions for exactly that assignment+day, loaded via the server-side
// status/assignmentId/programDayId filter (never a scan of a bounded/paginated
// history page), so a day's resume state is deterministic regardless of how
// many other sessions exist or which history page they would fall on.
const runningSessionsByKey = reactive(new Map())
const startingKeys = reactive(new Set())
const startErrors = reactive({})

let generation = 0

function dayKey(assignmentId, dayId) {
  return `${assignmentId}:${dayId}`
}

function dateOnly(value) {
  if (!value) return null
  return String(value).slice(0, 10)
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// Loads the exact set of in_progress sessions for each of an assignment's days
// in parallel, one targeted (status=in_progress, assignmentId, programDayId)
// request per day. Awaited before the detail skeleton is hidden, so a day card
// never briefly renders "Start" before a genuinely running session is known.
async function loadRunningSessionsForAssignment(assignmentId, days) {
  await Promise.all((days || []).map(async (day) => {
    const key = dayKey(assignmentId, day.id)
    try {
      const result = await listOwnWorkoutSessions(studioId.value, {
        status: 'in_progress', assignmentId, programDayId: day.id, limit: 5,
      })
      runningSessionsByKey.set(key, result.workoutSessions || [])
    } catch {
      runningSessionsByKey.set(key, [])
    }
  }))
}

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  assignments.value = []
  isLoading.value = true
  errorMessage.value = ''
  try {
    const assignmentResult = await listOwnProgramAssignments(currentStudioId, { page: 1, limit: 50 })
    if (current !== generation || currentStudioId !== studioId.value) return
    assignments.value = assignmentResult.programAssignments || []
  } catch (error) {
    if (current === generation) {
      errorMessage.value = error.status === 403 ? t('studios.permissionDenied') : t('studios.myTrainingPlan.loadError')
    }
  } finally {
    if (current === generation) isLoading.value = false
  }
}

async function toggleDetails(assignment) {
  if (expandedId.value === assignment.id) {
    expandedId.value = null
    return
  }
  expandedId.value = assignment.id
  if (details[assignment.id]) return
  loadingDetailId.value = assignment.id
  detailErrors[assignment.id] = ''
  try {
    const result = await getOwnProgramAssignmentDetail(studioId.value, assignment.id)
    details[assignment.id] = result.programAssignment
    await loadRunningSessionsForAssignment(assignment.id, result.programAssignment.days)
  } catch {
    detailErrors[assignment.id] = t('studios.myTrainingPlan.detailLoadError')
  } finally {
    loadingDetailId.value = null
  }
}

function exerciseSummary(exercise) {
  const parts = []
  if (exercise.targetSets) {
    parts.push(`${exercise.targetSets} × ${exercise.targetRepsMin ?? '–'}–${exercise.targetRepsMax ?? '–'} ${t('common.reps')}`)
  }
  if (exercise.targetWeight) parts.push(`${exercise.targetWeight} ${t('common.kg')}`)
  if (exercise.targetDurationMinutes) parts.push(`${exercise.targetDurationMinutes} ${t('common.minutesShort')}`)
  if (exercise.targetDistanceKm) parts.push(`${exercise.targetDistanceKm} ${t('common.km')}`)
  if (exercise.targetRpe) parts.push(`RPE ${exercise.targetRpe}`)
  return parts.join(' · ')
}

// UI-only guidance mirroring the backend's canStartWorkoutSession checks
// (assignment active, within its date window). The backend independently
// re-validates every condition on the actual start request and remains the
// only real authority — this only decides which action a day is offered.
function dayAvailability(assignment, day) {
  const key = dayKey(assignment.id, day.id)
  const running = runningSessionsByKey.get(key) || []
  if (running.length === 1) return { state: 'resume', sessionId: running[0].id }
  // Never silently pick one when more than one is running: surface it and let
  // the member resolve it deliberately via the history view instead of a
  // guessed "Resume" that could open the wrong session.
  if (running.length > 1) return { state: 'multiple', count: running.length }

  if (assignment.status !== 'active') {
    return { state: 'unavailable', reason: t('studios.myTrainingPlan.dayUnavailableAssignment') }
  }
  const today = todayIso()
  const startsOn = dateOnly(assignment.startsOn)
  const endsOn = dateOnly(assignment.endsOn)
  if (startsOn && today < startsOn) {
    return { state: 'unavailable', reason: t('studios.myTrainingPlan.dayUnavailableBeforeStart', { date: formatDate(assignment.startsOn) }) }
  }
  if (endsOn && today > endsOn) {
    return { state: 'unavailable', reason: t('studios.myTrainingPlan.dayUnavailableAfterEnd', { date: formatDate(assignment.endsOn) }) }
  }
  return { state: 'start' }
}

function goToSession(sessionId) {
  router.push({ name: 'studio-workout-session-detail', params: { studioId: studioId.value, sessionId } })
}

async function startDay(assignment, day) {
  const key = dayKey(assignment.id, day.id)
  if (startingKeys.has(key)) return
  startingKeys.add(key)
  startErrors[key] = ''
  const { session, error } = await startWorkoutSession(studioId.value, assignment.id, day.id)
  startingKeys.delete(key)
  if (session) {
    goToSession(session.id)
    return
  }
  startErrors[key] = workoutErrorMessage(error)
}

watch(studioId, load, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="activeStudio?.name" :title="t('studios.myTrainingPlan.title')" :subtitle="t('studios.myTrainingPlan.subtitle')" />

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 4rem;"></div>
      </div>

      <template v-else>
        <EmptyState v-if="!assignments.length" :title="t('studios.myTrainingPlan.empty')" :description="t('studios.myTrainingPlan.emptyHint')" />

        <article v-for="assignment in assignments" :key="assignment.id" class="card studio-detail-card">
          <div class="studio-page-header">
            <h2>{{ assignment.program.name }}</h2>
            <Badge :tone="assignmentStatusTone(assignment.status)">{{ t(`studios.trainingStatuses.${assignment.status}`) }}</Badge>
          </div>
          <p v-if="assignment.program.description" class="studio-muted">{{ assignment.program.description }}</p>

          <dl class="studio-details">
            <div>
              <dt>{{ t('studios.assignments.columnVersion') }}</dt>
              <dd>
                {{ t('studios.programBuilder.versionLabel', { number: assignment.programVersion.versionNumber }) }}
                <Badge :tone="programVersionStatusTone(assignment.programVersion.status)">
                  {{ t(`studios.trainingStatuses.${assignment.programVersion.status}`) }}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>{{ t('studios.assignments.columnStarts') }}</dt>
              <dd>{{ assignment.startsOn ? formatDate(assignment.startsOn) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('studios.assignments.columnEnds') }}</dt>
              <dd>{{ assignment.endsOn ? formatDate(assignment.endsOn) : '—' }}</dd>
            </div>
          </dl>

          <button class="btn btn-secondary btn-sm" type="button" @click="toggleDetails(assignment)">
            {{ expandedId === assignment.id ? t('studios.myTrainingPlan.hideDetails') : t('studios.myTrainingPlan.viewDetails') }}
          </button>

          <div v-if="expandedId === assignment.id" class="training-plan-detail">
            <div v-if="loadingDetailId === assignment.id" class="skeleton skeleton-text" style="height: 3rem;" aria-busy="true"></div>
            <p v-else-if="detailErrors[assignment.id]" class="message message-error" role="alert">{{ detailErrors[assignment.id] }}</p>
            <template v-else-if="details[assignment.id]">
              <h3 class="studio-section-title">{{ t('studios.myTrainingPlan.daysTitle') }}</h3>
              <EmptyState v-if="!details[assignment.id].days.length" :title="t('studios.programBuilder.emptyDays')" />
              <ul v-else class="program-day-list">
                <li v-for="day in details[assignment.id].days" :key="day.id" class="program-day-card">
                  <div class="program-day-card-head">
                    <h4>{{ day.name }}</h4>
                    <template v-if="dayAvailability(assignment, day).state === 'resume'">
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        @click="goToSession(dayAvailability(assignment, day).sessionId)"
                      >
                        {{ t('studios.myTrainingPlan.resumeAction') }}
                      </button>
                    </template>
                    <template v-else-if="dayAvailability(assignment, day).state === 'start'">
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        :disabled="startingKeys.has(dayKey(assignment.id, day.id))"
                        @click="startDay(assignment, day)"
                      >
                        <span v-if="startingKeys.has(dayKey(assignment.id, day.id))" class="spinner" aria-hidden="true"></span>
                        {{ t('studios.myTrainingPlan.startAction') }}
                      </button>
                    </template>
                    <template v-else-if="dayAvailability(assignment, day).state === 'multiple'">
                      <RouterLink
                        class="btn btn-secondary btn-sm"
                        :to="{ name: 'studio-workout-sessions', params: { studioId } }"
                      >
                        {{ t('studios.myTrainingPlan.viewRunningSessions') }}
                      </RouterLink>
                    </template>
                  </div>
                  <p v-if="dayAvailability(assignment, day).state === 'unavailable'" class="studio-help">
                    {{ dayAvailability(assignment, day).reason }}
                  </p>
                  <p v-if="dayAvailability(assignment, day).state === 'multiple'" class="message message-warning">
                    {{ t('studios.myTrainingPlan.multipleRunningSessions', { count: dayAvailability(assignment, day).count }) }}
                  </p>
                  <p v-if="startErrors[dayKey(assignment.id, day.id)]" class="message message-error" role="alert">
                    {{ startErrors[dayKey(assignment.id, day.id)] }}
                  </p>
                  <p class="studio-muted">{{ day.instructions || t('studios.myTrainingPlan.noInstructions') }}</p>
                  <ul v-if="day.exercises.length" class="program-exercise-list">
                    <li v-for="exercise in day.exercises" :key="exercise.id" class="program-exercise-row">
                      <strong>{{ exercise.exerciseNameSnapshot }}</strong>
                      <p v-if="exerciseSummary(exercise)" class="studio-meta">{{ exerciseSummary(exercise) }}</p>
                      <p v-if="exercise.instructions" class="studio-muted">{{ exercise.instructions }}</p>
                    </li>
                  </ul>
                </li>
              </ul>
            </template>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>

<style scoped>
.training-plan-detail {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.studio-section-title {
  font-size: var(--text-lg);
  margin-bottom: 0.6rem;
}

.program-day-list,
.program-exercise-list {
  list-style: none;
  display: grid;
  gap: 0.75rem;
  margin: 0.75rem 0;
}

.program-day-card {
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
}

.program-day-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.program-exercise-row {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
</style>
