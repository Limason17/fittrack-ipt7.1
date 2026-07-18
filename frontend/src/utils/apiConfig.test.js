import { describe, expect, it } from 'vitest'

import { API_BASE_URL, joinApiUrl } from './api'

describe('API client configuration', () => {
  it('uses the same-origin /api path when no explicit URL is injected', () => {
    expect(API_BASE_URL).toBe('/api')
  })

  it.each([
    ['/api', '/users/login', '/api/users/login'],
    ['/api/', '/users/login', '/api/users/login'],
    ['/', '/users/login', '/users/login'],
    ['https://api.example.test/api/', '/users/login', 'https://api.example.test/api/users/login'],
  ])('joins API base %s and path %s with exactly one slash', (base, path, expected) => {
    expect(joinApiUrl(base, path)).toBe(expected)
  })
})
