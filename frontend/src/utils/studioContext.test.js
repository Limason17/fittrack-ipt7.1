import { beforeEach, describe, expect, it } from 'vitest'

import { authToken, authUser, logout } from './auth'
import {
  PREFERRED_STUDIO_KEY,
  activeStudio,
  activeStudioId,
  addAndSelectStudio,
  authorizedStudios,
  clearStudioContext,
  hydrateStudioContext,
  selectStudio,
  studioContextStatus,
} from './studioContext'

function studio(id, role = 'member', overrides = {}) {
  return {
    id,
    name: `Studio ${id}`,
    slug: id,
    status: 'active',
    defaultLocale: 'de',
    defaultTimezone: 'Europe/Zurich',
    defaultWeightUnit: 'kg',
    membership: { id: `membership-${id}`, role, status: 'active', joinedAt: null },
    ...overrides,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('authoritative studio context', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'test-token'
    authUser.value = { id: 1, username: 'Test' }
  })

  it('defaults to the synthetic personal context even when studios exist', async () => {
    await hydrateStudioContext({ loader: async () => ({ studios: [studio('studio-a', 'owner')] }) })

    expect(authorizedStudios.value).toHaveLength(1)
    expect(activeStudioId.value).toBeNull()
    expect(activeStudio.value).toBeNull()
    expect(localStorage.getItem(PREFERRED_STUDIO_KEY)).toBeNull()
  })

  it('restores only a freshly authorized active preferred studio', async () => {
    localStorage.setItem(PREFERRED_STUDIO_KEY, 'studio-a')
    await hydrateStudioContext({ loader: async () => ({ studios: [studio('studio-a', 'trainer')] }) })

    expect(activeStudioId.value).toBe('studio-a')
    expect(activeStudio.value.membership.role).toBe('trainer')
    expect(localStorage.getItem(PREFERRED_STUDIO_KEY)).toBe('studio-a')
  })

  it('clears an invalid, lost or suspended preference instead of selecting another studio', async () => {
    localStorage.setItem(PREFERRED_STUDIO_KEY, 'lost-studio')
    await hydrateStudioContext({ loader: async () => ({
      studios: [studio('studio-a', 'owner'), studio('lost-studio', 'member', {
        membership: { id: 'lost-membership', role: 'member', status: 'suspended' },
      })],
    }) })

    expect(activeStudioId.value).toBeNull()
    expect(localStorage.getItem(PREFERRED_STUDIO_KEY)).toBeNull()
  })

  it('keeps the latest hydration result when requests finish out of order', async () => {
    const first = deferred()
    const second = deferred()
    const firstRun = hydrateStudioContext({ force: true, loader: () => first.promise })
    const secondRun = hydrateStudioContext({ force: true, loader: () => second.promise })

    second.resolve({ studios: [studio('studio-new')] })
    await secondRun
    first.resolve({ studios: [studio('studio-old')] })
    await firstRun

    expect(authorizedStudios.value.map((entry) => entry.id)).toEqual(['studio-new'])
    expect(studioContextStatus.value).toBe('ready')
  })

  it('selects a studio only after an authoritative create or acceptance response', () => {
    addAndSelectStudio(studio('studio-created', 'owner'))

    expect(activeStudioId.value).toBe('studio-created')
    expect(localStorage.getItem(PREFERRED_STUDIO_KEY)).toBe('studio-created')
    selectStudio(null)
    expect(activeStudioId.value).toBeNull()
  })

  it('clears studio ids, roles and loaded data on logout', () => {
    addAndSelectStudio(studio('studio-a', 'admin'))
    logout()

    expect(authorizedStudios.value).toEqual([])
    expect(activeStudioId.value).toBeNull()
    expect(localStorage.getItem(PREFERRED_STUDIO_KEY)).toBeNull()
  })
})
