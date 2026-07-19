<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { formatDate, t } from '../utils/i18n'
import { assignmentStatusTone, programVersionStatusTone } from '../utils/studioBadges'
import { getOwnProgramAssignmentDetail, listOwnProgramAssignments } from '../utils/studioTrainingApi'
import { activeStudio } from '../utils/studioContext'

const route = useRoute()
const studioId = computed(() => String(route.params.studioId || ''))

const assignments = ref([])
const isLoading = ref(true)
const errorMessage = ref('')

const details = reactive({})
const expandedId = ref(null)
const loadingDetailId = ref(null)
const detailErrors = reactive({})

let generation = 0

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  assignments.value = []
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await listOwnProgramAssignments(currentStudioId, { page: 1, limit: 50 })
    if (current !== generation || currentStudioId !== studioId.value) return
    assignments.value = result.programAssignments || []
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
                  <h4>{{ day.name }}</h4>
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
              <p class="studio-help">{{ t('studios.myTrainingPlan.notStartedHint') }}</p>
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

.program-exercise-row {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
</style>
