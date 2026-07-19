<script setup>
import { computed, ref, toRef } from 'vue'
import { useModalFocus } from '../../utils/modalFocus'

const props = defineProps({
  open: { type: Boolean, required: true },
  titleId: { type: String, required: true },
  labelledby: { type: String, default: null },
  size: { type: String, default: 'md' },
})
const emit = defineEmits(['close'])

const dialogRef = ref(null)
const isOpen = toRef(props, 'open')
const labelId = computed(() => props.labelledby || props.titleId)

function close() {
  emit('close')
}

const { handleModalKeydown } = useModalFocus({ isOpen, dialogRef, close })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @mousedown.self="close">
      <div
        ref="dialogRef"
        class="modal-panel"
        :class="`modal-panel-${size}`"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelId"
        tabindex="-1"
        @keydown="handleModalKeydown"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 18, 21, 0.45);
}

.modal-panel {
  width: 100%;
  max-width: 480px;
  max-height: min(640px, calc(100dvh - 2rem));
  overflow-y: auto;
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
}

.modal-panel-lg {
  max-width: 680px;
}

.modal-panel:focus {
  outline: none;
}
</style>
