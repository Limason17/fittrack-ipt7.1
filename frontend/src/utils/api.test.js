// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notifySessionInvalidated = vi.fn()
const setAccessToken = vi.fn()
const safeInternalRedirect = vi.fn((value) => value)

vi.mock('./auth', () => ({ notifySessionInvalidated, setAccessToken, safeInternalRedirect }))

describe('apiRequest authorization failures', () => {
  beforeEach(() => {
    notifySessionInvalidated.mockReset()
    setAccessToken.mockReset()
    safeInternalRedirect.mockClear()
    vi.resetModules()
    global.fetch = vi.fn()
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
