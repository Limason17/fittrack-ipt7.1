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
// compromised for a completely legitimate reason.
//
// A prior version of this file used only a localStorage "check existing key,
// then write" pattern as the mutex. That is NOT an atomic exclusivity
// guarantee across separate tab processes: two tabs can both read "no lock"
// before either has written, both then write (the second silently
// overwrites the first), and both then believe - via their own read-back -
// that they, personally, are holding a fresh lock they just wrote. That let
// two real /auth/refresh requests race the same not-yet-rotated cookie,
// which is exactly the legitimate-reuse-detection false positive this
// module exists to prevent. See docs/STAGE_3C_PILOT_UX_POLISH.md for the
// full root-cause writeup and docs/STAGE_3B2_SESSION_HARDENING.md for the
// original (superseded) design rationale.
//
// Primary mechanism: the Web Locks API (navigator.locks), a browser-native
// exclusive lock shared across every tab/worker of the same origin. Unlike
// the old localStorage pattern, the browser itself queues callers and only
// ever runs one lock holder's callback at a time - there is no read-then-
// write window to race. The lock is also released automatically if the
// holding tab is closed or navigates away mid-request, so an aborted tab
// can never leave the others permanently blocked.
const REFRESH_LOCK_NAME = 'fittrack-refresh-lock'

// Fallback-only signaling for browsers without navigator.locks: never
// carries a token, cookie, or any other secret - only an opaque "something
// changed, worth re-checking" nudge. The exclusivity guarantee itself comes
// from the lock (Web Locks, or the fallback algorithm below); this channel
// is purely a latency optimization so a waiting tab does not have to sit
// out its full backoff window once the holder has actually finished.
const refreshCoordinationChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('fittrack-refresh-coordination')
    : null

function supportsWebLocks() {
    return typeof navigator !== 'undefined' &&
        navigator.locks &&
        typeof navigator.locks.request === 'function'
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitter(minMs, maxMs) {
    return minMs + Math.random() * (maxMs - minMs)
}

function waitForLockReleaseSignal(timeoutMs) {
    if (!refreshCoordinationChannel) return delay(timeoutMs)
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
            if (event.data?.type === 'refresh-lock-released') finish()
        }
        refreshCoordinationChannel.addEventListener('message', onMessage)
        const timer = setTimeout(finish, timeoutMs)
    })
}

// ---- Fallback lock (only used when navigator.locks is unavailable) ----
//
// localStorage has no compare-and-swap primitive, so this can never be as
// airtight as a real browser lock - it is a defensive fallback, not a
// second primary mechanism. Every property the fallback needs was named
// explicitly: a unique owner id, a lease expiry (so a crashed/closed tab's
// stale entry cannot block forever), a generation/fencing counter, a
// candidate write followed by a short randomized settle delay and a
// read-back to catch a same-tick double-write, jittered retry with backoff
// instead of a tight spin loop, and - the most important guard - ownership
// is verified *again*, immediately before the caller is allowed to run its
// network request. A lock this code "acquired" a few milliseconds ago is
// never, by itself, treated as sufficient permission to proceed.
const FALLBACK_LOCK_KEY = 'fittrack_refresh_lock'
const FALLBACK_LOCK_LEASE_MS = 5000
const FALLBACK_MAX_ATTEMPTS = 8
const FALLBACK_SETTLE_DELAY_MS = [8, 20]
const FALLBACK_RETRY_BACKOFF_MS = [25, 90]
const FALLBACK_WAIT_FOR_HOLDER_MS = 250

