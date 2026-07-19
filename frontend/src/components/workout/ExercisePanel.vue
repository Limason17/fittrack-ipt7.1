<script setup>
import { computed, reactive } from 'vue'
import Badge from '../ui/Badge.vue'
import SaveStatusIndicator from './SaveStatusIndicator.vue'
import SetRow from './SetRow.vue'
import { t } from '../../utils/i18n'
import { workoutItemStatusTone } from '../../utils/studioBadges'
import { parseMemberNote } from '../../utils/workoutSessionLimits'

const props = defineProps({
  exercise: { type: Object, required: true },
  mutable: { type: Boolean, required: true },
  addingSet: { type: Boolean, default: false },
  addSetError: { type: String, default: '' },
  highlighted: { type: Boolean, default: false },
  highlightedSetId: { type: String, default: null },
})
const emit = defineEmits([
  'update-exercise', 'retry-exercise', 'reload',
  'update-set', 'retry-set', 'reload-set', 'add-set',
])

const noteDraft = reactive({ value: props.exercise.memberNote || '' })
const noteError = reactive({ value: '' })

const visibleFields = computed(() => {
  const ex = props.exercise
  const hasAnySetValue = (key) => (ex.sets || []).some((set) => set[key] !== null && set[key] !== undefined)
  return {
    reps: ex.targetRepsMin != null || ex.targetRepsMax != null || hasAnySetValue('actualReps'),
    weight: ex.targetWeight != null || hasAnySetValue('actualWeight'),
    duration: ex.targetDurationMinutes != null || hasAnySetValue('actualDurationMinutes'),
    distance: ex.targetDistanceKm != null || hasAnySetValue('actualDistanceKm'),
    rpe: ex.targetRpe != null || hasAnySetValue('actualRpe'),
  }
})

const hasSkippedWithCompletedSets = computed(() => (
  props.exercise.status === 'skipped' && (props.exercise.sets || []).some((set) => set.status === 'completed')
))

const targetSummary = computed(() => {
  const ex = props.exercise
  const parts = []
  if (ex.targetSets) {
    const repsRange = ex.targetRepsMin != null || ex.targetRepsMax != null
      ? `${ex.targetRepsMin ?? '–'}–${ex.targetRepsMax ?? '–'} ${t('common.reps')}`
      : ''
    parts.push(repsRange ? `${ex.targetSets} × ${repsRange}` : `${ex.targetSets} ${t('common.sets')}`)
  }
  if (ex.targetWeight != null) parts.push(`${ex.targetWeight} ${t('common.kg')}`)
  if (ex.targetDurationMinutes != null) parts.push(`${ex.targetDurationMinutes} ${t('common.minutesShort')}`)
  if (ex.targetDistanceKm != null) parts.push(`${ex.targetDistanceKm} ${t('common.km')}`)
  if (ex.targetRpe != null) parts.push(`RPE ${ex.targetRpe}`)
  if (ex.restSeconds != null) parts.push(t('studios.workoutSessions.restSeconds', { seconds: ex.restSeconds }))
  return parts.join(' · ')
})

function commitNote() {
  const { value, error } = parseMemberNote(noteDraft.value)
  if (error) {
    noteError.value = t('studios.workoutSessions.validation.noteLength')
    return
  }
  noteError.value = ''
  if (value === props.exercise.memberNote) return
  emit('update-exercise', { memberNote: value })
}

function setExerciseStatus(status) {
  emit('update-exercise', { status })
}
</script>

