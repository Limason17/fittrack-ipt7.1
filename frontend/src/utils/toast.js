import { ref } from 'vue'

export const toasts = ref([])

let counter = 0

export function pushToast(message, { tone = 'info', duration = 5000 } = {}) {
  const id = `toast-${++counter}`
  toasts.value = [...toasts.value, { id, message, tone }]
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration)
  }
  return id
}

export function dismissToast(id) {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function toastSuccess(message, options) {
  return pushToast(message, { ...options, tone: 'success' })
}

export function toastError(message, options) {
  return pushToast(message, { ...options, tone: 'danger' })
}
