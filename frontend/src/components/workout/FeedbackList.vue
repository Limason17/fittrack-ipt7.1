<script setup>
import EmptyState from '../ui/EmptyState.vue'
import { formatDate } from '../../utils/i18n'

defineProps({
  entries: { type: Array, required: true },
  emptyTitle: { type: String, required: true },
})

const DATE_TIME_OPTIONS = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
</script>

<template>
  <div class="feedback-list">
    <EmptyState v-if="!entries.length" :title="emptyTitle" />
    <article v-for="entry in entries" :key="entry.id" class="feedback-entry card">
      <header class="feedback-entry-head">
        <strong>{{ entry.coach.displayName }}</strong>
        <span class="studio-meta">{{ formatDate(entry.createdAt, DATE_TIME_OPTIONS) }}</span>
      </header>
      <p class="feedback-entry-body">{{ entry.body }}</p>
    </article>
  </div>
</template>

<style scoped>
.feedback-list {
  display: grid;
  gap: 0.75rem;
}

.feedback-entry {
  display: grid;
  gap: 0.4rem;
}

.feedback-entry-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.feedback-entry-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-soft);
}
</style>
