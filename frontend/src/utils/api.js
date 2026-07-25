import { safeInternalRedirect } from './auth'

export const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || '/api'

// Matches the backend's default AUTH_CSRF_COOKIE_NAME (config/sessionConfig.js).
// If a deployment customizes that env var, this constant must be updated to
// match - there is no runtime discovery mechanism for a non-HttpOnly cookie
// name, so the two sides are kept in sync by convention, like the cookie
// path/name contract documented in docs/STAGE_3B2_SESSION_HARDENING.md.
const CSRF_COOKIE_NAME = 'fittrack_csrf'
const CSRF_HEADER_NAME = 'X-CSRF-Token'

// Endpoints that either authenticate via the HttpOnly refresh cookie or
// (login) issue it in their response - all need credentials:'include' so
// the browser sends/stores that cookie even when the frontend and API are
// on different origins/ports (a cross-origin response's Set-Cookie is
// otherwise silently dropped). refresh/logout/logout-all additionally need
// the CSRF header (see security/csrfGuard.js on the backend); login does
// not (no session/CSRF cookie exists yet at that point). Every other
// endpoint keeps using plain Authorization: Bearer exactly as before Stage 3B2.
const AUTH_COOKIE_PATHS = new Set(['/users/login', '/auth/refresh', '/auth/logout', '/auth/logout-all'])

export function joinApiUrl(baseUrl, path) {
    const base = String(baseUrl ?? '').trim()
    const pathPart = String(path ?? '').trim()
    const normalizedBase = base === '/' ? '' : base.replace(/\/+$/, '')
    const normalizedPath = `/${pathPart.replace(/^\/+/, '')}`

    return `${normalizedBase}${normalizedPath}`
}

export function replaceWithLogin(location) {
    if (!location || typeof location.replace !== 'function') return
    const currentPath = `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`
    const redirect = encodeURIComponent(safeInternalRedirect(currentPath))
    location.replace(`/login?redirect=${redirect}`)
}

function readCookie(name) {
    if (typeof document === 'undefined' || !document.cookie) return null
    for (const entry of document.cookie.split('; ')) {
        const separator = entry.indexOf('=')
        if (separator === -1) continue
        if (entry.slice(0, separator) === name) {
            return decodeURIComponent(entry.slice(separator + 1))
        }
    }
    return null
}

// Single-flight WITHIN one tab: every concurrent caller during one in-flight
// refresh shares the SAME promise/network call, instead of each firing its
// own POST /auth/refresh - the backend's rotation is single-use, so N
// parallel refresh calls for the same session would mean only one could
// succeed and the rest would be treated as reuse (see
// services/sessionService.js's rotateRefreshToken), locking the user out.
// Pure network operation: it does not itself update authToken - every
// caller (ensureAuthBootstrap, apiRequest's own 401 handling below) does
// that explicitly with whatever it receives back.
let refreshPromise = null

export function refreshAccessToken() {
    if (!refreshPromise) {
        refreshPromise = coordinatedRefresh().finally(() => {
            refreshPromise = null
        })
    }
    return refreshPromise
}

// Cross-tab coordination on top of the single-flight above: two tabs of the
// SAME browser context share one cookie jar, so a hard reload/401 in BOTH
// at nearly the same moment would otherwise fire two independent POST
// /auth/refresh calls against the same not-yet-rotated cookie - the losing
// tab's call is indistinguishable, server-side, from a real stolen-token
// replay (see rotateRefreshToken's reuse-detection) and gets its session
// compromised for a completely legitimate reason. This is a best-effort
// mutex, not a formally atomic distributed lock: it never carries a token
// value (see REFRESH_LOCK_KEY below - just an opaque per-attempt id), and a
// residual race on the exact same millisecond is possible but no worse than
// having no coordination at all. Deliberately simple - see
// docs/STAGE_3B2_SESSION_HARDENING.md for why a heavier scheme was not
// warranted here.
const REFRESH_LOCK_KEY = 'fittrack_refresh_lock'
const REFRESH_LOCK_STALE_MS = 5000
const REFRESH_LOCK_WAIT_TIMEOUT_MS = 4000

const refreshCoordinationChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('fittrack-refresh-coordination')
    : null

function readRefreshLock() {
    if (typeof localStorage === 'undefined') return null
    try {
        const raw = localStorage.getItem(REFRESH_LOCK_KEY)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

function isLockStale(lock) {
    return !lock || typeof lock.ts !== 'number' || Date.now() - lock.ts > REFRESH_LOCK_STALE_MS
}

// Compare-after-write: write our own id, then read it back. If a different
// tab wrote in between, we lose and see their id instead of ours. Not
// atomic, but sufficient for coordinating tabs of the same legitimate user
// rather than adversarial processes.
function tryAcquireRefreshLock() {
    if (typeof localStorage === 'undefined') return null
    const existing = readRefreshLock()
    if (existing && !isLockStale(existing)) return null
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
        localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({ id, ts: Date.now() }))
    } catch {
        return null
    }
    return readRefreshLock()?.id === id ? id : null
}

