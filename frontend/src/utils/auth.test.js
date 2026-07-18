import { beforeEach, describe, expect, it } from 'vitest'

import { isSafeInternalRedirect, safeInternalRedirect } from './auth'

describe('safe login redirects', () => {
  beforeEach(() => localStorage.clear())

  it.each([
    '/',
    '/workouts?month=2026-07',
    '/invitations/opaque-token',
    '/studios/studio-public-id/settings',
  ])('accepts the internal path %s', (path) => {
    expect(isSafeInternalRedirect(path)).toBe(true)
    expect(safeInternalRedirect(path)).toBe(path)
  })

  it.each([
    'https://attacker.example/path',
    '//attacker.example/path',
    '\\attacker.example\\path',
    'javascript:alert(1)',
    '',
    null,
  ])('rejects the external or malformed redirect %s', (path) => {
    expect(isSafeInternalRedirect(path)).toBe(false)
    expect(safeInternalRedirect(path)).toBe('/')
  })
})
