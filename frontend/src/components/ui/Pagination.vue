<script setup>
import { computed } from 'vue'
import { t } from '../../utils/i18n'

const props = defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  itemLabel: { type: String, required: true },
})
const emit = defineEmits(['change'])

const canPrev = computed(() => props.page > 1)
const canNext = computed(() => props.page < props.totalPages)
</script>

<template>
  <nav class="studio-pagination" :aria-label="t('common.pagination')">
    <span class="studio-meta">{{ itemLabel }}</span>
    <button
      type="button"
      class="btn btn-secondary btn-sm"
      :disabled="!canPrev"
      @click="emit('change', page - 1)"
    >
      {{ t('common.previous') }}
    </button>
    <span class="studio-meta">{{ t('common.pageOf', { page, total: Math.max(totalPages, 1) }) }}</span>
    <button
      type="button"
      class="btn btn-secondary btn-sm"
      :disabled="!canNext"
      @click="emit('change', page + 1)"
    >
      {{ t('common.next') }}
    </button>
  </nav>
</template>
