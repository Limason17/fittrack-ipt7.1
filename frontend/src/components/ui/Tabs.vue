<script setup>
import { useId } from 'vue'

const props = defineProps({
  tabs: { type: Array, required: true }, // [{ value, label }]
  modelValue: { type: String, required: true },
  label: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])

const groupId = `tabs-${useId()}`

function select(value) {
  emit('update:modelValue', value)
}

function handleKeydown(event, index) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const count = props.tabs.length
  let nextIndex = index
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % count
  if (event.key === 'ArrowLeft') nextIndex = (index - 1 + count) % count
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = count - 1
  const next = props.tabs[nextIndex]
  select(next.value)
  event.currentTarget.parentElement.children[nextIndex]?.focus()
}
</script>

<template>
  <div class="tabs" role="tablist" :aria-label="label" :id="groupId">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      class="tab"
      :aria-selected="modelValue === tab.value"
      :tabindex="modelValue === tab.value ? 0 : -1"
      @click="select(tab.value)"
      @keydown="handleKeydown($event, index)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
