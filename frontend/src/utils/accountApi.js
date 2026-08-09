import { apiRequest } from './api'
import { getToken } from './auth'

function authenticated(options = {}) {
    return { ...options, token: options.token || getToken() }
}

// Unlike studioApi.js's publicId() helper, this does not URL-encode the
// value: the token here is sent as a JSON body field, not embedded in a URL
// path segment, and encoding it would silently corrupt the value the server
// hashes and looks up.
function requiredToken(value, label) {
    const candidate = String(value || '').trim()
    if (!candidate || candidate.length > 160) {
        throw new TypeError(`${label} is required.`)
    }
    return candidate
}

export function changePassword(body, options) {
    return apiRequest('/account/change-password', authenticated({ ...options, method: 'POST', body }))
}

export function requestEmailChange(body, options) {
    return apiRequest('/account/email-change-requests', authenticated({ ...options, method: 'POST', body }))
}

export function getCurrentEmailChangeRequest(options) {
    return apiRequest('/account/email-change-requests/current', authenticated(options))
}

export function revokeEmailChangeRequest(options) {
    return apiRequest('/account/email-change-requests/current', authenticated({ ...options, method: 'DELETE' }))
}

// Deliberately not `authenticated()`: this is a public, token-only endpoint
// (see backend/routes/accountRouter.js) - the confirmation link may be
// opened in a browser that isn't logged into FitTrack at all, since it was
// delivered to the new e-mail address, not necessarily read in the same
// session that requested the change.
export function confirmEmailChange(token, options) {
    return apiRequest('/account/email-change-confirmations', {
        ...options,
        method: 'POST',
        body: { token: requiredToken(token, 'Email change token') },
    })
}

// Read-only, no destructive side effect - see backend/routes/accountRouter.js
// (no rate limiter on this endpoint for exactly that reason).
export function getAccountDeletionPreview(options) {
    return apiRequest('/account/deletion-preview', authenticated(options))
}

export function requestAccountDeletion(body, options) {
    return apiRequest('/account/deletion-request', authenticated({ ...options, method: 'POST', body }))
}
