import { ref } from 'vue'

// Rejects a backslash (Windows-style path separator confusion) or any ASCII
// control character (0x00-0x1F, or DEL 0x7F) in a redirect target. Written
// as explicit char-code comparisons rather than a regex with \u escapes -
// those escapes are easy to accidentally transcribe as literal raw control
// bytes instead of the intended source text, which would silently corrupt
// this security check.
function containsBackslashOrControlChar(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code === 0x5c || code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

// Stage 3B2: the access token now lives ONLY in this in-memory ref - never
// localStorage, sessionStorage, a cookie readable by JS, or a URL. A hard
// page reload always starts with authToken.value === null; ensureAuthBootstrap()
// below is what lets a real returning session recover from that via the
// HttpOnly refresh cookie, instead of every reload looking logged-out.
export const authToken = ref(null)
export const authUser = ref(null)

// One-time migration off the pre-Stage-3B2 storage model: a browser that
// still has an old token/user pair sitting in localStorage or sessionStorage
// (from before this rewrite shipped) must not keep it around indefinitely -
// it is never read or used, only removed.
const LEGACY_STORAGE_KEYS = ['fittrack_token', 'fittrack_user']
for (const storage of [
  typeof localStorage === 'undefined' ? null : localStorage,
  typeof sessionStorage === 'undefined' ? null : sessionStorage,
]) {
  if (!storage) continue
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      storage.removeItem(key)
    } catch {
      // Storage may be unavailable (privacy mode, disabled cookies) - safe
      // to ignore, since there is nothing to migrate off of in that case.
    }
  }
}

const cleanupHandlers = new Set()
const SESSION_CHANNEL_NAME = 'fittrack-session'

// Never put a token value on this channel - see the listener below. Only
// bare event-type messages ever cross it.
const sessionChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel(SESSION_CHANNEL_NAME)
  : null

function broadcast(type) {
  sessionChannel?.postMessage({ type })
}

export function setAccessToken(token) {
  authToken.value = token || null
}

export function saveAuth(token, user) {
  runAuthCleanup()
  authToken.value = token
  authUser.value = user
}

export function updateAuthUser(updates) {
  if (!authUser.value) {
    return
  }
  authUser.value = { ...authUser.value, ...updates }
}

export function getToken() {
  return authToken.value
}

export function getUser() {
  return authUser.value
}

export function isLoggedIn() {
  return !!authToken.value
}

export function isSafeInternalRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return false
  }

  if (containsBackslashOrControlChar(value)) {
    return false
  }

  try {
    const origin = typeof window === 'undefined' ? 'https://fittrack.invalid' : window.location.origin
    const target = new URL(value, origin)
    return target.origin === origin && target.pathname.startsWith('/')
  } catch {
    return false
  }
}

export function safeInternalRedirect(value, fallback = '/') {
  return isSafeInternalRedirect(value) ? value : fallback
}

export function registerAuthCleanup(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('Auth cleanup handler must be a function.')
  }
  cleanupHandlers.add(handler)
  return () => cleanupHandlers.delete(handler)
}

function runAuthCleanup() {
  for (const handler of cleanupHandlers) {
    handler()
  }
}

// Clears only local state - no network call. Used both by logout()/logoutAll()
// after their server call settles (success or failure - the server-side
// session may already be gone either way) and by the cross-tab listener
// below, which must never trigger a second HTTP call of its own.
export function clearAuthState() {
  authToken.value = null
  authUser.value = null
  runAuthCleanup()
}

if (sessionChannel) {
  sessionChannel.onmessage = (event) => {
    const type = event?.data?.type
    if (type === 'logout' || type === 'logout-all' || type === 'session-invalidated') {
      clearAuthState()
    } else if (type === 'login') {
      // Another tab just established a session - re-run our own bootstrap
      // so this tab picks it up too, without requiring a manual reload.
      // ensureAuthBootstrap() is memoized per this module instance, so reset
      // it first to force a fresh attempt.
      bootstrapPromise = null
      ensureAuthBootstrap()
    }
  }
}

// ---- Server-side session lifecycle (refresh/logout/logout-all) ----
//
// These deliberately import from ./api lazily-at-call-time (not destructured
// at module top level) to keep the auth.js <-> api.js circular import safe:
// api.js needs clearAuthState/setAccessToken from here for its own 401/
// refresh handling, and this module needs api.js's fetch helpers for
// refresh/logout. Neither side calls into the other at module-evaluation
// time, only from inside functions invoked later (component code, HTTP
// responses) - by then both modules have finished loading.

let bootstrapPromise = null

// Called once by the router guard before the first navigation decision.
// A hard reload always starts logged-out in memory; this is what lets a
// real returning session (proven by the HttpOnly refresh cookie the browser
// still holds) resolve back to logged-in before any route renders.
export function ensureAuthBootstrap() {
  if (!bootstrapPromise) {
    // If an access token is already present in memory (a fresh login just
    // happened, or a caller pre-seeded state), there is nothing to
    // bootstrap - skip the network round trip entirely rather than
    // attempting a redundant refresh.
    if (authToken.value) {
      bootstrapPromise = Promise.resolve()
    } else {
      bootstrapPromise = (async () => {
        const api = await import('./api')
        try {
          const token = await api.refreshAccessToken()
          setAccessToken(token)
          const user = await api.apiRequest('/users/me', { token, notifyOnFailure: false })
          authUser.value = user
        } catch {
          clearAuthState()
        }
      })()
    }
  }
  return bootstrapPromise
}

// Never throws: this is a best-effort server-side revocation. Local state
// ends up cleared either way, so a caller (e.g. ProfileView's password-change
// flow, which also calls this for cleanup after a change that already
// revoked every session server-side) never has to distinguish "the logout
// call failed" from "there was nothing left to revoke" - both look the same
// from here on out, and neither should ever surface as a user-facing error.
export async function logout() {
  const api = await import('./api')
  try {
    await api.apiRequest('/auth/logout', {
      method: 'POST',
      token: authToken.value,
      useAuthCookies: true,
      notifyOnFailure: false,
    })
  } catch {
    // Session may already be gone server-side (expired, revoked elsewhere,
    // or just revoked by the very account change that called this) - fine.
  } finally {
    clearAuthState()
    broadcast('logout')
  }
}

export async function logoutAll() {
  const api = await import('./api')
  try {
    await api.apiRequest('/auth/logout-all', {
      method: 'POST',
      token: authToken.value,
      useAuthCookies: true,
      notifyOnFailure: false,
    })
  } catch {
    // Same rationale as logout() above.
  } finally {
    clearAuthState()
    broadcast('logout-all')
  }
}

export function notifySessionInvalidated() {
  clearAuthState()
  broadcast('session-invalidated')
}

export function notifyLoggedIn() {
  broadcast('login')
}
