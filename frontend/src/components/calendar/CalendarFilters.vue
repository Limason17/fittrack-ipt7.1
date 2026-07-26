<script setup>
import { computed } from 'vue'
import { t } from '../../utils/i18n'
import { CALENDAR_DISPLAY_STATUS_ORDER, calendarDisplayStatusLabel } from '../../utils/calendarStatus'
import Tabs from '../ui/Tabs.vue'

const props = defineProps({
  source: { type: String, required: true }, // 'all' | 'personal' | 'studio'
  status: { type: String, required: true }, // 'all' | one of CALENDAR_DISPLAY_STATUS_ORDER
})
const emit = defineEmits(['update:source', 'update:status', 'reset'])

const sourceTabs = computed(() => [
  { value: 'all', label: t('calendar.filters.sourceAll') },
  { value: 'personal', label: t('calendar.source.personal') },
  { value: 'studio', label: t('calendar.source.studio') },
])

const isDefault = computed(() => props.source === 'all' && props.status === 'all')
</script>

<template>
  <div class="calendar-filters" role="group" :aria-label="t('calendar.filters.label')">
    <div class="filter-group">
      <span class="filter-label">{{ t('calendar.filters.sourceLabel') }}</span>
      <Tabs
        :tabs="sourceTabs"
        :model-value="source"
        :label="t('calendar.filters.sourceLabel')"
        @update:model-value="emit('update:source', $event)"
      />
    </div>

    <div class="filter-group">
      <label class="filter-label" for="calendar-status-filter">{{ t('calendar.filters.statusLabel') }}</label>
      <select
        id="calendar-status-filter"
        class="input status-filter"
        :value="status"
        @change="emit('update:status', $event.target.value)"
      >
        <option value="all">{{ t('calendar.filters.statusAll') }}</option>
        <option v-for="value in CALENDAR_DISPLAY_STATUS_ORDER" :key="value" :value="value">
          {{ calendarDisplayStatusLabel(value) }}
        </option>
      </select>
    </div>

    <button type="button" class="btn btn-secondary" :disabled="isDefault" @click="emit('reset')">
      {{ t('calendar.filters.reset') }}
    </button>
  </div>
</template>

<style scoped>
.calendar-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.filter-label {
  color: var(--text-soft);
  font-size: var(--text-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.status-filter {
  min-width: 180px;
}
</style>
