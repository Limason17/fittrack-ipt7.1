// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refreshAccessToken = vi.fn()
const apiRequest = vi.fn()

vi.mock('./api', () => ({ refreshAccessToken, apiRequest }))

describe('Stage 3B2: memory-only access token', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
    refreshAccessToken.mockReset()
    apiRequest.mockReset()
  })

  it('starts with authToken/authUser both null - never seeded from localStorage or sessionStorage', async () => {
    localStorage.setItem('fittrack_token', 'a-leftover-token-from-before-stage-3b2')
    localStorage.setItem('fittrack_user', JSON.stringify({ id: 1 }))

    const { authToken, authUser } = await import('./auth')

    expect(authToken.value).toBeNull()
    expect(authUser.value).toBeNull()
  })

  it('removes any pre-existing legacy token/user keys from localStorage on first load', async () => {
    localStorage.setItem('fittrack_token', 'a-leftover-token-from-before-stage-3b2')
    localStorage.setItem('fittrack_user', JSON.stringify({ id: 1 }))

    await import('./auth')

    expect(localStorage.getItem('fittrack_token')).toBeNull()
    expect(localStorage.getItem('fittrack_user')).toBeNull()
  })

  it('saveAuth never writes the token or user to localStorage or sessionStorage', async () => {
    const { saveAuth } = await import('./auth')
    saveAuth('super-secret-access-token-value', { id: 1, username: 'demo' })

    expect(localStorage.getItem('fittrack_token')).toBeNull()
    expect(sessionStorage.getItem('fittrack_token')).toBeNull()
    expect(JSON.stringify(localStorage)).not.toContain('super-secret-access-token-value')
    expect(JSON.stringify(sessionStorage)).not.toContain('super-secret-access-token-value')
  })
})

describe('Stage 3B2: ensureAuthBootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    refreshAccessToken.mockReset()
    apiRequest.mockReset()
  })

  it('skips the network refresh entirely when a token is already present in memory', async () => {
    const { authToken, ensureAuthBootstrap, setAccessToken } = await import('./auth')
    setAccessToken('already-logged-in-token')

    await ensureAuthBootstrap()

    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(authToken.value).toBe('already-logged-in-token')
  })

  it('on a successful refresh, populates both the access token and the user profile', async () => {
    refreshAccessToken.mockResolvedValue('fresh-access-token')
    apiRequest.mockResolvedValue({ id: 7, username: 'restored' })

    const { authToken, authUser, ensureAuthBootstrap } = await import('./auth')
    await ensureAuthBootstrap()

    expect(authToken.value).toBe('fresh-access-token')
    expect(authUser.value).toEqual({ id: 7, username: 'restored' })
    expect(apiRequest).toHaveBeenCalledWith('/users/me', { token: 'fresh-access-token', notifyOnFailure: false })
  })

  it('on a failed refresh (no valid session cookie), leaves the app in a clean logged-out state', async () => {
    refreshAccessToken.mockRejectedValue(new Error('no refresh cookie'))

    const { authToken, authUser, ensureAuthBootstrap } = await import('./auth')
    await ensureAuthBootstrap()

    expect(authToken.value).toBeNull()
    expect(authUser.value).toBeNull()
  })

  it('is memoized: calling it many times only ever attempts one refresh', async () => {
    let resolveRefresh
    refreshAccessToken.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve }))
    apiRequest.mockResolvedValue({ id: 1 })

    const { ensureAuthBootstrap } = await import('./auth')
    const first = ensureAuthBootstrap()
    const second = ensureAuthBootstrap()
    const third = ensureAuthBootstrap()

    resolveRefresh('token-value')
    await Promise.all([first, second, third])

    expect(refreshAccessToken).toHaveBeenCalledOnce()
  })
})

describe('Stage 3B2: cross-tab session sync (BroadcastChannel)', () => {
  let postedMessages

  beforeEach(() => {
    vi.resetModules()
    refreshAccessToken.mockReset()
    apiRequest.mockReset()
    postedMessages = []

    class FakeBroadcastChannel {
      constructor(name) {
        this.name = name
        FakeBroadcastChannel.instances.push(this)
      }
      postMessage(message) {
        postedMessages.push(message)
      }
      close() {}
    }
    FakeBroadcastChannel.instances = []
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('never puts a token value on the broadcast channel for logout, logout-all, or session-invalidated', async () => {
    apiRequest.mockResolvedValue({ message: 'ok' })
    const { logout, logoutAll, notifySessionInvalidated, setAccessToken } = await import('./auth')

    setAccessToken('a-secret-access-token-value')
    await logout()
    setAccessToken('another-secret-access-token-value')
    await logoutAll()
    notifySessionInvalidated()

    expect(postedMessages.length).toBeGreaterThan(0)
    for (const message of postedMessages) {
      expect(JSON.stringify(message)).not.toContain('secret-access-token-value')
      expect(Object.keys(message)).toEqual(['type'])
    }
    expect(postedMessages.map((m) => m.type)).toEqual(['logout', 'logout-all', 'session-invalidated'])
  })

  it('reacts to a logout message from another tab by clearing local state, without any HTTP call of its own', async () => {
    const auth = await import('./auth')
    auth.setAccessToken('local-token')
    auth.authUser.value = { id: 1 }

    const [ownChannel] = globalThis.BroadcastChannel.instances
    ownChannel.onmessage({ data: { type: 'logout' } })

    expect(auth.authToken.value).toBeNull()
    expect(auth.authUser.value).toBeNull()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('reacts to a session-invalidated message from another tab the same way', async () => {
    const auth = await import('./auth')
    auth.setAccessToken('local-token')

    const [ownChannel] = globalThis.BroadcastChannel.instances
    ownChannel.onmessage({ data: { type: 'session-invalidated' } })

    expect(auth.authToken.value).toBeNull()
  })

  it('reacts to a login message from another tab by re-attempting its own bootstrap', async () => {
    refreshAccessToken.mockResolvedValue('picked-up-from-other-tab')
    apiRequest.mockResolvedValue({ id: 9 })
    const auth = await import('./auth')

    const [ownChannel] = globalThis.BroadcastChannel.instances
    ownChannel.onmessage({ data: { type: 'login' } })
    // The listener fires the bootstrap without awaiting it internally -
    // give its promise chain a chance to settle.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
    await Promise.resolve()

    expect(refreshAccessToken).toHaveBeenCalled()
    expect(auth.authToken.value).toBe('picked-up-from-other-tab')
  })
})
