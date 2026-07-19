<script setup>
import { reactive, watch } from 'vue'
import Badge from '../ui/Badge.vue'
import SaveStatusIndicator from './SaveStatusIndicator.vue'
import { t } from '../../utils/i18n'
import { workoutItemStatusTone } from '../../utils/studioBadges'
import { SAVE_STATUS } from '../../utils/workoutSessionState'
import {
  hasAnyResultMetric,
  parseActualDistanceKm,
  parseActualDurationMinutes,
  parseActualReps,
  parseActualRpe,
  parseActualWeight,
  parseMemberNote,
} from '../../utils/workoutSessionLimits'

const props = defineProps({
  set: { type: Object, required: true },
  visibleFields: { type: Object, required: true },
  mutable: { type: Boolean, required: true },
  highlighted: { type: Boolean, default: false },
})
const emit = defineEmits(['update', 'retry', 'reload'])

const draft = reactive({
  actualReps: props.set.actualReps,
  actualWeight: props.set.actualWeight,
  actualDurationMinutes: props.set.actualDurationMinutes,
  actualDistanceKm: props.set.actualDistanceKm,
  actualRpe: props.set.actualRpe,
  memberNote: props.set.memberNote || '',
})
const fieldErrors = reactive({})

watch(() => [
  props.set.actualReps, props.set.actualWeight, props.set.actualDurationMinutes,
  props.set.actualDistanceKm, props.set.actualRpe, props.set.memberNote,
], () => {
  draft.actualReps = props.set.actualReps
  draft.actualWeight = props.set.actualWeight
  draft.actualDurationMinutes = props.set.actualDurationMinutes
  draft.actualDistanceKm = props.set.actualDistanceKm
  draft.actualRpe = props.set.actualRpe
  draft.memberNote = props.set.memberNote || ''
})

const FIELD_PARSERS = {
  actualReps: parseActualReps,
  actualWeight: parseActualWeight,
  actualDurationMinutes: parseActualDurationMinutes,
  actualDistanceKm: parseActualDistanceKm,
}

function commitNumberField(field) {
  const { value, error } = FIELD_PARSERS[field](draft[field])
  if (error) {
    fieldErrors[field] = t(`studios.workoutSessions.validation.${error}`)
    return
  }
  fieldErrors[field] = ''
  if (value === props.set[field]) return
  emit('update', { [field]: value })
}

function commitRpe() {
  const { value, error } = parseActualRpe(draft.actualRpe)
  if (error) {
    fieldErrors.actualRpe = t('studios.workoutSessions.validation.rpeRange')
    return
  }
  fieldErrors.actualRpe = ''
  if (value === props.set.actualRpe) return
  emit('update', { actualRpe: value })
}

function commitNote() {
  const { value, error } = parseMemberNote(draft.memberNote)
  if (error) {
    fieldErrors.memberNote = t('studios.workoutSessions.validation.noteLength')
    return
  }
  fieldErrors.memberNote = ''
  if (value === props.set.memberNote) return
  emit('update', { memberNote: value })
}

function setStatus(status) {
  if (status === 'completed' && !hasAnyResultMetric(draft)) {
    fieldErrors.status = t('studios.workoutSessions.validation.resultRequired')
    return
  }
  fieldErrors.status = ''
  emit('update', { status })
}

function onEnter(event, commit) {
  commit()
  event.target.blur()
}
</script>