<template>
  <section
    :id="`exercise-${exercise.id}`"
    class="exercise-panel card"
    :class="{ 'exercise-panel-highlighted': highlighted }"
    :aria-labelledby="`exercise-${exercise.id}-title`"
    tabindex="-1"
  >
    <header class="exercise-panel-head">
      <div>
        <span class="exercise-position">{{ t('studios.workoutSessions.exerciseNumber', { number: exercise.position }) }}</span>
        <h3 :id="`exercise-${exercise.id}-title`">{{ exercise.exerciseNameSnapshot }}</h3>
      </div>
      <div class="exercise-panel-status">
        <Badge :tone="workoutItemStatusTone(exercise.status)">
          {{ t(`studios.workoutSessions.itemStatuses.${exercise.status}`) }}
        </Badge>
        <SaveStatusIndicator :status="exercise._save.status" />
      </div>
    </header>

    <p v-if="exercise.instructionsSnapshot" class="studio-muted">{{ exercise.instructionsSnapshot }}</p>
    <p v-if="targetSummary" class="studio-meta">{{ t('studios.workoutSessions.targets') }}: {{ targetSummary }}</p>

    <div class="exercise-panel-note form-group">
      <label class="form-label" :for="`exercise-${exercise.id}-note`">{{ t('studios.workoutSessions.exerciseNote') }} ({{ t('common.optional') }})</label>
      <input
        :id="`exercise-${exercise.id}-note`"
        v-model="noteDraft.value"
        class="input"
        type="text"
        maxlength="500"
        :disabled="!mutable"
        @blur="commitNote"
        @keydown.enter.prevent="commitNote(); $event.target.blur()"
      />
      <p v-if="noteError.value" class="field-error">{{ noteError.value }}</p>
    </div>

    <div v-if="mutable" class="exercise-panel-actions">
      <button type="button" class="btn btn-secondary btn-sm" :disabled="exercise.status === 'completed'" @click="setExerciseStatus('completed')">
        {{ t('studios.workoutSessions.markExerciseCompleted') }}
      </button>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="exercise.status === 'skipped'" @click="setExerciseStatus('skipped')">
        {{ t('studios.workoutSessions.markExerciseSkipped') }}
      </button>
      <button v-if="exercise.status !== 'pending'" type="button" class="btn btn-secondary btn-sm" @click="setExerciseStatus('pending')">
        {{ t('studios.workoutSessions.markExercisePending') }}
      </button>
    </div>

    <p v-if="hasSkippedWithCompletedSets" class="message message-warning" role="status">
      {{ t('studios.workoutSessions.skippedWithCompletedSetsHint') }}
    </p>

    <p v-if="exercise._save.status === 'error'" class="message message-error" role="alert">
      {{ exercise._save.error }}
      <button type="button" class="btn btn-secondary btn-sm" @click="emit('retry-exercise')">{{ t('common.retry') }}</button>
    </p>
    <p v-if="exercise._save.status === 'conflict'" class="message message-warning" role="alert">
      {{ t('studios.workoutSessions.conflictHint') }}
      <button type="button" class="btn btn-secondary btn-sm" @click="emit('reload')">{{ t('studios.workoutSessions.reloadAction') }}</button>
    </p>

    <div class="exercise-panel-sets">
      <h4 class="exercise-sets-title">{{ t('studios.workoutSessions.setsTitle') }}</h4>
      <SetRow
        v-for="set in exercise.sets"
        :key="set.id"
        :set="set"
        :visible-fields="visibleFields"
        :mutable="mutable"
        :highlighted="set.id === highlightedSetId"
        @update="(patch) => emit('update-set', set.id, patch)"
        @retry="emit('retry-set', set.id)"
        @reload="emit('reload')"
      />
      <p v-if="addSetError" class="message message-error" role="alert">{{ addSetError }}</p>
      <button
        v-if="mutable"
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="addingSet"
        @click="emit('add-set')"
      >
        <span v-if="addingSet" class="spinner spinner-sm" aria-hidden="true"></span>
        {{ t('studios.workoutSessions.addSet') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.exercise-panel {
  display: grid;
  gap: 0.75rem;
  scroll-margin-top: 5rem;
}

.exercise-panel:focus {
  outline: none;
}

.exercise-panel-highlighted {
  border: 2px solid var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.exercise-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.exercise-position {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.exercise-panel-head h3 {
  margin: 0.15rem 0 0;
  overflow-wrap: anywhere;
}

.exercise-panel-status {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.exercise-panel-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.exercise-panel-sets {
  display: grid;
  gap: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}

.exercise-sets-title {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.field-error {
  color: var(--danger);
  font-size: var(--text-xs);
  margin: 0;
}
</style>
