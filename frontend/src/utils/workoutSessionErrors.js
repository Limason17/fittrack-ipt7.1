import { t } from './i18n'

// Maps the exact stable backend error codes (backend/errors/WorkoutSessionErrors.js)
// to a translated, non-technical message. Falls back to a generic message for
// anything unrecognized (network failure, 500, etc.) rather than ever
// surfacing a raw error code or technical term to the member.
const CODE_KEYS = Object.freeze({
  WORKOUT_ASSIGNMENT_NOT_AVAILABLE: 'assignmentNotAvailable',
  WORKOUT_DAY_NOT_AVAILABLE: 'dayNotAvailable',
  WORKOUT_SESSION_NOT_FOUND: 'sessionNotFound',
  WORKOUT_SESSION_NOT_MUTABLE: 'sessionNotMutable',
  WORKOUT_SESSION_ALREADY_TERMINAL: 'sessionAlreadyTerminal',
  WORKOUT_SESSION_INCOMPLETE: 'sessionIncomplete',
  WORKOUT_SESSION_CONFLICT: 'conflict',
  WORKOUT_EXERCISE_NOT_FOUND: 'exerciseNotFound',
  WORKOUT_EXERCISE_CONFLICT: 'conflict',
  WORKOUT_SET_NOT_FOUND: 'setNotFound',
  WORKOUT_SET_CONFLICT: 'conflict',
  WORKOUT_RESULT_INVALID: 'resultInvalid',
  WORKOUT_START_KEY_CONFLICT: 'startKeyConflict',
  VALIDATION_ERROR: 'validationError',
})

// Feedback-specific codes are mapped separately (backend/errors/WorkoutSessionErrors.js:
// WorkoutFeedbackSessionNotTerminalError, WorkoutFeedbackKeyConflictError) since their
// understandable messages live under studios.coachResults, not studios.workoutSessions.
const FEEDBACK_CODE_KEYS = Object.freeze({
  WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL: 'sessionNotTerminal',
  WORKOUT_FEEDBACK_KEY_CONFLICT: 'keyConflict',
})

export function workoutErrorCode(error) {
  return error?.data?.error?.code || null
}

export function isConflictError(error) {
  return error?.status === 409 && ['WORKOUT_SESSION_CONFLICT', 'WORKOUT_EXERCISE_CONFLICT', 'WORKOUT_SET_CONFLICT'].includes(
    workoutErrorCode(error)
  )
}

export function workoutErrorMessage(error) {
  const code = workoutErrorCode(error)
  const key = code && CODE_KEYS[code]
  if (key) return t(`studios.workoutSessions.errors.${key}`)
  const feedbackKey = code && FEEDBACK_CODE_KEYS[code]
  if (feedbackKey) return t(`studios.coachResults.errors.${feedbackKey}`)
  if (error?.status === 401) return t('studios.workoutSessions.errors.unauthorized')
  if (error?.status === 403) return t('studios.permissionDenied')
  if (error?.status === 404) return t('studios.workoutSessions.errors.sessionNotFound')
  return t('studios.workoutSessions.errors.generic')
}
