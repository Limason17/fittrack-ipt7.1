import { apiRequest } from './api'
import { publicId, withPagination } from './studioApi'
import { getToken } from './auth'

function authenticated(options = {}) {
  return { ...options, token: options.token || getToken() }
}

function sid(studioId) {
  return publicId(studioId, 'Studio id')
}

function sessionsPath(studioId) {
  return `/v1/studios/${sid(studioId)}/workout-sessions`
}

function sessionExercisePath(studioId, sessionId, exerciseId) {
  return `${sessionsPath(studioId)}/${publicId(sessionId, 'Session id')}/exercises/${publicId(exerciseId, 'Exercise id')}`
}

// ---- Start a session from an assignment ----

export function startWorkoutSession(studioId, assignmentId, body, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/program-assignments/${publicId(assignmentId, 'Assignment id')}/workout-sessions`,
    authenticated({ ...options, method: 'POST', body })
  )
}

// ---- Member self-access ----

export function listOwnWorkoutSessions(studioId, options) {
  const request = withPagination(`${sessionsPath(studioId)}/me`, options)
  return apiRequest(request.path, authenticated(request.options))
}

export function getOwnWorkoutSession(studioId, sessionId, options) {
  return apiRequest(
    `${sessionsPath(studioId)}/${publicId(sessionId, 'Session id')}`,
    authenticated(options)
  )
}

export function updateWorkoutSession(studioId, sessionId, body, options) {
  return apiRequest(
    `${sessionsPath(studioId)}/${publicId(sessionId, 'Session id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}

export function completeWorkoutSession(studioId, sessionId, options) {
  return apiRequest(
    `${sessionsPath(studioId)}/${publicId(sessionId, 'Session id')}/complete`,
    authenticated({ ...options, method: 'POST' })
  )
}

export function abortWorkoutSession(studioId, sessionId, options) {
  return apiRequest(
    `${sessionsPath(studioId)}/${publicId(sessionId, 'Session id')}/abort`,
    authenticated({ ...options, method: 'POST' })
  )
}

// ---- Session exercises and sets ----

export function createWorkoutSet(studioId, sessionId, exerciseId, options) {
  return apiRequest(
    `${sessionExercisePath(studioId, sessionId, exerciseId)}/sets`,
    authenticated({ ...options, method: 'POST', body: {} })
  )
}

export function updateWorkoutSessionExercise(studioId, sessionId, exerciseId, body, options) {
  return apiRequest(
    sessionExercisePath(studioId, sessionId, exerciseId),
    authenticated({ ...options, method: 'PATCH', body })
  )
}

export function updateWorkoutSet(studioId, sessionId, exerciseId, setId, body, options) {
  return apiRequest(
    `${sessionExercisePath(studioId, sessionId, exerciseId)}/sets/${publicId(setId, 'Set id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}

// ---- Coach read access ----

export function listCoachedMemberWorkoutSessions(studioId, memberMembershipId, options) {
  const request = withPagination(
    `/v1/studios/${sid(studioId)}/coached-members/${publicId(memberMembershipId, 'Membership id')}/workout-sessions`,
    options
  )
  return apiRequest(request.path, authenticated(request.options))
}

export function getCoachedMemberWorkoutSession(studioId, memberMembershipId, sessionId, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/coached-members/${publicId(memberMembershipId, 'Membership id')}/workout-sessions/${publicId(sessionId, 'Session id')}`,
    authenticated(options)
  )
}
