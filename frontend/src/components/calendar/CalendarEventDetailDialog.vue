<script setup>
import { useId, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Badge from '../ui/Badge.vue'
import { formatDate, t } from '../../utils/i18n'
import {
  calendarDisplayStatusLabel,
  calendarDisplayStatusTone,
  calendarSourceLabel,
} from '../../utils/calendarStatus'

const props = defineProps({
  entry: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits([
  'close',
  'request-start',
  'request-complete',
  'request-skip',
  'request-cancel',
  'request-view-workout',
  'submit-edit',
  'submit-reschedule',
])

const titleId = `calendar-detail-title-${useId()}`

// Neither the backend nor CALENDAR_ENTRY_ACTIONS has a distinct "EDIT"
// action code (see backend/domain/trainingCalendarDomain.js) - a personal
// entry's title can be edited under exactly the same server-side condition
// (source_type='personal' AND status='PLANNED') that already produces
// RESCHEDULE, so that server-derived flag is reused rather than the UI
// inventing its own date/status gate (Section 11: no local authorization
// logic replaces the backend's).
function canEditOrReschedule(entry) {
  return Boolean(entry?.sourceType === 'personal' && entry.availableActions?.includes('RESCHEDULE'))
}

const editMode = ref(false)
const rescheduleMode = ref(false)
const editTitleDraft = ref('')
const rescheduleDateDraft = ref('')

watch(
  () => props.entry,
  (entry) => {
    editMode.value = false
    rescheduleMode.value = false
    editTitleDraft.value = entry?.title || ''
    rescheduleDateDraft.value = entry?.scheduledDate || ''
  },
  { immediate: true }
)

function startEdit() {
  editTitleDraft.value = props.entry?.title || ''
  editMode.value = true
}

function startReschedule() {
  rescheduleDateDraft.value = props.entry?.scheduledDate || ''
  rescheduleMode.value = true
}

function submitEdit() {
  emit('submit-edit', editTitleDraft.value.trim())
}

function submitReschedule() {
  emit('submit-reschedule', rescheduleDateDraft.value)
}

const ACTION_ORDER = ['START', 'COMPLETE', 'VIEW_WORKOUT', 'RESCHEDULE', 'SKIP', 'CANCEL']

function actionHandler(action) {
  return {
    START: () => emit('request-start'),
    COMPLETE: () => emit('request-complete'),
    SKIP: () => emit('request-skip'),
    CANCEL: () => emit('request-cancel'),
    VIEW_WORKOUT: () => emit('request-view-workout'),
    RESCHEDULE: startReschedule,
  }[action]
}

function actionTone(action) {
  return action === 'CANCEL' || action === 'SKIP' ? 'btn-danger' : 'btn-primary'
}

function sortedActions(entry) {
  const available = entry?.availableActions || []
  return ACTION_ORDER.filter((action) => available.includes(action))
}
</script>

<template>
  <Modal :open="Boolean(entry)" :title-id="titleId" size="lg" @close="emit('close')">
    <template v-if="entry">
      <h2 :id="titleId" class="detail-title">{{ entry.title }}</h2>

      <dl class="detail-fields">
        <div class="detail-field">
          <dt>{{ t('calendar.detail.dateLabel') }}</dt>
          <dd>{{ formatDate(entry.scheduledDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) }}</dd>
        </div>
        <div class="detail-field">
          <dt>{{ t('calendar.detail.statusLabel') }}</dt>
          <dd>
            <Badge :tone="calendarDisplayStatusTone(entry.displayStatus)">
              {{ calendarDisplayStatusLabel(entry.displayStatus) }}
            </Badge>
          </dd>
        </div>
        <div class="detail-field">
          <dt>{{ t('calendar.detail.sourceLabel') }}</dt>
          <dd>{{ calendarSourceLabel(entry.sourceType) }}</dd>
        </div>
        <div v-if="entry.studio" class="detail-field">
          <dt>{{ t('calendar.detail.studioLabel') }}</dt>
          <dd>{{ entry.studio.name }}</dd>
        </div>
        <div v-if="entry.program" class="detail-field">
          <dt>{{ t('calendar.detail.programLabel') }}</dt>
          <dd>{{ entry.program.name }}</dd>
        </div>
        <div v-if="entry.programDay" class="detail-field">
          <dt>{{ t('calendar.detail.programDayLabel') }}</dt>
          <dd>{{ entry.programDay.name }}</dd>
        </div>
      </dl>

      <form v-if="editMode" class="inline-form" @submit.prevent="submitEdit">
        <div class="form-group">
          <label class="form-label" :for="`${titleId}-edit`">{{ t('calendar.create.titleFieldLabel') }}</label>
          <input :id="`${titleId}-edit`" v-model="editTitleDraft" class="input" type="text" maxlength="160" required />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" :disabled="busy" @click="editMode = false">
            {{ t('common.cancel') }}
          </button>
          <button type="submit" class="btn btn-primary" :disabled="busy">
            {{ t('common.save') }}
          </button>
        </div>
      </form>

      <form v-else-if="rescheduleMode" class="inline-form" @submit.prevent="submitReschedule">
        <div class="form-group">
          <label class="form-label" :for="`${titleId}-reschedule`">{{ t('calendar.reschedule.dateFieldLabel') }}</label>
          <input :id="`${titleId}-reschedule`" v-model="rescheduleDateDraft" class="input" type="date" required />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" :disabled="busy" @click="rescheduleMode = false">
            {{ t('common.cancel') }}
          </button>
          <button type="submit" class="btn btn-primary" :disabled="busy">
            {{ t('calendar.reschedule.submit') }}
          </button>
        </div>
      </form>

      <div v-else class="detail-actions">
        <p v-if="sortedActions(entry).length === 0 && !canEditOrReschedule(entry)" class="detail-no-actions">
          {{ t('calendar.detail.noActions') }}
        </p>
        <button
          v-if="canEditOrReschedule(entry)"
          type="button"
          class="btn btn-secondary"
          :disabled="busy"
          @click="startEdit"
        >
          {{ t('calendar.actions.edit') }}
        </button>
        <button
          v-for="action in sortedActions(entry)"
          :key="action"
          type="button"
          class="btn"
          :class="actionTone(action)"
          :disabled="busy"
          @click="actionHandler(action)()"
        >
          <span v-if="busy" class="spinner" aria-hidden="true"></span>
          {{ t(`calendar.actions.${action}`) }}
        </button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.detail-title {
  font-size: var(--text-lg);
  overflow-wrap: anywhere;
}

.detail-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem 1.25rem;
}

.detail-field dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.detail-field dd {
  margin-top: 0.15rem;
  overflow-wrap: anywhere;
  font-weight: 650;
}

.detail-actions,
.inline-form .form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.detail-no-actions {
  color: var(--text-soft);
  font-size: var(--text-sm);
}

.inline-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