<template>
  <div
    :id="`set-${set.id}`"
    class="set-row"
    :class="{ 'set-row-readonly': !mutable, 'set-row-highlighted': highlighted }"
    tabindex="-1"
  >
    <div class="set-row-head">
      <span class="set-row-position">{{ t('studios.workoutSessions.setNumber', { number: set.position }) }}</span>
      <Badge :tone="workoutItemStatusTone(set.status)">{{ t(`studios.workoutSessions.itemStatuses.${set.status}`) }}</Badge>
      <SaveStatusIndicator :status="set._save.status" />
    </div>

    <fieldset class="set-row-fields" :disabled="!mutable">
      <legend class="visually-hidden">{{ t('studios.workoutSessions.setFieldsLegend', { number: set.position }) }}</legend>

      <div v-if="visibleFields.reps" class="form-group set-field">
        <label class="form-label" :for="`set-${set.id}-reps`">{{ t('common.reps') }}</label>
        <input
          :id="`set-${set.id}-reps`"
          v-model.number="draft.actualReps"
          class="input"
          type="number"
          min="0"
          :max="100"
          step="1"
          inputmode="numeric"
          @blur="commitNumberField('actualReps')"
          @keydown.enter.prevent="onEnter($event, () => commitNumberField('actualReps'))"
        />
        <p v-if="fieldErrors.actualReps" class="field-error">{{ fieldErrors.actualReps }}</p>
      </div>

      <div v-if="visibleFields.weight" class="form-group set-field">
        <label class="form-label" :for="`set-${set.id}-weight`">{{ t('common.weight') }} ({{ t('common.kg') }})</label>
        <input
          :id="`set-${set.id}-weight`"
          v-model.number="draft.actualWeight"
          class="input"
          type="number"
          min="0"
          max="999.99"
          step="0.5"
          inputmode="decimal"
          @blur="commitNumberField('actualWeight')"
          @keydown.enter.prevent="onEnter($event, () => commitNumberField('actualWeight'))"
        />
        <p v-if="fieldErrors.actualWeight" class="field-error">{{ fieldErrors.actualWeight }}</p>
      </div>

      <div v-if="visibleFields.duration" class="form-group set-field">
        <label class="form-label" :for="`set-${set.id}-duration`">{{ t('common.duration') }} ({{ t('common.minutesShort') }})</label>
        <input
          :id="`set-${set.id}-duration`"
          v-model.number="draft.actualDurationMinutes"
          class="input"
          type="number"
          min="0"
          max="600"
          step="1"
          inputmode="numeric"
          @blur="commitNumberField('actualDurationMinutes')"
          @keydown.enter.prevent="onEnter($event, () => commitNumberField('actualDurationMinutes'))"
        />
        <p v-if="fieldErrors.actualDurationMinutes" class="field-error">{{ fieldErrors.actualDurationMinutes }}</p>
      </div>

      <div v-if="visibleFields.distance" class="form-group set-field">
        <label class="form-label" :for="`set-${set.id}-distance`">{{ t('common.distance') }} ({{ t('common.km') }})</label>
        <input
          :id="`set-${set.id}-distance`"
          v-model.number="draft.actualDistanceKm"
          class="input"
          type="number"
          min="0"
          max="999.99"
          step="0.1"
          inputmode="decimal"
          @blur="commitNumberField('actualDistanceKm')"
          @keydown.enter.prevent="onEnter($event, () => commitNumberField('actualDistanceKm'))"
        />
        <p v-if="fieldErrors.actualDistanceKm" class="field-error">{{ fieldErrors.actualDistanceKm }}</p>
      </div>

      <div v-if="visibleFields.rpe" class="form-group set-field">
        <label class="form-label" :for="`set-${set.id}-rpe`">RPE</label>
        <input
          :id="`set-${set.id}-rpe`"
          v-model.number="draft.actualRpe"
          class="input"
          type="number"
          min="0"
          max="10"
          step="0.5"
          inputmode="decimal"
          @blur="commitRpe"
          @keydown.enter.prevent="onEnter($event, commitRpe)"
        />
        <p v-if="fieldErrors.actualRpe" class="field-error">{{ fieldErrors.actualRpe }}</p>
      </div>

      <div class="form-group set-field set-field-note">
        <label class="form-label" :for="`set-${set.id}-note`">{{ t('common.notes') }} ({{ t('common.optional') }})</label>
        <input
          :id="`set-${set.id}-note`"
          v-model="draft.memberNote"
          class="input"
          type="text"
          maxlength="500"
          @blur="commitNote"
          @keydown.enter.prevent="onEnter($event, commitNote)"
        />
        <p v-if="fieldErrors.memberNote" class="field-error">{{ fieldErrors.memberNote }}</p>
      </div>
    </fieldset>

    <div v-if="mutable" class="set-row-status-actions">
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="set.status === 'completed'"
        @click="setStatus('completed')"
      >
        {{ t('studios.workoutSessions.markCompleted') }}
      </button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="set.status === 'skipped'"
        @click="setStatus('skipped')"
      >
        {{ t('studios.workoutSessions.markSkipped') }}
      </button>
      <button
        v-if="set.status !== 'pending'"
        type="button"
        class="btn btn-secondary btn-sm"
        @click="setStatus('pending')"
      >
        {{ t('studios.workoutSessions.markPending') }}
      </button>
    </div>
    <p v-if="fieldErrors.status" class="field-error" role="alert">{{ fieldErrors.status }}</p>

    <p v-if="set._save.status === 'error'" class="message message-error" role="alert">
      {{ set._save.error }}
      <button type="button" class="btn btn-secondary btn-sm" @click="emit('retry')">{{ t('common.retry') }}</button>
    </p>
    <p v-if="set._save.status === 'conflict'" class="message message-warning" role="alert">
      {{ t('studios.workoutSessions.conflictHint') }}
      <button type="button" class="btn btn-secondary btn-sm" @click="emit('reload')">{{ t('studios.workoutSessions.reloadAction') }}</button>
    </p>
  </div>
</template>

<style scoped>
.set-row {
  padding: 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  display: grid;
  gap: 0.6rem;
  scroll-margin-top: 5rem;
}

.set-row:focus {
  outline: none;
}

.set-row-readonly {
  background: var(--surface-soft);
}

.set-row-highlighted {
  border: 2px solid var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.set-row-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.set-row-position {
  font-weight: 750;
}

.set-row-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 0.6rem;
  border: none;
  padding: 0;
  margin: 0;
}

.set-field-note {
  grid-column: 1 / -1;
}

.set-row-fields:disabled {
  opacity: 0.75;
}

.set-row-status-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.field-error {
  color: var(--danger);
  font-size: var(--text-xs);
  margin: 0;
}

@media (max-width: 480px) {
  .set-row-fields {
    grid-template-columns: 1fr 1fr;
  }

  .set-row-status-actions .btn {
    flex: 1;
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
