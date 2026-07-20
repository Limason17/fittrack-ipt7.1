import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearStartKey, getOrCreateStartKey } from './workoutSessionStartKeys'

describe('workoutSessionStartKeys', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('creates a new key on first use', () => {
    const createKey = vi.fn(() => 'uuid-1')
    const key = getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey })
    expect(key).toBe('uuid-1')
    expect(createKey).toHaveBeenCalledTimes(1)
  })

  it('reuses the same key on a retry of the same assignment+day', () => {
    const createKey = vi.fn(() => 'uuid-1')
    getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey })
    const second = getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey })
    expect(second).toBe('uuid-1')
    expect(createKey).toHaveBeenCalledTimes(1)
  })

  it('never reuses a key across different assignments or days', () => {
    let counter = 0
    const createKey = () => `uuid-${++counter}`
    const forAssignment1 = getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey })
    const forAssignment2 = getOrCreateStartKey('studio-a', 'assignment-2', 'day-1', { createKey })
    const forDay2 = getOrCreateStartKey('studio-a', 'assignment-1', 'day-2', { createKey })
    expect(new Set([forAssignment1, forAssignment2, forDay2]).size).toBe(3)
  })

  it('never reuses a key across different studios', () => {
    let counter = 0
    const createKey = () => `uuid-${++counter}`
    const forStudioA = getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey })
    const forStudioB = getOrCreateStartKey('studio-b', 'assignment-1', 'day-1', { createKey })
    expect(forStudioA).not.toBe(forStudioB)
  })

  it('removes the key after a successful resolution, so the next attempt creates a fresh one', () => {
    const createKey = vi.fn(() => 'uuid-1')
    getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey })
    clearStartKey('studio-a', 'assignment-1', 'day-1')
    createKey.mockReturnValue('uuid-2')
    const next = getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey })
    expect(next).toBe('uuid-2')
  })

  it('stores only the opaque key string in sessionStorage, never assignment or result data', () => {
    getOrCreateStartKey('studio-a', 'assignment-1', 'day-1', { createKey: () => 'uuid-1' })
    const rawValues = Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key))
    for (const value of rawValues) {
      expect(value).toBe('uuid-1')
    }
  })
})