function readFallbackLock() {
    if (typeof localStorage === 'undefined') return null
    try {
        const raw = localStorage.getItem(FALLBACK_LOCK_KEY)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

function writeFallbackLock(record) {
    if (typeof localStorage === 'undefined') return false
    try {
        localStorage.setItem(FALLBACK_LOCK_KEY, JSON.stringify(record))
        return true
    } catch {
        return false
    }
}

function clearFallbackLockIfOwner(ownerId) {
    if (typeof localStorage === 'undefined') return
    const current = readFallbackLock()
    if (current?.owner === ownerId) {
        try {
            localStorage.removeItem(FALLBACK_LOCK_KEY)
        } catch {
            // Storage may be unavailable - the lease-expiry check on the
            // next attempt is the safety net either way.
        }
    }
}

function isFallbackLockLive(record) {
    return Boolean(record) &&
        typeof record.ts === 'number' &&
        Date.now() - record.ts < FALLBACK_LOCK_LEASE_MS
}

function randomLockOwnerId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

// Best-effort acquisition: write a candidate, then re-read after a short
// random delay to see whether a concurrent writer clobbered it. Returns the
// held { ownerId, generation } or null if every attempt in this call lost
// the race or found a live lease the whole time.
async function acquireFallbackLock() {
    for (let attempt = 0; attempt < FALLBACK_MAX_ATTEMPTS; attempt += 1) {
        const existing = readFallbackLock()
        if (isFallbackLockLive(existing)) {
            await Promise.race([
                waitForLockReleaseSignal(FALLBACK_WAIT_FOR_HOLDER_MS),
                delay(FALLBACK_WAIT_FOR_HOLDER_MS),
            ])
            continue
        }
        const ownerId = randomLockOwnerId()
        const generation = (existing?.generation ?? 0) + 1
        if (!writeFallbackLock({ owner: ownerId, ts: Date.now(), generation })) return null
        await delay(jitter(...FALLBACK_SETTLE_DELAY_MS))
        const confirmed = readFallbackLock()
        if (confirmed?.owner === ownerId && confirmed?.generation === generation) {
            return { ownerId, generation }
        }
        await delay(jitter(...FALLBACK_RETRY_BACKOFF_MS) * (attempt + 1))
    }
    return null
}

function verifyFallbackOwnership(ownerId, generation) {
    const current = readFallbackLock()
    return current?.owner === ownerId && current?.generation === generation
}

async function withFallbackRefreshLock(fn) {
    // No storage to coordinate through at all (not even the localStorage
    // pattern's best-effort guard is available - e.g. a strict privacy mode
    // that throws on every access, or a non-browser runtime). There is no
    // possible cross-tab signal in that case, coordinated or not, so the
    // only sound behaviour is to proceed directly rather than spin through
    // acquisition attempts that can never succeed.
    if (typeof localStorage === 'undefined') {
        return fn()
    }
    for (let cycle = 0; cycle < FALLBACK_MAX_ATTEMPTS; cycle += 1) {
        const held = await acquireFallbackLock()
        if (!held) continue
        const { ownerId, generation } = held
        // Re-verify immediately before the network request - the acquire
        // step above is best-effort, not a guarantee, so nothing may run
        // against the network on its authority alone.
        if (!verifyFallbackOwnership(ownerId, generation)) {
            await delay(jitter(...FALLBACK_RETRY_BACKOFF_MS))
            continue
        }
        try {
            return await fn()
        } finally {
            clearFallbackLockIfOwner(ownerId)
            refreshCoordinationChannel?.postMessage({ type: 'refresh-lock-released' })
        }
    }
    throw new Error('Unable to acquire the refresh coordination lock.')
}

// Exposed only for direct, deterministic testing of the fallback lock's
// individual guarantees (owner id, lease expiry, generation/fencing, the
// re-verify-before-network-request check) in isolation from real timing -
// see api.test.js. Not part of the module's normal public surface.
export const __testing__ = {
    FALLBACK_LOCK_KEY,
    FALLBACK_LOCK_LEASE_MS,
    acquireFallbackLock,
    verifyFallbackOwnership,
    readFallbackLock,
    clearFallbackLockIfOwner,
    withFallbackRefreshLock,
    supportsWebLocks,
}

// Exported primarily so the cross-tab locking semantics themselves (not
// just the end-to-end apiRequest/refreshAccessToken surface) are directly
// unit-testable - see api.test.js. Every tab that calls this - whichever
// one ends up running fn() first, and every one that was waiting - runs fn
// in turn, never overlapping: the "loser" of the initial race is not
// skipped, it is queued, and gets its turn (with whatever the lock state
// looks like *then*, e.g. an already-rotated cookie) once the current
// holder's fn() has fully settled.
export async function withCrossTabRefreshLock(fn) {
    if (supportsWebLocks()) {
        // The browser itself queues concurrent requests for the same lock
        // name and runs exactly one callback at a time, releasing it only
        // once that callback's returned promise settles - i.e. only after
        // performRefresh() below has already awaited the full response
        // (including the browser having applied any Set-Cookie header).
        // There is deliberately no separate "notify other tabs" step here:
        // the lock's own release *is* that signal, atomically.
        return navigator.locks.request(REFRESH_LOCK_NAME, fn)
    }
    return withFallbackRefreshLock(fn)
}

async function coordinatedRefresh() {
    return withCrossTabRefreshLock(performRefresh)
}

// AbortController timeout bounds how long a single refresh attempt can hold
// the cross-tab lock: navigator.locks already releases automatically if the
// holding tab closes, but a merely-hung request (server unreachable, network
// stalled) would otherwise never resolve fn() and could block every other
// waiting tab indefinitely. 8s comfortably exceeds a normal round trip.
const REFRESH_REQUEST_TIMEOUT_MS = 8000

async function performRefresh() {
    const csrf = readCookie(CSRF_COOKIE_NAME)
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), REFRESH_REQUEST_TIMEOUT_MS) : null
    let response
    try {
        response = await fetch(joinApiUrl(API_BASE_URL, '/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}),
            },
            signal: controller?.signal,
        })
    } finally {
        if (timer) clearTimeout(timer)
    }

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
