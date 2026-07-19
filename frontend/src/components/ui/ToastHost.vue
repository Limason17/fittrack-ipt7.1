<script setup>
import { toasts, dismissToast } from '../../utils/toast'
import { t } from '../../utils/i18n'
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.tone}`"
          role="status"
        >
          <span class="toast-message">{{ toast.message }}</span>
          <button
            type="button"
            class="toast-close"
            :aria-label="t('common.dismiss')"
            @click="dismissToast(toast.id)"
          >
            ×
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  z-index: 1300;
  bottom: 1rem;
  right: 1rem;
  left: 1rem;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 0.5rem;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: min(380px, 100%);
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius);
  background: var(--text);
  color: #fff;
  box-shadow: var(--shadow-md);
  font-size: var(--text-sm);
}

.toast-success { background: var(--accent-hover); }
.toast-danger { background: var(--danger); }
.toast-info { background: var(--text); }

.toast-message {
  flex: 1;
}

.toast-close {
  color: inherit;
  opacity: 0.75;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0.15rem 0.3rem;
}

.toast-close:hover {
  opacity: 1;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--transition), transform var(--transition);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 520px) {
  .toast-host {
    right: 0.65rem;
    left: 0.65rem;
    bottom: 0.65rem;
    align-items: stretch;
  }

  .toast {
    max-width: none;
  }
}
</style>
