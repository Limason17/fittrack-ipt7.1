<script setup>
import { computed, ref, useId, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import { t } from '../../utils/i18n'
import { isDateOnly, isFutureDateOnly, isPastDateOnly, isTodayDateOnly } from '../../utils/calendarDate'

const props = defineProps({
  open: { type: Boolean, required: true },
  defaultDate: { type: String, required: true },
  today: { type: String, required: true },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'submit'])

const titleId = `calendar-create-title-${useId()}`

const title = ref('')
const scheduledDate = ref(props.defaultDate)
const notes = ref('')
const planAsUpcoming = ref(false)
const fieldErrors = ref({})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    title.value = ''
    scheduledDate.value = props.defaultDate
    notes.value = ''
    planAsUpcoming.value = false
    fieldErrors.value = {}
  }
)

// The server (resolvePersonalCreationStatus, see
// docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md) is the sole authority on the
// resulting status - these hints only explain the rule in advance, they
// never set a status field the UI could send instead.
const dateBucket = computed(() => {
  if (!isDateOnly(scheduledDate.value)) return null
  if (isFutureDateOnly(scheduledDate.value, props.today)) return 'future'
  if (isTodayDateOnly(scheduledDate.value, props.today)) return 'today'
  return 'past'
})

function validate() {
  const errors = {}
  const trimmedTitle = title.value.trim()
  if (!trimmedTitle) {
    errors.title = t('calendar.create.titleRequired')
  } else if (trimmedTitle.length > 160) {
    errors.title = t('calendar.create.titleTooLong')
  }
  if (!isDateOnly(scheduledDate.value)) {
    errors.date = t('calendar.create.dateRequired')
  }
  if (notes.value.trim().length > 255) {
    errors.notes = t('calendar.create.notesTooLong')
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

function submit() {
  if (!validate()) return
  emit('submit', {
    scheduledDate: scheduledDate.value,
    title: title.value.trim(),
    notes: notes.value.trim() ? notes.value.trim() : null,
    planAsUpcoming: dateBucket.value === 'today' ? planAsUpcoming.value : false,
  })
}
</script>

<template>
  <Modal :open="open" :title-id="titleId" @close="emit('close')">
    <h2 :id="titleId" class="form-title-row">{{ t('calendar.create.title') }}</h2>

    <form class="calendar-create-form" novalidate @submit.prevent="submit">
      <div class="form-group">
        <label class="form-label" :for="`${titleId}-field`">{{ t('calendar.create.titleFieldLabel') }}</label>
        <input
          :id="`${titleId}-field`"
          v-model="title"
          class="input"
          type="text"
          maxlength="160"
          data-autofocus
          :placeholder="t('calendar.create.titlePlaceholder')"
          :aria-invalid="Boolean(fieldErrors.title)"
          :aria-describedby="fieldErrors.title ? `${titleId}-title-error` : null"
        />
        <p v-if="fieldErrors.title" :id="`${titleId}-title-error`" class="form-hint form-hint-error">
          {{ fieldErrors.title }}
        </p>
      </div>

      <div class="form-group">
        <label class="form-label" :for="`${titleId}-date`">{{ t('calendar.create.dateFieldLabel') }}</label>
        <input
          :id="`${titleId}-date`"
          v-model="scheduledDate"
          class="input"
          type="date"
          :aria-invalid="Boolean(fieldErrors.date)"
          :aria-describedby="fieldErrors.date ? `${titleId}-date-error` : null"
        />
        <p v-if="fieldErrors.date" :id="`${titleId}-date-error`" class="form-hint form-hint-error">
          {{ fieldErrors.date }}
        </p>
        <p v-else-if="dateBucket === 'future'" class="form-hint">{{ t('calendar.create.futureHint') }}</p>
        <p v-else-if="dateBucket === 'today'" class="form-hint">{{ t('calendar.create.todayHint') }}</p>
        <p v-else-if="dateBucket === 'past'" class="form-hint">{{ t('calendar.create.pastHint') }}</p>
      </div>

      <div v-if="dateBucket === 'today'" class="form-group form-group-checkbox">
        <label class="checkbox-label">
          <input v-model="planAsUpcoming" type="checkbox" />
          {{ t('calendar.create.planAsUpcomingLabel') }}
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" :for="`${titleId}-notes`">{{ t('calendar.create.notesFieldLabel') }}</label>
        <textarea
          :id="`${titleId}-notes`"
          v-model="notes"
          class="textarea"
          rows="3"
          maxlength="255"
          :aria-invalid="Boolean(fieldErrors.notes)"
          :aria-describedby="fieldErrors.notes ? `${titleId}-notes-error` : null"
        ></textarea>
        <p v-if="fieldErrors.notes" :id="`${titleId}-notes-error`" class="form-hint form-hint-error">
          {{ fieldErrors.notes }}
        </p>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" :disabled="busy" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn btn-primary" :disabled="busy">
          <span v-if="busy" class="spinner" aria-hidden="true"></span>
          {{ t('calendar.create.submit') }}
        </button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.calendar-create-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-hint-error {
  color: var(--danger);
}

.form-group-checkbox {
  flex-direction: row;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-sm);
  font-weight: 650;
}
</style>
