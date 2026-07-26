<script setup>
import { computed } from 'vue'
import { formatDate, t } from '../../utils/i18n'
import CalendarEventItem from './CalendarEventItem.vue'

const props = defineProps({
  days: { type: Array, required: true }, // [{ date, dayNumber, inCurrentMonth }]
  entriesByDate: { type: Map, required: true },
  today: { type: String, required: true },
  monthLabel: { type: String, required: true },
})
const emit = defineEmits(['open-event', 'change-month', 'go-today'])

// Only days that actually have an event are rendered - a full 42-row list of
// mostly-empty days would defeat the point of a scannable mobile agenda.
const agendaDays = computed(() =>
  props.days
    .map((day) => ({ ...day, entries: props.entriesByDate.get(day.date) || [] }))
    .filter((day) => day.entries.length > 0)
)

function dayHeading(day) {
  const label = formatDate(day.date, { weekday: 'long', day: '2-digit', month: 'long' })
  return day.date === props.today ? `${label} · ${t('calendar.today')}` : label
}
</script>

<template>
  <section class="calendar-agenda card" :aria-label="t('calendar.agendaLabel')">
    <div class="calendar-head">
      <h2>{{ monthLabel }}</h2>
      <div class="calendar-controls">
        <button class="btn btn-secondary" type="button" @click="emit('go-today')">
          {{ t('calendar.today') }}
        </button>
        <button class="btn btn-secondary" type="button" :aria-label="t('calendar.previousPeriod')" @click="emit('change-month', -1)">
          &lt;
        </button>
        <button class="btn btn-secondary" type="button" :aria-label="t('calendar.nextPeriod')" @click="emit('change-month', 1)">
          &gt;
        </button>
      </div>
    </div>

    <p v-if="agendaDays.length === 0" class="agenda-empty">{{ t('calendar.agendaEmpty') }}</p>

    <ol v-else class="agenda-days">
      <li v-for="day in agendaDays" :key="day.date" class="agenda-day">
        <h3 class="agenda-day-heading" :class="{ 'agenda-day-heading-today': day.date === today }">
          {{ dayHeading(day) }}
        </h3>
        <div class="agenda-day-events">
          <CalendarEventItem
            v-for="entry in day.entries"
            :key="entry.id"
            :entry="entry"
            variant="agenda"
            @open="emit('open-event', entry)"
          />
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.calendar-head,
.calendar-controls {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.calendar-head {
  justify-content: space-between;
}

.calendar-head h2 {
  font-size: 1.05rem;
  font-weight: 850;
}

.agenda-empty {
  padding: 1.5rem 0;
  color: var(--text-soft);
  text-align: center;
}

.agenda-days {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
  list-style: none;
}

.agenda-day-heading {
  margin-bottom: 0.5rem;
  color: var(--text-soft);
  font-size: var(--text-sm);
  font-weight: 800;
}

.agenda-day-heading-today {
  color: var(--accent-hover);
}

.agenda-day-events {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
</style>
