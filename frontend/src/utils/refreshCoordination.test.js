// @vitest-environment jsdom
//
// Simulates two browser tabs of the same origin sharing one localStorage
// and one BroadcastChannel namespace (both real jsdom globals, not mocked)
// but with two SEPARATE module instances of api.js (via vi.resetModules()
// between imports) - each tab has its own JS realm/module registry in a
// real browser, so each must get its own `refreshPromise`/lock-attempt
// state, exactly like this.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  notifySessionInvalidated: vi.fn(),
  setAccessToken: vi.fn(),
  safeInternalRedirect: (value) => value,
}))

async function freshApiModule() {
  vi.resetModules()
  return import('./api')
}

describe('Stage 3B2: cross-tab refresh coordination', () => {
  let fetchCalls

  beforeEach(() => {
    localStorage.clear()
    fetchCalls = []
    global.fetch = vi.fn(async (url) => {
      fetchCalls.push(String(url))
      return new Response(JSON.stringify({ accessToken: `token-${fetchCalls.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a second tab starting a refresh while the first still holds the lock does not fetch immediately - it waits', async () => {
    const tabA = await freshApiModule()
    const tabB = await freshApiModule()

    let resolveTabAFetch
    global.fetch = vi.fn((url) => {
      fetchCalls.push(String(url))
      return new Promise((resolve) => { resolveTabAFetch = resolve })
    })

    const tabAPromise = tabA.refreshAccessToken()
    // Unlike the old synchronous check-then-write mutex, the hardened
    // fallback lock's acquisition involves a real settle delay and a
    // read-back before it is trusted (see acquireFallbackLock in api.js) -
    // give tabA's acquisition a real window to actually complete and reach
    // fetch(), not just a couple of microtask ticks.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fetchCalls.length).toBe(1)

    let tabBSettled = false
    const tabBPromise = tabB.refreshAccessToken().then((value) => { tabBSettled = true; return value })
    // Give tabB's own acquisition attempt(s) a real window to run - it must
    // keep observing tabA's still-live lock and back off, never reaching
    // its own fetch call while tabA is still the holder.
    await new Promise((resolve) => setTimeout(resolve, 150))

    // TabB must not have issued its own fetch yet - it is waiting on tabA.
    expect(fetchCalls.length).toBe(1)
    expect(tabBSettled).toBe(false)

    resolveTabAFetch(new Response(JSON.stringify({ accessToken: 'from-tab-a' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const tabAToken = await tabAPromise

    // Once tabA's lock releases and broadcasts, tabB proceeds with its own
    // (now legitimate, non-racing) refresh call.
    global.fetch = vi.fn(async (url) => {
      fetchCalls.push(String(url))
      return new Response(JSON.stringify({ accessToken: 'from-tab-b' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const tabBToken = await tabBPromise

    expect(tabAToken).toBe('from-tab-a')
    expect(tabBToken).toBe('from-tab-b')
  })

  it('a stale lock (e.g. from a crashed/closed tab) is not honored forever - a later tab can still refresh', async () => {
    localStorage.setItem('fittrack_refresh_lock', JSON.stringify({ owner: 'stale-attempt', ts: Date.now() - 60_000, generation: 1 }))

    const tab = await freshApiModule()
    const token = await tab.refreshAccessToken()

    expect(token).toBe('token-1')
    expect(fetchCalls.length).toBe(1)
  })

  it('the refresh lock never contains a token, cookie, or access-token-shaped value', async () => {
    const tab = await freshApiModule()
    let resolveFetch
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))

    const promise = tab.refreshAccessToken()
    // Give the fallback lock's write + settle delay + read-back time to
    // actually land before inspecting localStorage.
    await new Promise((resolve) => setTimeout(resolve, 40))

    const rawLock = localStorage.getItem('fittrack_refresh_lock')
    expect(rawLock).toBeTruthy()
    const parsed = JSON.parse(rawLock)
    expect(Object.keys(parsed).sort()).toEqual(['generation', 'owner', 'ts'])
    expect(/[A-Za-z0-9_-]{43}/.test(rawLock)).toBe(false)

    resolveFetch(new Response(JSON.stringify({ accessToken: 'irrelevant' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await promise
    expect(localStorage.getItem('fittrack_refresh_lock')).toBeNull()
  })
})
