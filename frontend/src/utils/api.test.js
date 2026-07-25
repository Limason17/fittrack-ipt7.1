// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifySessionInvalidated = vi.fn()
const setAccessToken = vi.fn()
const safeInternalRedirect = vi.fn((value) => value)

vi.mock('./auth', () => ({ notifySessionInvalidated, setAccessToken, safeInternalRedirect }))

// Plain Node (this file's environment) has neither navigator.locks nor
// localStorage as globals, unlike every real browser this module actually
// runs in. Without a localStorage stub, api.js's cross-tab fallback lock
// cannot coordinate at all and intentionally degrades to "just run the
// refresh directly" (see withFallbackRefreshLock) - which exercises none of
// its actual locking logic. This minimal, synchronous, Map-backed stub lets
// the real fallback algorithm run in tests instead, the same way it would
// in a browser without Web Locks support.
function createMemoryStorage() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

describe('apiRequest authorization failures', () => {
  beforeEach(() => {
    notifySessionInvalidated.mockReset()
    setAccessToken.mockReset()
    safeInternalRedirect.mockClear()
    vi.resetModules()
    global.fetch = vi.fn()
    global.localStorage = createMemoryStorage()
  })

  it('attempts exactly one silent refresh, then clears the session when that also fails (401)', async () => {
    // A single mock answering every fetch call (both the original request and
    // the refresh attempt) with 401 - simulates a truly dead session where
    // refreshing cannot help either.
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { apiRequest } = await import('./api')

    await expect(apiRequest('/protected', { token: 'token' })).rejects.toMatchObject({ status: 401 })
    // Original request + one refresh attempt = exactly two fetch calls, no
    // retry loop.
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(notifySessionInvalidated).toHaveBeenCalledOnce()
  })

  it('retries the original request exactly once after a successful silent refresh', async () => {
    global.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'new-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    const { apiRequest } = await import('./api')

    const result = await apiRequest('/protected', { token: 'old-token' })

    expect(result).toEqual({ ok: true })
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(setAccessToken).toHaveBeenCalledWith('new-token')
    expect(notifySessionInvalidated).not.toHaveBeenCalled()
    const retryCall = global.fetch.mock.calls[2]
    expect(retryCall[1].headers.Authorization).toBe('Bearer new-token')
  })

  it('single-flight: two concurrent 401s share exactly one refresh call, not two', async () => {
    let refreshCalls = 0
    // Two independent in-flight requests both discover the same expired
    // token (401 for the initial 'Bearer old-token' attempt), then both
    // must succeed once retried with whatever the ONE refresh call returned.
    global.fetch.mockImplementation((url, init) => {
      const path = String(url)
      if (path.includes('/auth/refresh')) {
        refreshCalls += 1
        return Promise.resolve(new Response(JSON.stringify({ accessToken: 'shared-new-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      void path
      const isRetry = init.headers.Authorization === 'Bearer shared-new-token'
      const status = isRetry ? 200 : 401
      return Promise.resolve(new Response(JSON.stringify(status === 200 ? { ok: true } : { message: 'Unauthorized' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }))
    })

    const { apiRequest } = await import('./api')

    const [first, second] = await Promise.all([
      apiRequest('/protected-a', { token: 'old-token' }),
      apiRequest('/protected-b', { token: 'old-token' }),
    ])

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(refreshCalls).toBe(1)
  })

  it('replaces a sensitive expired-session URL instead of retaining it in history', async () => {
    const { replaceWithLogin } = await import('./api')
    const location = {
      pathname: '/invitations/opaque-token',
      search: '?source=email',
      hash: '',
      replace: vi.fn(),
    }

    replaceWithLogin(location)

    expect(safeInternalRedirect).toHaveBeenCalledWith('/invitations/opaque-token?source=email')
    expect(location.replace).toHaveBeenCalledWith(
      '/login?redirect=%2Finvitations%2Fopaque-token%3Fsource%3Demail'
    )
  })

  it('preserves the session for a permission failure (403)', async () => {
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { apiRequest } = await import('./api')

    await expect(apiRequest('/protected', { token: 'token' })).rejects.toMatchObject({ status: 403 })
    expect(notifySessionInvalidated).not.toHaveBeenCalled()
  })

  it('preserves the session when a Stage 1A studio endpoint returns 403', async () => {
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Forbidden' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { apiRequest } = await import('./api')

    await expect(apiRequest('/v1/studios/studio-a/memberships', { token: 'token' }))
      .rejects.toMatchObject({ status: 403 })
    expect(notifySessionInvalidated).not.toHaveBeenCalled()
  })

  it('uses the structured API error message and keeps legacy message compatibility', async () => {
    const { apiRequest } = await import('./api')

    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The submitted fields are invalid.',
            fields: { email: 'Invalid email' },
            requestId: 'request-123',
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(apiRequest('/validation')).rejects.toMatchObject({
      message: 'The submitted fields are invalid.',
      status: 422,
      data: {
        error: {
          code: 'VALIDATION_ERROR',
          fields: { email: 'Invalid email' },
          requestId: 'request-123',
        },
      },
    })

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Legacy API error' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(apiRequest('/legacy')).rejects.toMatchObject({
      message: 'Legacy API error',
      status: 400,
    })
  })
})

// This environment has neither navigator.locks nor a real localStorage, so
// every withCrossTabRefreshLock() call below exercises the fallback lock
// (see the createMemoryStorage() stub above) unless a test explicitly stubs
// navigator.locks itself. The E2E suite (authSession.spec.js) is what
// proves the primary navigator.locks path in a real browser; these tests
// prove the fallback's own guarantees and the dispatch logic between them.
describe('cross-tab refresh lock', () => {
  beforeEach(() => {
    vi.resetModules()
    global.localStorage = createMemoryStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('two concurrent lock requests have exactly one winner and never run at the same time', async () => {
    const { withCrossTabRefreshLock } = await import('./api')
    let active = 0
    let maxActive = 0
    const run = () => withCrossTabRefreshLock(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return 'done'
    })

    const [a, b] = await Promise.all([run(), run()])

    expect(a).toBe('done')
    expect(b).toBe('done')
    expect(maxActive).toBe(1)
  })

  it('a losing call starts no work of its own until the winner has fully settled, then runs sequentially with its own result', async () => {
    const { withCrossTabRefreshLock } = await import('./api')
    const events = []
    let releaseOwner
    const ownerGate = new Promise((resolve) => { releaseOwner = resolve })

    const ownerPromise = withCrossTabRefreshLock(async () => {
      events.push('owner-start')
      await ownerGate
      events.push('owner-end')
      return 'owner-result'
    })
    // Let the owner actually acquire the lock before the second call starts.
    await new Promise((resolve) => setTimeout(resolve, 10))

    const waiterPromise = withCrossTabRefreshLock(async () => {
      events.push('waiter-start')
      return 'waiter-result'
    })
    // The waiter must not have started its own work yet - it is queued, not
    // racing the owner with its own (stale-cookie) request.
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(events).toEqual(['owner-start'])

    releaseOwner()
    const [ownerResult, waiterResult] = await Promise.all([ownerPromise, waiterPromise])

    expect(ownerResult).toBe('owner-result')
    expect(waiterResult).toBe('waiter-result')
    expect(events).toEqual(['owner-start', 'owner-end', 'waiter-start'])
  })

  it('three concurrent tabs each get their own turn, never more than one active at a time', async () => {
    const { withCrossTabRefreshLock } = await import('./api')
    let active = 0
    let maxActive = 0
    const run = (label) => withCrossTabRefreshLock(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      return label
    })

    const results = await Promise.all([run('a'), run('b'), run('c')])

    expect(results.sort()).toEqual(['a', 'b', 'c'])
    expect(maxActive).toBe(1)
  })

  it('a failed/aborted owner still releases the lock instead of blocking the next call forever', async () => {
    const { withCrossTabRefreshLock } = await import('./api')

    await expect(withCrossTabRefreshLock(async () => {
      throw new Error('owner crashed mid-refresh')
    })).rejects.toThrow('owner crashed mid-refresh')

    const result = await withCrossTabRefreshLock(async () => 'recovered')
    expect(result).toBe('recovered')
  })

  it('a queued waiter still gets its turn after the current owner fails, instead of waiting forever', async () => {
    const { withCrossTabRefreshLock } = await import('./api')
    let releaseOwner
    const ownerGate = new Promise((resolve) => { releaseOwner = resolve })

    const ownerPromise = withCrossTabRefreshLock(async () => {
      await ownerGate
      throw new Error('owner failed')
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const waiterPromise = withCrossTabRefreshLock(async () => 'waiter-succeeded')

    releaseOwner()
    await expect(ownerPromise).rejects.toThrow('owner failed')
    await expect(waiterPromise).resolves.toBe('waiter-succeeded')
  })

  it('fallback lock ownership is re-verified, and a clobbered ownership is correctly reported as no longer valid', async () => {
    const { __testing__ } = await import('./api')
    const held = await __testing__.acquireFallbackLock()

    expect(held).not.toBeNull()
    expect(__testing__.verifyFallbackOwnership(held.ownerId, held.generation)).toBe(true)

    // Simulate a different tab clobbering the lock between this call's own
    // acquisition and whatever it was about to authorize (the network
    // request) - the only thing that matters is that the re-check catches
    // it, not just the original acquisition.
    global.localStorage.setItem(__testing__.FALLBACK_LOCK_KEY, JSON.stringify({
      owner: 'someone-else-tab',
      ts: Date.now(),
      generation: held.generation + 1,
    }))

    expect(__testing__.verifyFallbackOwnership(held.ownerId, held.generation)).toBe(false)
  })

  it('an expired lease can be taken over by a new acquirer', async () => {
    const { __testing__ } = await import('./api')
    global.localStorage.setItem(__testing__.FALLBACK_LOCK_KEY, JSON.stringify({
      owner: 'stale-tab',
      ts: Date.now() - (__testing__.FALLBACK_LOCK_LEASE_MS + 1000),
      generation: 1,
    }))

    const held = await __testing__.acquireFallbackLock()

    expect(held).not.toBeNull()
    expect(held.ownerId).not.toBe('stale-tab')
  })

  it('a live lease is not taken over while it is still within its lease window', async () => {
    const { __testing__ } = await import('./api')
    global.localStorage.setItem(__testing__.FALLBACK_LOCK_KEY, JSON.stringify({
      owner: 'active-tab',
      ts: Date.now(),
      generation: 1,
    }))

    // A bounded race against a short timeout: a live lease well within its
    // lease window must not be acquired quickly - it should still be
    // retrying/backing off when the timeout wins.
    const outcome = await Promise.race([
      __testing__.acquireFallbackLock().then(() => 'acquired'),
      new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 150)),
    ])

    expect(outcome).toBe('still-waiting')
  })

  it('delegates to navigator.locks for exclusivity when the Web Locks API is available', async () => {
    const { withCrossTabRefreshLock } = await import('./api')
    const requestSpy = vi.fn((name, callback) => callback())
    vi.stubGlobal('navigator', { locks: { request: requestSpy } })

    const result = await withCrossTabRefreshLock(async () => 'via-web-locks')

    expect(result).toBe('via-web-locks')
    expect(requestSpy).toHaveBeenCalledWith('fittrack-refresh-lock', expect.any(Function))
  })

  it('never writes a token-shaped value to localStorage or the coordination broadcast channel', async () => {
    const { withCrossTabRefreshLock, __testing__ } = await import('./api')
    const received = []
    const spyChannel = new BroadcastChannel('fittrack-refresh-coordination')
    spyChannel.onmessage = (event) => received.push(event.data)

    let capturedDuringHold
    await withCrossTabRefreshLock(async () => {
      capturedDuringHold = global.localStorage.getItem(__testing__.FALLBACK_LOCK_KEY)
      return 'ok'
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    spyChannel.close()

    expect(capturedDuringHold).toBeTruthy()
    const storedFields = Object.keys(JSON.parse(capturedDuringHold)).sort()
    expect(storedFields).toEqual(['generation', 'owner', 'ts'])
    expect(capturedDuringHold).not.toMatch(/^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/)

    expect(received.length).toBeGreaterThan(0)
    for (const message of received) {
      expect(Object.keys(message)).toEqual(['type'])
      expect(JSON.stringify(message)).not.toMatch(/[A-Za-z0-9_-]{40,}/)
    }
  })
})