function releaseRefreshLock(id) {
    if (typeof localStorage !== 'undefined') {
        const current = readRefreshLock()
        if (current?.id === id) {
            try {
                localStorage.removeItem(REFRESH_LOCK_KEY)
            } catch {
                // Storage may be unavailable - the staleness check on the
                // next attempt is the fallback safety net either way.
            }
        }
    }
    refreshCoordinationChannel?.postMessage({ type: 'refresh-settled' })
}

function waitForRefreshSettled(timeoutMs) {
    if (!refreshCoordinationChannel) {
        return new Promise((resolve) => setTimeout(resolve, timeoutMs))
    }
    return new Promise((resolve) => {
        let settled = false
        const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            refreshCoordinationChannel.removeEventListener('message', onMessage)
            resolve()
        }
        const onMessage = (event) => {
            if (event.data?.type === 'refresh-settled') finish()
        }
        refreshCoordinationChannel.addEventListener('message', onMessage)
        const timer = setTimeout(finish, timeoutMs)
    })
}

async function coordinatedRefresh() {
    const lockId = tryAcquireRefreshLock()
    if (!lockId) {
        // Another tab is already refreshing this shared session - wait for
        // it to settle (or time out) instead of racing it with our own call
        // against the same cookie. By the time we retry, the browser's
        // cookie jar already reflects whatever that other tab's refresh
        // left behind, so our own call rotates it again legitimately.
        await waitForRefreshSettled(REFRESH_LOCK_WAIT_TIMEOUT_MS)
        return performRefresh()
    }
    try {
        return await performRefresh()
    } finally {
        releaseRefreshLock(lockId)
    }
}

async function performRefresh() {
    const csrf = readCookie(CSRF_COOKIE_NAME)
    const response = await fetch(joinApiUrl(API_BASE_URL, '/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}),
        },
    })

    if (!response.ok) {
        const error = new Error('Session refresh failed.')
        error.status = response.status
        throw error
    }

    const data = await response.json()
    return data.accessToken
}

export async function apiRequest(path, options = {}) {
    const {
        method = 'GET',
        body,
        signal,
        token,
        useAuthCookies = false,
        notifyOnFailure = true,
        _isRetry = false,
    } = options
    const headers = {
        Accept: 'application/json',
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
    }

    if (token) {
        headers.Authorization = `Bearer ${token}`
    }

    const isAuthCookieCall = useAuthCookies || AUTH_COOKIE_PATHS.has(path)
    if (isAuthCookieCall && method !== 'GET') {
        const csrf = readCookie(CSRF_COOKIE_NAME)
        if (csrf) headers[CSRF_HEADER_NAME] = csrf
    }

    const response = await fetch(joinApiUrl(API_BASE_URL, path), {
        method,
        headers,
        signal,
        credentials: isAuthCookieCall ? 'include' : 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await response.text()
    let data = null

    if (text) {
        try {
            data = JSON.parse(text)
        } catch (error) {
            data = { message: text }
        }
    }

    if (!response.ok) {
        // A silent refresh-and-retry only ever makes sense for a call that
        // had a token to begin with and is not itself already a retry (at
        // most one retry per original request). This also covers logout/
        // logout-all: retrying them after a successful refresh means a
        // logout clicked with a just-expired access token still reaches the
        // server and actually revokes the session, instead of only clearing
        // local state. /auth/refresh itself is never reached through this
        // function at all (see performRefresh above), so there is no
        // recursion risk to guard against here.
        if (token && response.status === 401 && !_isRetry) {
            try {
                const newToken = await refreshAccessToken()
                const auth = await import('./auth')
                auth.setAccessToken(newToken)
                return apiRequest(path, { ...options, token: newToken, _isRetry: true })
            } catch {
                // notifyOnFailure=false is used by auth.js's own calls
                // (logout, logout-all, the bootstrap's /users/me hydration)
                // - each of those already has its own complete failure
                // handling and its own decision about what the UI does next
                // (see auth.js). Forcing a second, generic hard redirect
                // here on top of that caused a real bug: ProfileView's
                // password-change flow calls logout() then explicitly
                // navigates to /login itself, and this fallback's
                // replaceWithLogin() raced it with the CURRENT (stale)
                // location, producing .../login?redirect=%2Fprofile instead
                // of the intended bare /login.
                if (notifyOnFailure) {
                    const auth = await import('./auth')
                    auth.notifySessionInvalidated()
                    if (typeof window !== 'undefined') replaceWithLogin(window.location)
                }
            }
        }

        const error = new Error(data?.error?.message || data?.message || response.statusText)
        error.status = response.status
        error.data = data
        throw error
    }

    return data
}
