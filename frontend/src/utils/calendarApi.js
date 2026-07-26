// API client for the Stage 5A1 unified training calendar backend
// (docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md). Mirrors the existing
// utils/studioApi.js / utils/accountApi.js convention exactly: a thin
// `authenticated()` wrapper over apiRequest, one exported function per
// endpoint, no per-component field renaming.
import { apiRequest } from './api'
import { getToken } from './auth'
import { startWorkoutSession } from './workoutSessionApi'

function authenticated(options = {}) {
  return { ...options, token: options.token || getToken() }
}

function entryId(value) {
  const candidate = String(value || '').trim()
  if (!candidate) {
    throw new TypeError('Calendar entry id is required.')
  }
  return encodeURIComponent(candidate)
}

export function getCalendarRange({ from, to, timezone }, options) {
  const params = new URLSearchParams({ from, to })
  if (timezone) params.set('timezone', timezone)
  return apiRequest(`/v1/training-calendar?${params.toString()}`, authenticated(options))
}

export function createCalendarEntry(body, options) {
  return apiRequest('/v1/training-calendar', authenticated({ ...options, method: 'POST', body }))
}

export function updateCalendarEntry(id, body, options) {
  return apiRequest(`/v1/training-calendar/${entryId(id)}`, authenticated({ ...options, method: 'PATCH', body }))
}

export function rescheduleCalendarEntry(id, body, options) {
  return apiRequest(`/v1/training-calendar/${entryId(id)}/reschedule`, authenticated({ ...options, method: 'POST', body }))
}

export function completeCalendarEntry(id, body, options) {
  return apiRequest(`/v1/training-calendar/${entryId(id)}/complete`, authenticated({ ...options, method: 'POST', body }))
}

export function skipCalendarEntry(id, body, options) {
  return apiRequest(`/v1/training-calendar/${entryId(id)}/skip`, authenticated({ ...options, method: 'POST', body }))
}

export function cancelCalendarEntry(id, body, options) {
  return apiRequest(`/v1/training-calendar/${entryId(id)}/cancel`, authenticated({ ...options, method: 'POST', body }))
}

// Starting a studio workout from the calendar uses the exact same,
// already-existing session-start contract as MyTrainingPlanView.vue (Stage
// 5A1's own integration: starting a session links it to today's calendar
// occurrence server-side, see workoutSessionService.js) - never a second,
// parallel start endpoint invented for the calendar.
export function startCalendarStudioWorkout(studioId, assignmentId, body, options) {
  return startWorkoutSession(studioId, assignmentId, body, authenticated(options))
}

// Determines where "open linked workout" (the VIEW_WORKOUT action) should
// navigate. Personal workouts have no dedicated detail route in this
// application (WorkoutsView.vue's list IS the detail surface, see Stage 5A2
// analysis) - building a new one is explicitly out of scope for this phase,
// so a personal link always goes to the existing /workouts list. Studio
// workouts navigate to the existing session detail/result view. Returns
// null (never throws, never guesses) for anything the current contract
// cannot resolve to a route.
export function resolveLinkedWorkoutRoute(entry) {
  if (!entry || !entry.linkedWorkoutPublicId) return null
  if (entry.linkedWorkoutType === 'personal_workout') {
    return { name: 'workouts' }
  }
  if (entry.linkedWorkoutType === 'studio_workout_session' && entry.studio?.id) {
    return {
      name: 'studio-workout-session-detail',
      params: { studioId: entry.studio.id, sessionId: entry.linkedWorkoutPublicId },
    }
  }
  return null
}
