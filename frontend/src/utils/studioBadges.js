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

export function roleTone(role) {
  return ROLE_TONES[role] || 'neutral'
}

export function membershipStatusTone(status) {
  return MEMBERSHIP_STATUS_TONES[status] || 'neutral'
}

export function invitationStatusTone(status) {
  return INVITATION_STATUS_TONES[status] || 'neutral'
}
