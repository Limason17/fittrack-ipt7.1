import { describe, expect, it } from 'vitest'

import { withPagination } from './studioApi'

describe('studio API pagination', () => {
  it('adds bounded page parameters without leaking them into request options', () => {
    expect(withPagination('/v1/studios/id/memberships', {
      page: 2,
      limit: 20,
      signal: 'signal',
    })).toEqual({
      path: '/v1/studios/id/memberships?page=2&limit=20',
      options: { signal: 'signal' },
    })
  })

  it.each([
    { page: 0 },
    { page: 1_000_001 },
    { limit: 0 },
    { limit: 101 },
    { page: 'not-a-page' },
  ])('rejects unbounded pagination %#', (options) => {
    expect(() => withPagination('/v1/studios', options)).toThrow(TypeError)
  })
})
