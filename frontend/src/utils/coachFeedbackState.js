import { ref } from 'vue'
import { createWorkoutSessionFeedback, listWorkoutSessionFeedback } from './workoutSessionApi'
import { workoutErrorMessage } from './workoutSessionErrors'

function storageKey(studioId, sessionId) {
  return `fittrack_feedback_key:${studioId}:${sessionId}`
}

function storageAvailable() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

// Mirrors the workout-session client-start-key pattern: a fresh clientFeedbackKey is
// minted once per compose attempt and held only in sessionStorage (never localStorage,
// never the feedback text itself) so a network-error retry of the same submission is
// idempotent, while a successful send clears it and the next entry gets a new key.
function getOrCreateFeedbackKey(studioId, sessionId) {
  if (!storageAvailable()) return crypto.randomUUID()
  const key = storageKey(studioId, sessionId)
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const created = crypto.randomUUID()
  sessionStorage.setItem(key, created)
  return created
}

function clearFeedbackKey(studioId, sessionId) {
  if (!storageAvailable()) return
  sessionStorage.removeItem(storageKey(studioId, sessionId))
}

export function useCoachSessionFeedback() {
  const entries = ref([])
  const isLoading = ref(true)
  const loadError = ref('')
  const isSubmitting = ref(false)
  const submitError = ref('')

  async function load(studioId, sessionId) {
    isLoading.value = true
    loadError.value = ''
    try {
      const result = await listWorkoutSessionFeedback(studioId, sessionId, { page: 1, limit: 100 })
      entries.value = result.workoutSessionFeedback || []
    } catch (error) {
      loadError.value = workoutErrorMessage(error)
    } finally {
      isLoading.value = false
    }
  }

  async function submit(studioId, sessionId, body) {
    if (isSubmitting.value) return { ok: false }
    isSubmitting.value = true
    submitError.value = ''
    const clientFeedbackKey = getOrCreateFeedbackKey(studioId, sessionId)
    try {
      const result = await createWorkoutSessionFeedback(studioId, sessionId, { clientFeedbackKey, body })
      entries.value = [...entries.value, result.workoutSessionFeedback]
      clearFeedbackKey(studioId, sessionId)
      return { ok: true }
    } catch (error) {
      submitError.value = workoutErrorMessage(error)
      return { ok: false, error }
    } finally {
      isSubmitting.value = false
    }
  }

  function reset() {
    entries.value = []
    isLoading.value = true
    loadError.value = ''
    isSubmitting.value = false
    submitError.value = ''
  }

  return { entries, isLoading, loadError, isSubmitting, submitError, load, submit, reset }
}
