<script setup>
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  align: { type: String, default: 'end' },
})

const isOpen = ref(false)
const menuId = `dropdown-menu-${useId()}`
const triggerRef = ref(null)
const menuRef = ref(null)

async function open() {
  isOpen.value = true
  await nextTick()
  menuRef.value?.querySelector('[role="menuitem"]')?.focus()
}

function close({ restoreFocus = false } = {}) {
  if (!isOpen.value) return
  isOpen.value = false
  if (restoreFocus) triggerRef.value?.focus()
}

function toggle() {
  isOpen.value ? close() : open()
}

function handleDocumentClick(event) {
  if (!isOpen.value) return
  const target = event.target
  if (menuRef.value?.contains(target) || triggerRef.value?.contains(target)) return
  close()
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close({ restoreFocus: true })
  }
}

document.addEventListener('click', handleDocumentClick)
onBeforeUnmount(() => document.removeEventListener('click', handleDocumentClick))
</script>

<template>
  <div class="dropdown" @keydown="handleKeydown">
    <button
      ref="triggerRef"
      type="button"
      class="dropdown-trigger"
      :aria-expanded="isOpen"
      :aria-controls="menuId"
      :aria-label="$slots.trigger ? label : undefined"
      aria-haspopup="menu"
      @click="toggle"
    >
      <slot name="trigger">{{ label }}</slot>
    </button>
    <div
      v-if="isOpen"
      :id="menuId"
      ref="menuRef"
      class="dropdown-menu"
      :class="`dropdown-menu-${align}`"
      role="menu"
      :aria-label="label"
      @click="close()"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.dropdown {
  position: relative;
  display: inline-flex;
}

.dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  z-index: 1100;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  padding: 0.4rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.dropdown-menu-end {
  right: 0;
}

.dropdown-menu-start {
  left: 0;
}
</style>
