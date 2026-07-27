import { apiRequest } from './api'
import { publicId, withPagination } from './studioApi'
import { getToken } from './auth'

function authenticated(options = {}) {
  return { ...options, token: options.token || getToken() }
}

function sid(studioId) {
  return publicId(studioId, 'Studio id')
}

// ---- Coaching relationships ----

export function listCoachingRelationships(studioId, options) {
  const request = withPagination(`/v1/studios/${sid(studioId)}/coaching-relationships`, options)
  return apiRequest(request.path, authenticated(request.options))
}

export function createCoachingRelationship(studioId, body, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/coaching-relationships`,
    authenticated({ ...options, method: 'POST', body })
  )
}

export function endCoachingRelationship(studioId, relationshipId, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/coaching-relationships/${publicId(relationshipId, 'Relationship id')}`,
    authenticated({ ...options, method: 'PATCH', body: { status: 'ended' } })
  )
}

export function listOwnCoachingRelationships(studioId, options) {
  const { status, ...paginationOptions } = options || {}
  const basePath = `/v1/studios/${sid(studioId)}/coaching-relationships/me`
  const request = withPagination(basePath, paginationOptions)
  const params = new URLSearchParams(request.path.includes('?') ? request.path.split('?')[1] : '')
  if (status !== undefined) params.set('status', status)
  const query = params.toString()
  const path = query ? `${basePath}?${query}` : basePath
  return apiRequest(path, authenticated(request.options))
}

// ---- Training programs ----

export function listTrainingPrograms(studioId, options) {
  const request = withPagination(`/v1/studios/${sid(studioId)}/training-programs`, options)
  return apiRequest(request.path, authenticated(request.options))
}

export function createTrainingProgram(studioId, body, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/training-programs`,
    authenticated({ ...options, method: 'POST', body })
  )
}

export function getTrainingProgram(studioId, programId, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/training-programs/${publicId(programId, 'Program id')}`,
    authenticated(options)
  )
}

export function updateTrainingProgram(studioId, programId, body, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/training-programs/${publicId(programId, 'Program id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}

// ---- Program versions ----

function versionsPath(studioId, programId) {
  return `/v1/studios/${sid(studioId)}/training-programs/${publicId(programId, 'Program id')}/versions`
}

export function listProgramVersions(studioId, programId, options) {
  const request = withPagination(versionsPath(studioId, programId), options)
  return apiRequest(request.path, authenticated(request.options))
}

export function createProgramVersion(studioId, programId, body, options) {
  return apiRequest(versionsPath(studioId, programId), authenticated({ ...options, method: 'POST', body }))
}

export function getProgramVersion(studioId, programId, versionId, options) {
  return apiRequest(
    `${versionsPath(studioId, programId)}/${publicId(versionId, 'Version id')}`,
    authenticated(options)
  )
}

export function updateProgramVersion(studioId, programId, versionId, body, options) {
  return apiRequest(
    `${versionsPath(studioId, programId)}/${publicId(versionId, 'Version id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}

export function publishProgramVersion(studioId, programId, versionId, options) {
  return apiRequest(
    `${versionsPath(studioId, programId)}/${publicId(versionId, 'Version id')}/publish`,
    authenticated({ ...options, method: 'POST' })
  )
}

// ---- Program days ----

function daysPath(studioId, programId, versionId) {
  return `${versionsPath(studioId, programId)}/${publicId(versionId, 'Version id')}/days`
}

export function createProgramDay(studioId, programId, versionId, body, options) {
  return apiRequest(daysPath(studioId, programId, versionId), authenticated({ ...options, method: 'POST', body }))
}

export function updateProgramDay(studioId, programId, versionId, dayId, body, options) {
  return apiRequest(
    `${daysPath(studioId, programId, versionId)}/${publicId(dayId, 'Day id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}

export function deleteProgramDay(studioId, programId, versionId, dayId, options) {
  return apiRequest(
    `${daysPath(studioId, programId, versionId)}/${publicId(dayId, 'Day id')}`,
    authenticated({ ...options, method: 'DELETE' })
  )
}

// ---- Program exercises ----

function exercisesPath(studioId, programId, versionId, dayId) {
  return `${daysPath(studioId, programId, versionId)}/${publicId(dayId, 'Day id')}/exercises`
}

export function createProgramExercise(studioId, programId, versionId, dayId, body, options) {
  return apiRequest(
    exercisesPath(studioId, programId, versionId, dayId),
    authenticated({ ...options, method: 'POST', body })
  )
}

export function updateProgramExercise(studioId, programId, versionId, dayId, exerciseId, body, options) {
  return apiRequest(
    `${exercisesPath(studioId, programId, versionId, dayId)}/${publicId(exerciseId, 'Exercise id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}

export function deleteProgramExercise(studioId, programId, versionId, dayId, exerciseId, options) {
  return apiRequest(
    `${exercisesPath(studioId, programId, versionId, dayId)}/${publicId(exerciseId, 'Exercise id')}`,
    authenticated({ ...options, method: 'DELETE' })
  )
}

// ---- Program assignments ----

export function listOwnProgramAssignments(studioId, options) {
  const request = withPagination(`/v1/studios/${sid(studioId)}/program-assignments/me`, options)
  return apiRequest(request.path, authenticated(request.options))
}

export function getOwnProgramAssignmentDetail(studioId, assignmentId, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/program-assignments/me/${publicId(assignmentId, 'Assignment id')}`,
    authenticated(options)
  )
}

export function listProgramAssignments(studioId, options) {
  const request = withPagination(`/v1/studios/${sid(studioId)}/program-assignments`, options)
  return apiRequest(request.path, authenticated(request.options))
}

export function createProgramAssignment(studioId, body, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/program-assignments`,
    authenticated({ ...options, method: 'POST', body })
  )
}

export function getProgramAssignment(studioId, assignmentId, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/program-assignments/${publicId(assignmentId, 'Assignment id')}`,
    authenticated(options)
  )
}

export function updateProgramAssignment(studioId, assignmentId, body, options) {
  return apiRequest(
    `/v1/studios/${sid(studioId)}/program-assignments/${publicId(assignmentId, 'Assignment id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}

// ---- Assignment schedule rules ----

function scheduleRulesPath(studioId, assignmentId) {
  return `/v1/studios/${sid(studioId)}/program-assignments/${publicId(assignmentId, 'Assignment id')}/schedule-rules`
}

export function listScheduleRules(studioId, assignmentId, options) {
  return apiRequest(scheduleRulesPath(studioId, assignmentId), authenticated(options))
}

export function createScheduleRule(studioId, assignmentId, body, options) {
  return apiRequest(
    scheduleRulesPath(studioId, assignmentId),
    authenticated({ ...options, method: 'POST', body })
  )
}

export function updateScheduleRule(studioId, assignmentId, ruleId, body, options) {
  return apiRequest(
    `${scheduleRulesPath(studioId, assignmentId)}/${publicId(ruleId, 'Rule id')}`,
    authenticated({ ...options, method: 'PATCH', body })
  )
}
