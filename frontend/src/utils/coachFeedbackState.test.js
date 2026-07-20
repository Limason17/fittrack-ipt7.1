import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  createWorkoutSessionFeedback: vi.fn(),
  listWorkoutSessionFeedback: vi.fn(),
}))
vi.mock('./workoutSessionApi', () => api)

import { useCoachSessionFeedback } from './coachFeedbackState'

describe('useCoachSessionFeedback', () => {
  beforeEach(() => {
    sessionStorage.clear()
    api.createWorkoutSessionFeedback.mockReset()
    api.listWorkoutSessionFeedback.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('load() populates entries from the API and clears loading/error state', async () => {
    api.listWorkoutSessionFeedback.mockResolvedValue({
      workoutSessionFeedback: [{ id: 'fb-1', coach: { displayName: 'Coach' }, body: 'Nice work', createdAt: '2026-07-01T10:00:00.000Z' }],
      pagination: { total: 1 },
    })
    const feedback = useCoachSessionFeedback()
    await feedback.load('studio-a', 'session-1')

    expect(api.listWorkoutSessionFeedback).toHaveBeenCalledWith('studio-a', 'session-1', { page: 1, limit: 100 })
    expect(feedback.entries.value).toHaveLength(1)
    expect(feedback.isLoading.value).toBe(false)
    expect(feedback.loadError.value).toBe('')
  })

  it('load() sets a readable error message on failure', async () => {
    api.listWorkoutSessionFeedback.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const feedback = useCoachSessionFeedback()
    await feedback.load('studio-a', 'session-1')

    expect(feedback.entries.value).toEqual([])
    expect(feedback.loadError.value.length).toBeGreaterThan(0)
  })

  it('submit() appends the returned entry and clears the client feedback key on success', async () => {
    const newEntry = { id: 'fb-2', coach: { displayName: 'Coach' }, body: 'Solid session', createdAt: '2026-07-02T10:00:00.000Z' }
    api.createWorkoutSessionFeedback.mockResolvedValue({ workoutSessionFeedback: newEntry })
    const feedback = useCoachSessionFeedback()

    const result = await feedback.submit('studio-a', 'session-1', 'Solid session')
    expect(result.ok).toBe(true)
    expect(feedback.entries.value).toEqual([newEntry])
    expect(feedback.isSubmitting.value).toBe(false)
    expect(sessionStorage.getItem('fittrack_feedback_key:studio-a:session-1')).toBeNull()
  })

  it('submit() reuses the same clientFeedbackKey on a retry after a failure', async () => {
    api.createWorkoutSessionFeedback.mockRejectedValueOnce(Object.assign(new Error('network'), { status: 0 }))
    const feedback = useCoachSessionFeedback()

    const first = await feedback.submit('studio-a', 'session-1', 'Solid session')
    expect(first.ok).toBe(false)
    expect(feedback.submitError.value.length).toBeGreaterThan(0)
    const keyAfterFailure = sessionStorage.getItem('fittrack_feedback_key:studio-a:session-1')
    expect(keyAfterFailure).toBeTruthy()

    const newEntry = { id: 'fb-3', coach: { displayName: 'Coach' }, body: 'Solid session', createdAt: '2026-07-02T10:00:00.000Z' }
    api.createWorkoutSessionFeedback.mockResolvedValueOnce({ workoutSessionFeedback: newEntry })
    await feedback.submit('studio-a', 'session-1', 'Solid session')

    expect(api.createWorkoutSessionFeedback).toHaveBeenNthCalledWith(
      2, 'studio-a', 'session-1', { clientFeedbackKey: keyAfterFailure, body: 'Solid session' }
    )
  })

  it('submit() never issues a second request while one is already in flight', async () => {
    let resolveFirst
    api.createWorkoutSessionFeedback.mockReturnValue(new Promise((resolve) => { resolveFirst = resolve }))
    const feedback = useCoachSessionFeedback()

    const firstCall = feedback.submit('studio-a', 'session-1', 'First attempt')
    const secondCall = feedback.submit('studio-a', 'session-1', 'Second attempt')
    const second = await secondCall
    expect(second.ok).toBe(false)
    expect(api.createWorkoutSessionFeedback).toHaveBeenCalledTimes(1)

    resolveFirst({ workoutSessionFeedback: { id: 'fb-4', coach: {}, body: 'First attempt', createdAt: '2026-07-01T00:00:00.000Z' } })
    await firstCall
  })

  it('reset() clears entries, errors and loading flags back to defaults', async () => {
    api.listWorkoutSessionFeedback.mockResolvedValue({ workoutSessionFeedback: [{ id: 'fb-1', coach: {}, body: 'x', createdAt: '2026-01-01' }], pagination: {} })
    const feedback = useCoachSessionFeedback()
    await feedback.load('studio-a', 'session-1')
    expect(feedback.entries.value).toHaveLength(1)

    feedback.reset()
    expect(feedback.entries.value).toEqual([])
    expect(feedback.isLoading.value).toBe(true)
    expect(feedback.loadError.value).toBe('')
    expect(feedback.isSubmitting.value).toBe(false)
    expect(feedback.submitError.value).toBe('')
  })
})
