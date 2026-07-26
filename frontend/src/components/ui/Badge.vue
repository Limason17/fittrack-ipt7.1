<script setup>
import { computed } from 'vue'

const props = defineProps({
  tone: {
    type: String,
    default: 'neutral',
    validator: (value) =>
      ['neutral', 'success', 'warning', 'danger', 'info', 'due-today', 'in-progress'].includes(value),
  },
  dot: { type: Boolean, default: false },
})

const toneClass = computed(() => `badge-${props.tone}`)
</script>

<template>
  <span class="badge" :class="toneClass">
    <span v-if="dot" class="badge-dot" aria-hidden="true"></span>
    <slot />
  </span>
</template>
