<script setup>
import { computed } from 'vue'
import { formatDate, t } from '../../utils/i18n'
import {
  calendarDisplayStatusIcon,
  calendarDisplayStatusLabel,
  calendarDisplayStatusTone,
  calendarSourceLabel,
} from '../../utils/calendarStatus'

const props = defineProps({
  entry: { type: Object, required: true },
  variant: { type: String, default: 'agenda' }, // 'grid' | 'agenda'
})
defineEmits(['open'])

const tone = computed(() => calendarDisplayStatusTone(props.entry.displayStatus))
const icon = computed(() => calendarDisplayStatusIcon(props.entry.displayStatus))
const statusLabel = computed(() => calendarDisplayStatusLabel(props.entry.displayStatus))

const sourceLine = computed(() => {
  const entry = props.entry
  if (entry.sourceType === 'studio') {
    const parts = [entry.studio?.name, entry.program?.name].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : calendarSourceLabel('studio')
  }
  return calendarSourceLabel(entry.sourceType)
})

// Section 23: every event button needs a unique, unambiguous accessible name
// combining title, date and status - never relying on color alone.
const accessibleLabel = computed(() => {
  const dateLabel = formatDate(props.entry.scheduledDate, { day: '2-digit', month: 'long', year: 'numeric' })
  return t('calendar.eventAriaLabel', {
    title: props.entry.title,
    date: dateLabel,
    status: statusLabel.value,
  })
})
</script>

<template>
  <button
    type="button"
    class="calendar-event"
    :class="[`calendar-event-${tone}`, `calendar-event-${variant}`]"
    :aria-label="accessibleLabel"
    @click="$emit('open')"
  >
    <span class="calendar-event-icon" aria-hidden="true">{{ icon }}</span>
    <span class="calendar-event-body">
      <span class="calendar-event-title">{{ entry.title }}</span>
      <!-- Section 6: every event needs a visible, readable status text, not
           just color/icon or the aria-label - shown in both variants, the
           source line is agenda-only where there is room for it. -->
      <span class="calendar-event-meta">
        <span v-if="variant === 'agenda'" class="calendar-event-source">{{ sourceLine }}</span>
        <span class="calendar-event-status">{{ statusLabel }}</span>
      </span>
    </span>
  </button>
</template>

<style scoped>
.calendar-event {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.28rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  text-align: left;
  font-size: var(--text-xs);
  font-weight: 750;
  line-height: 1.25;
}

.calendar-event-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.15rem;
}

.calendar-event-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-event-agenda .calendar-event-title {
  white-space: normal;
  font-size: var(--text-sm);
}

.calendar-event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  color: var(--text-soft);
  font-size: var(--text-xs);
  font-weight: 650;
}

.calendar-event-icon {
  flex-shrink: 0;
  font-size: 0.8em;
}

.calendar-event-info { background: var(--info-soft); color: var(--info); border-color: var(--info-border); }
.calendar-event-warning { background: var(--warning-soft); color: var(--warning); border-color: var(--warning-border); }
.calendar-event-due-today { background: var(--calendar-due-today-soft); color: var(--calendar-due-today); border-color: var(--calendar-due-today-border); }
.calendar-event-in-progress { background: var(--calendar-in-progress-soft); color: var(--calendar-in-progress); border-color: var(--calendar-in-progress-border); }
.calendar-event-success { background: var(--success-soft); color: var(--accent-hover); border-color: var(--success-border); }
.calendar-event-danger { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-border); }
.calendar-event-neutral { background: var(--surface-soft); color: var(--text-soft); border-color: var(--border); }

.calendar-event:hover,
.calendar-event:focus-visible {
  filter: brightness(0.97);
}
</style>
