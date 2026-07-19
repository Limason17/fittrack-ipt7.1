const ROLE_TONES = {
  owner: 'success',
  admin: 'info',
  trainer: 'neutral',
  member: 'neutral',
}

const MEMBERSHIP_STATUS_TONES = {
  active: 'success',
  invited: 'info',
  suspended: 'warning',
  left: 'neutral',
}

const INVITATION_STATUS_TONES = {
  pending: 'info',
  accepted: 'success',
  revoked: 'neutral',
  expired: 'warning',
}

const COACHING_STATUS_TONES = {
  active: 'success',
  ended: 'neutral',
}

const PROGRAM_STATUS_TONES = {
  draft: 'info',
  active: 'success',
  archived: 'neutral',
}

const PROGRAM_VERSION_STATUS_TONES = {
  draft: 'info',
  published: 'success',
  retired: 'neutral',
}

const ASSIGNMENT_STATUS_TONES = {
  active: 'success',
  completed: 'info',
  cancelled: 'neutral',
}

const WORKOUT_SESSION_STATUS_TONES = {
  in_progress: 'info',
  completed: 'success',
  aborted: 'neutral',
}

const WORKOUT_ITEM_STATUS_TONES = {
  pending: 'warning',
  completed: 'success',
  skipped: 'neutral',
}

export function roleTone(role) {
  return ROLE_TONES[role] || 'neutral'
}

export function membershipStatusTone(status) {
  return MEMBERSHIP_STATUS_TONES[status] || 'neutral'
}

export function invitationStatusTone(status) {
  return INVITATION_STATUS_TONES[status] || 'neutral'
}

export function coachingStatusTone(status) {
  return COACHING_STATUS_TONES[status] || 'neutral'
}

export function programStatusTone(status) {
  return PROGRAM_STATUS_TONES[status] || 'neutral'
}

export function programVersionStatusTone(status) {
  return PROGRAM_VERSION_STATUS_TONES[status] || 'neutral'
}

export function assignmentStatusTone(status) {
  return ASSIGNMENT_STATUS_TONES[status] || 'neutral'
}

export function workoutSessionStatusTone(status) {
  return WORKOUT_SESSION_STATUS_TONES[status] || 'neutral'
}

export function workoutItemStatusTone(status) {
  return WORKOUT_ITEM_STATUS_TONES[status] || 'neutral'
}
