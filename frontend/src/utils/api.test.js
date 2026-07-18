// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logout = vi.fn()

vi.mock('./auth', () => ({ logout }))

describe('apiRequest authorization failures', () => {
  beforeEach(() => {
    logout.mockReset()
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
