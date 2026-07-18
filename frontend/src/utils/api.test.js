// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logout = vi.fn()
const safeInternalRedirect = vi.fn((value) => value)

vi.mock('./auth', () => ({ logout, safeInternalRedirect }))

describe('apiRequest authorization failures', () => {
  beforeEach(() => {
    logout.mockReset()
    safeInternalRedirect.mockClear()
    vi.resetModules()
    global.fetch = vi.fn()
  })

  it('logs out for an expired or invalid session (401)', async () => {
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { apiRequest } = await import('./api')

    await expect(apiRequest('/protected', { token: 'token' })).rejects.toMatchObject({ status: 401 })
    expect(logout).toHaveBeenCalledOnce()
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
    expect(logout).not.toHaveBeenCalled()
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
    expect(logout).not.toHaveBeenCalled()
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
