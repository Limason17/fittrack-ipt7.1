<script setup>
import { computed } from 'vue'
import { formatDate, t, weekdayNames } from '../../utils/i18n'
import { buildMonthGrid } from '../../utils/calendarDate'
import CalendarEventItem from './CalendarEventItem.vue'

const props = defineProps({
  monthDate: { type: Date, required: true },
  entriesByDate: { type: Map, required: true },
  today: { type: String, required: true },
})
const emit = defineEmits(['open-event', 'change-month', 'go-today'])

const monthLabel = computed(() => formatDate(props.monthDate, { month: 'long', year: 'numeric' }))
const days = computed(() => buildMonthGrid(props.monthDate))

function eventsFor(dateOnly) {
  return props.entriesByDate.get(dateOnly) || []
}
</script>

<template>
  <section class="calendar-card card" aria-label="calendar-desktop">
    <div class="calendar-head">
      <h2 id="calendar-month-heading">{{ monthLabel }}</h2>
      <div class="calendar-controls">
        <button class="btn btn-secondary" type="button" @click="emit('go-today')">
          {{ t('calendar.today') }}
        </button>
        <button class="btn btn-secondary" type="button" :aria-label="t('calendar.previousMonth')" @click="emit('change-month', -1)">
          &lt;
        </button>
        <button class="btn btn-secondary" type="button" :aria-label="t('calendar.nextMonth')" @click="emit('change-month', 1)">
          &gt;
        </button>
      </div>
    </div>

    <div class="weekday-grid" aria-hidden="true">
      <span v-for="dayName in weekdayNames()" :key="dayName">{{ dayName }}</span>
    </div>

    <div
      class="calendar-grid"
      role="group"
      :aria-labelledby="'calendar-month-heading'"
    >
      <div
        v-for="day in days"
        :key="day.date"
        class="calendar-day"
        :class="{ 'calendar-day-muted': !day.inCurrentMonth, 'calendar-day-today': day.date === today }"
      >
        <span class="day-number">
          {{ day.dayNumber }}
          <span v-if="day.date === today" class="visually-hidden">{{ t('calendar.today') }}</span>
        </span>
        <div class="day-events">
          <CalendarEventItem
            v-for="entry in eventsFor(day.date)"
            :key="entry.id"
            :entry="entry"
            variant="grid"
            @open="emit('open-event', entry)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calendar-head,
.calendar-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.calendar-head {
  justify-content: space-between;
  flex-wrap: wrap;
}

.calendar-head h2 {
  font-size: 1.12rem;
  font-weight: 850;
}

.calendar-controls {
  flex-wrap: wrap;
}

.weekday-grid,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.45rem;
}

.weekday-grid {
  margin: 1rem 0 0.45rem;
}

.weekday-grid span {
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-align: center;
}

.calendar-day {
  display: flex;
  min-height: 108px;
  max-height: 148px;
  flex-direction: column;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.calendar-day-muted {
  background: var(--surface-soft);
  color: var(--text-muted);
}

.calendar-day-today {
  border-color: var(--accent);
  border-width: 2px;
}

.day-number {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-soft);
  font-weight: 850;
}

.calendar-day-today .day-number {
  color: var(--accent-hover);
}

.day-events {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.25rem;
  overflow-y: auto;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1023px) {
  .calendar-day {
    min-height: 88px;
  }
}
</style>
