<script setup>
import { computed } from 'vue'
import { t } from '../../utils/i18n'
import { SAVE_STATUS } from '../../utils/workoutSessionState'

const props = defineProps({
  status: { type: String, default: SAVE_STATUS.IDLE },
})

const STATUS_KEYS = {
  [SAVE_STATUS.IDLE]: '',
  [SAVE_STATUS.DIRTY]: 'unsaved',
  [SAVE_STATUS.SAVING]: 'saving',
  [SAVE_STATUS.SAVED]: 'saved',
  [SAVE_STATUS.ERROR]: 'error',
  [SAVE_STATUS.CONFLICT]: 'conflict',
}

const label = computed(() => {
  const key = STATUS_KEYS[props.status]
  return key ? t(`studios.workoutSessions.save.${key}`) : ''
})
</script>

<template>
  <span
    v-if="label"
    class="save-status"
    :class="`save-status-${status}`"
    role="status"
    aria-live="polite"
  >
    <span v-if="status === 'saving'" class="spinner spinner-sm" aria-hidden="true"></span>
    {{ label }}
  </span>
</template>

<style scoped>
.save-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--text-muted);
}

.save-status-dirty {
  color: var(--text-soft);
}

.save-status-saved {
  color: var(--accent-hover);
}

.save-status-error,
.save-status-conflict {
  color: var(--danger);
}

.spinner-sm {
  width: 0.75rem;
  height: 0.75rem;
}
</style>
