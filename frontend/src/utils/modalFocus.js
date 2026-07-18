import { nextTick, onBeforeUnmount, watch } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container) {
  return [...(container?.querySelectorAll(FOCUSABLE_SELECTOR) || [])]
    .filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0)
}

export function useModalFocus({ isOpen, dialogRef, close }) {
  let returnFocus = null
  let previousBodyOverflow = ''

  function restoreBody() {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = previousBodyOverflow
    }
  }

  watch(isOpen, async (open) => {
    if (typeof document === 'undefined') return

    if (open) {
      returnFocus = document.activeElement
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      await nextTick()
      const target = dialogRef.value?.querySelector('[data-autofocus]')
        || focusableElements(dialogRef.value)[0]
        || dialogRef.value
      target?.focus()
      return
    }

    restoreBody()
    await nextTick()
    if (returnFocus?.isConnected) returnFocus.focus()
    returnFocus = null
  })

  function handleModalKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return

    const elements = focusableElements(dialogRef.value)
    if (elements.length === 0) {
      event.preventDefault()
      dialogRef.value?.focus()
      return
    }
    const first = elements[0]
    const last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onBeforeUnmount(restoreBody)
  return { handleModalKeydown }
}

export { FOCUSABLE_SELECTOR, focusableElements }
