<script setup>
import { useId } from 'vue'
import Modal from './Modal.vue'
import { t } from '../../utils/i18n'

const props = defineProps({
  open: { type: Boolean, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  confirmLabel: { type: String, default: null },
  cancelLabel: { type: String, default: null },
  tone: { type: String, default: 'primary' },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])

const titleId = `confirm-dialog-title-${useId()}`
</script>

<template>
  <Modal :open="open" :title-id="titleId" @close="emit('cancel')">
    <h2 :id="titleId" class="confirm-title">{{ title }}</h2>
    <p v-if="description" class="confirm-description">{{ description }}</p>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" data-autofocus @click="emit('cancel')">
        {{ cancelLabel || t('common.cancel') }}
      </button>
      <button
        type="button"
        class="btn"
        :class="tone === 'danger' ? 'btn-danger' : 'btn-primary'"
        :disabled="busy"
        @click="emit('confirm')"
      >
        <span v-if="busy" class="spinner" aria-hidden="true"></span>
        {{ confirmLabel || t('common.confirm') }}
      </button>
    </div>
  </Modal>
</template>

<style scoped>
.confirm-title {
  font-size: var(--text-lg);
}

.confirm-description {
  color: var(--text-soft);
  font-size: var(--text-sm);
}
</style>
