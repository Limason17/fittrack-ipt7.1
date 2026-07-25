import { apiRequest } from './api'
import { getToken } from './auth'

function publicId(value, label) {
    const candidate = String(value || '').trim()
    if (!candidate || candidate.length > 160) {
        throw new TypeError(`${label} is required.`)
    }
    return encodeURIComponent(candidate)
}

function authenticated(options = {}) {
    return { ...options, token: options.token || getToken() }
}

function positiveInteger(value, label, maximum) {
    if (value === undefined) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new TypeError(`${label} is invalid.`)
    }
    return parsed
}

export function withPagination(path, options = {}) {
    const { page, limit, ...requestOptions } = options || {}
    const params = new URLSearchParams()
    const safePage = positiveInteger(page, 'Page', 1_000_000)
    const safeLimit = positiveInteger(limit, 'Limit', 100)
    if (safePage !== null) params.set('page', String(safePage))
    if (safeLimit !== null) params.set('limit', String(safeLimit))
    const query = params.toString()
    return {
        path: query ? `${path}?${query}` : path,
        options: requestOptions,
    }
}

export function listStudios(options) {
    return apiRequest('/v1/studios', authenticated(options))
}

export function createStudio(body, options) {
    return apiRequest('/v1/studios', authenticated({ ...options, method: 'POST', body }))
}

export function getStudio(studioId, options) {
    return apiRequest(`/v1/studios/${publicId(studioId, 'Studio id')}`, authenticated(options))
}

export function updateStudio(studioId, body, options) {
    return apiRequest(`/v1/studios/${publicId(studioId, 'Studio id')}`, authenticated({
        ...options,
        method: 'PATCH',
        body,
    }))
}

export function listMemberships(studioId, options) {
    const request = withPagination(
        `/v1/studios/${publicId(studioId, 'Studio id')}/memberships`,
        options
    )
    return apiRequest(
        request.path,
        authenticated(request.options)
    )
}

export function getMyMembership(studioId, options) {
    return apiRequest(
        `/v1/studios/${publicId(studioId, 'Studio id')}/memberships/me`,
        authenticated(options)
    )
}

export function updateMembership(studioId, membershipId, body, options) {
    return apiRequest(
        `/v1/studios/${publicId(studioId, 'Studio id')}/memberships/${publicId(membershipId, 'Membership id')}`,
        authenticated({ ...options, method: 'PATCH', body })
    )
}

export function listInvitations(studioId, options) {
    const request = withPagination(
        `/v1/studios/${publicId(studioId, 'Studio id')}/invitations`,
        options
    )
    return apiRequest(
        request.path,
        authenticated(request.options)
    )
}

export function createInvitation(studioId, body, options) {
    return apiRequest(
        `/v1/studios/${publicId(studioId, 'Studio id')}/invitations`,
        authenticated({ ...options, method: 'POST', body })
    )
}

export function revokeInvitation(studioId, invitationId, options) {
    return apiRequest(
        `/v1/studios/${publicId(studioId, 'Studio id')}/invitations/${publicId(invitationId, 'Invitation id')}`,
        authenticated({ ...options, method: 'DELETE' })
    )
}

export function resendInvitation(studioId, invitationId, options) {
    return apiRequest(
        `/v1/studios/${publicId(studioId, 'Studio id')}/invitations/${publicId(invitationId, 'Invitation id')}/resend`,
        authenticated({ ...options, method: 'POST' })
    )
}

export function acceptInvitation(token, options) {
    return apiRequest(
        `/v1/invitations/${publicId(token, 'Invitation token')}/accept`,
        authenticated({ ...options, method: 'POST' })
    )
}

export function listAuditEvents(studioId, options) {
    const request = withPagination(
        `/v1/studios/${publicId(studioId, 'Studio id')}/audit-events`,
        options
    )
    return apiRequest(
        request.path,
        authenticated(request.options)
    )
}

export { publicId }
