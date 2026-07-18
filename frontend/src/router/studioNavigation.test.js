import { beforeEach, describe, expect, it } from 'vitest'

import router, { navigationGuard } from './index'
import { authToken, authUser } from '../utils/auth'
import {
  activeStudioId,
  addAndSelectStudio,
  clearStudioContext,
} from '../utils/studioContext'

const studio = {
  id: 'studio-a',
  name: 'Studio A',
  slug: 'studio-a',
  status: 'active',
  membership: { id: 'membership-a', role: 'owner', status: 'active' },
}
const studioB = {
  ...studio,
  id: 'studio-b',
  name: 'Studio B',
  slug: 'studio-b',
  membership: { ...studio.membership, id: 'membership-b' },
}

describe('studio route boundaries', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'test-token'
    authUser.value = { id: 1, username: 'Owner' }
  })

  it.each(['/workouts', '/exercises', '/progress', '/'])('returns %s to personal context', async (path) => {
    addAndSelectStudio(studio)

    await navigationGuard({
      fullPath: path,
      meta: { requiresAuth: path !== '/', personalContext: true },
      params: {},
    })

    expect(activeStudioId.value).toBeNull()
  })

  it('keeps an authorized studio on its dashboard', async () => {
    addAndSelectStudio(studio)

    const result = await navigationGuard({
      fullPath: '/studios/studio-a',
      meta: { requiresAuth: true, requiresStudio: true },
      params: { studioId: 'studio-a' },
    }, {
      studioLoader: async () => ({ studios: [studio] }),
    })

    expect(result).toBeUndefined()
    expect(activeStudioId.value).toBe('studio-a')
  })

  it('uses a freshly loaded role before entering a management route', async () => {
    addAndSelectStudio(studio)
    const demoted = { ...studio, membership: { ...studio.membership, role: 'trainer' } }

    const result = await navigationGuard({
      fullPath: '/studios/studio-a/settings',
      meta: {
        requiresAuth: true,
        requiresStudio: true,
        studioRoles: ['owner', 'admin'],
      },
      params: { studioId: 'studio-a' },
    }, {
      studioLoader: async () => ({ studios: [demoted] }),
    })

    expect(result).toEqual({
      name: 'studio-access-denied',
      params: { studioId: 'studio-a' },
    })
  })

  it('does not let a superseded studio guard overwrite the newer context', async () => {
    let resolveA
    let resolveB
    const toStudio = (id) => ({
      fullPath: `/studios/${id}`,
      meta: { requiresAuth: true, requiresStudio: true },
      params: { studioId: id },
    })
    const navigationA = navigationGuard(toStudio('studio-a'), {
      studioLoader: () => new Promise((resolve) => { resolveA = resolve }),
    })
    const navigationB = navigationGuard(toStudio('studio-b'), {
      studioLoader: () => new Promise((resolve) => { resolveB = resolve }),
    })

    await Promise.resolve()
    resolveB({ studios: [studio, studioB] })
    expect(await navigationB).toBeUndefined()
    expect(activeStudioId.value).toBe('studio-b')

    resolveA({ studios: [studio, studioB] })
    expect(await navigationA).toBe(false)
    expect(activeStudioId.value).toBe('studio-b')
  })

  it('replaces an unauthenticated invitation URL with login and keeps a safe internal redirect', async () => {
    authToken.value = null
    authUser.value = null
    const invitation = router.resolve('/invitations/opaque-token?source=email')

    const result = await navigationGuard(invitation)

    expect(result).toEqual({
      path: '/login',
      query: { redirect: '/invitations/opaque-token?source=email' },
      replace: true,
    })
  })
})
