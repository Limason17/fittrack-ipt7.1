<script setup>
import { computed, ref } from 'vue'
import { t } from '../../utils/i18n'

const props = defineProps({
  isSubmitting: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  maxLength: { type: Number, default: 2000 },
})
const emit = defineEmits(['submit'])

const draft = ref('')
const trimmedLength = computed(() => draft.value.trim().length)
const canSubmit = computed(() => (
  trimmedLength.value > 0 && trimmedLength.value <= props.maxLength && !props.isSubmitting
))

function handleSubmit() {
  if (!canSubmit.value) return
  emit('submit', draft.value.trim())
}

function clear() {
  draft.value = ''
}

defineExpose({ clear })
</script>

<template>
  <form class="feedback-form" @submit.prevent="handleSubmit">
    <p class="studio-help">{{ t('studios.coachResults.feedbackDescription') }}</p>
    <div class="form-group">
      <label class="form-label" for="feedback-body">{{ t('studios.coachResults.feedbackLabel') }}</label>
      <textarea
        id="feedback-body"
        v-model="draft"
        class="input"
        rows="4"
        :maxlength="maxLength"
        :disabled="isSubmitting"
        aria-describedby="feedback-body-count"
      ></textarea>
      <p id="feedback-body-count" class="studio-meta" aria-live="polite">
        {{ t('studios.coachResults.feedbackCharacterCount', { count: trimmedLength, max: maxLength }) }}
      </p>
    </div>
    <p v-if="errorMessage" class="message message-error" role="alert" aria-live="assertive">{{ errorMessage }}</p>
    <button type="submit" class="btn btn-primary" :disabled="!canSubmit">
      <span v-if="isSubmitting" class="spinner" aria-hidden="true"></span>
      {{ t('studios.coachResults.sendFeedback') }}
    </button>
  </form>
</template>

<style scoped>
.feedback-form {
  display: grid;
  gap: 0.75rem;
}
</style>
