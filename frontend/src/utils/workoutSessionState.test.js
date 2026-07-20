import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  abortWorkoutSession: vi.fn(),
  completeWorkoutSession: vi.fn(),
  createWorkoutSet: vi.fn(),
  getOwnWorkoutSession: vi.fn(),
  startWorkoutSession: vi.fn(),
  updateWorkoutSession: vi.fn(),
  updateWorkoutSessionExercise: vi.fn(),
  updateWorkoutSet: vi.fn(),
}))
vi.mock('./workoutSessionApi', () => api)

import { SAVE_STATUS, startWorkoutSession, useWorkoutSession } from './workoutSessionState'
import { clearStartKey, getOrCreateStartKey } from './workoutSessionStartKeys'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeSet(overrides = {}) {
  return {
    id: 'set-1', position: 1, status: 'pending',
    actualReps: null, actualWeight: null, actualDurationMinutes: null, actualDistanceKm: null, actualRpe: null,
    memberNote: null, revision: 0, completedAt: null,
    ...overrides,
  }
}

function makeExercise(overrides = {}) {
  return {
    id: 'exercise-1', position: 1, exerciseNameSnapshot: 'Bench Press', instructionsSnapshot: null,
    targetSets: 2, targetRepsMin: 6, targetRepsMax: 8, targetWeight: 60, targetDurationMinutes: null,
    targetDistanceKm: null, targetRpe: null, restSeconds: 90, status: 'pending', memberNote: null, revision: 0,
    sets: [makeSet()],
    ...overrides,
  }
}

function makeSession(overrides = {}) {
  return {
    id: 'session-1', assignmentId: 'assignment-1', status: 'in_progress', revision: 0,
    program: { id: 'program-1', name: 'Program' }, programVersion: { versionNumber: 1 },
    programDay: { id: 'day-1', name: 'Day 1' },
    startedAt: '2026-01-01T10:00:00.000Z', completedAt: null, abortedAt: null, memberNote: null,
    exercises: [makeExercise()],
    ...overrides,
  }
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  sessionStorage.clear()
})

describe('startWorkoutSession', () => {
  it('sends a clientStartKey and clears it from sessionStorage on success', async () => {
    api.startWorkoutSession.mockResolvedValue({ workoutSession: { id: 'session-1' } })
    const result = await startWorkoutSession('studio-a', 'assignment-1', 'day-1')

    expect(result).toEqual({ session: { id: 'session-1' }, error: null })
    expect(api.startWorkoutSession).toHaveBeenCalledWith('studio-a', 'assignment-1', {
      programDayId: 'day-1', clientStartKey: expect.any(String),
    })
    expect(getOrCreateStartKey('studio-a', 'assignment-1', 'day-1')).not.toBe(
      api.startWorkoutSession.mock.calls[0][2].clientStartKey
    )
  })

  it('keeps the clientStartKey in sessionStorage on failure so a retry reuses it', async () => {
    api.startWorkoutSession.mockRejectedValue({ status: 409, data: { error: { code: 'WORKOUT_ASSIGNMENT_NOT_AVAILABLE' } } })
    await startWorkoutSession('studio-a', 'assignment-1', 'day-1')
    const usedKey = api.startWorkoutSession.mock.calls[0][2].clientStartKey

    api.startWorkoutSession.mockResolvedValue({ workoutSession: { id: 'session-1' } })
    await startWorkoutSession('studio-a', 'assignment-1', 'day-1')
    expect(api.startWorkoutSession.mock.calls[1][2].clientStartKey).toBe(usedKey)
  })

  it('deduplicates a genuine double-click into a single in-flight request', async () => {
    const { promise, resolve } = deferred()
    api.startWorkoutSession.mockReturnValue(promise)

    const first = startWorkoutSession('studio-a', 'assignment-1', 'day-1')
    const second = startWorkoutSession('studio-a', 'assignment-1', 'day-1')
    expect(api.startWorkoutSession).toHaveBeenCalledTimes(1)

    resolve({ workoutSession: { id: 'session-1' } })
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toEqual(secondResult)
  })

  it('does not deduplicate different assignment+day combinations', async () => {
    api.startWorkoutSession.mockResolvedValue({ workoutSession: { id: 'session-1' } })
    await Promise.all([
      startWorkoutSession('studio-a', 'assignment-1', 'day-1'),
      startWorkoutSession('studio-a', 'assignment-2', 'day-1'),
    ])
    expect(api.startWorkoutSession).toHaveBeenCalledTimes(2)
  })
})

describe('useWorkoutSession: loading', () => {
  it('loads a session and annotates every exercise and set with idle save state', async () => {
    api.getOwnWorkoutSession.mockResolvedValue({ workoutSession: makeSession() })
    const controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')

    expect(controller.session.value.id).toBe('session-1')
    expect(controller.session.value._save.status).toBe(SAVE_STATUS.IDLE)
    expect(controller.session.value.exercises[0]._save.status).toBe(SAVE_STATUS.IDLE)
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.IDLE)
    expect(controller.isLoading.value).toBe(false)
  })

  it('surfaces a translated error and never a raw code on load failure', async () => {
    api.getOwnWorkoutSession.mockRejectedValue({ status: 404, data: { error: { code: 'WORKOUT_SESSION_NOT_FOUND' } } })
    const controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')

    expect(controller.session.value).toBeNull()
    expect(controller.loadError.value).toBeTruthy()
    expect(controller.loadError.value).not.toContain('WORKOUT_SESSION_NOT_FOUND')
  })

  it('a stale in-flight load is ignored if a newer load for a different session starts first', async () => {
    const first = deferred()
    api.getOwnWorkoutSession.mockReturnValueOnce(first.promise)
    const controller = useWorkoutSession()
    const firstLoad = controller.loadSession('studio-a', 'session-old')

    api.getOwnWorkoutSession.mockResolvedValueOnce({ workoutSession: makeSession({ id: 'session-new' }) })
    await controller.loadSession('studio-a', 'session-new')
    expect(controller.session.value.id).toBe('session-new')

    first.resolve({ workoutSession: makeSession({ id: 'session-old' }) })
    await firstLoad
    expect(controller.session.value.id).toBe('session-new')
  })
})

describe('useWorkoutSession: updateSet revision handling', () => {
  let controller

  beforeEach(async () => {
    api.getOwnWorkoutSession.mockResolvedValue({ workoutSession: makeSession() })
    controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')
  })

  it('sends expectedRevision from the current known revision and applies the server result on success', async () => {
    api.updateWorkoutSet.mockResolvedValue({
      workoutSet: makeSet({ actualReps: 8, revision: 1 }),
    })
    await controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })

    expect(api.updateWorkoutSet).toHaveBeenCalledWith(
      'studio-a', 'session-1', 'exercise-1', 'set-1', { actualReps: 8, expectedRevision: 0 }
    )
    const set = controller.session.value.exercises[0].sets[0]
    expect(set.actualReps).toBe(8)
    expect(set.revision).toBe(1)
    expect(set._save.status).toBe(SAVE_STATUS.SAVED)
  })

  it('echoes the edit into the local set immediately, before the request resolves', async () => {
    const pending = deferred()
    api.updateWorkoutSet.mockReturnValue(pending.promise)

    const mutation = controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })
    expect(controller.session.value.exercises[0].sets[0].actualReps).toBe(8)
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.SAVING)

    pending.resolve({ workoutSet: makeSet({ actualReps: 8, revision: 1 }) })
    await mutation
  })

  it('a stale response never overwrites a newer local edit, and the newer edit is sent next with the fresh revision', async () => {
    const firstCall = deferred()
    api.updateWorkoutSet.mockReturnValueOnce(firstCall.promise)

    const firstMutation = controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })
    // A second, newer edit arrives while the first request is still in flight.
    const secondMutation = controller.updateSet('exercise-1', 'set-1', { actualReps: 9 })
    expect(api.updateWorkoutSet).toHaveBeenCalledTimes(1)
    expect(controller.session.value.exercises[0].sets[0].actualReps).toBe(9)

    // The drain loop is one continuous async call chained from the first
    // updateSet(), so resolving the second send must happen before awaiting
    // firstMutation, or the two would deadlock waiting on each other.
    const secondCall = deferred()
    api.updateWorkoutSet.mockReturnValueOnce(secondCall.promise)
    firstCall.resolve({ workoutSet: makeSet({ actualReps: 8, revision: 1 }) })

    await vi.waitFor(() => expect(api.updateWorkoutSet).toHaveBeenCalledTimes(2))

    // The stale response (actualReps: 8) must never have overwritten the newer local value.
    expect(controller.session.value.exercises[0].sets[0].actualReps).toBe(9)
    expect(controller.session.value.exercises[0].sets[0].revision).toBe(1)
    expect(api.updateWorkoutSet).toHaveBeenLastCalledWith(
      'studio-a', 'session-1', 'exercise-1', 'set-1', { actualReps: 9, expectedRevision: 1 }
    )

    secondCall.resolve({ workoutSet: makeSet({ actualReps: 9, revision: 2 }) })
    await firstMutation
    await secondMutation
    expect(controller.session.value.exercises[0].sets[0].actualReps).toBe(9)
    expect(controller.session.value.exercises[0].sets[0].revision).toBe(2)
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.SAVED)
  })

  it('multiple edits while a save is in flight are merged into a single follow-up request, not one per edit', async () => {
    const firstCall = deferred()
    api.updateWorkoutSet.mockReturnValueOnce(firstCall.promise)

    controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })
    controller.updateSet('exercise-1', 'set-1', { actualWeight: 50 })
    controller.updateSet('exercise-1', 'set-1', { actualRpe: 7 })
    expect(api.updateWorkoutSet).toHaveBeenCalledTimes(1)

    api.updateWorkoutSet.mockResolvedValueOnce({ workoutSet: makeSet({ actualReps: 8, revision: 1 }) })
    firstCall.resolve({ workoutSet: makeSet({ actualReps: 8, revision: 1 }) })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(api.updateWorkoutSet).toHaveBeenCalledTimes(2)
    expect(api.updateWorkoutSet).toHaveBeenLastCalledWith(
      'studio-a', 'session-1', 'exercise-1', 'set-1',
      { actualWeight: 50, actualRpe: 7, expectedRevision: 1 }
    )
  })
})

describe('useWorkoutSession: conflict handling', () => {
  let controller

  beforeEach(async () => {
    api.getOwnWorkoutSession.mockResolvedValue({ workoutSession: makeSession() })
    controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')
  })

  it('a 409 marks the resource as conflicted, keeps the local draft visible, and does not overwrite it', async () => {
    api.updateWorkoutSet.mockRejectedValue({ status: 409, data: { error: { code: 'WORKOUT_SET_CONFLICT' } } })
    await controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })

    const set = controller.session.value.exercises[0].sets[0]
    expect(set.actualReps).toBe(8)
    expect(set._save.status).toBe(SAVE_STATUS.CONFLICT)
    expect(set._save.error).toBeTruthy()
  })

  it('further local edits after a conflict do not automatically retry the request', async () => {
    api.updateWorkoutSet.mockRejectedValue({ status: 409, data: { error: { code: 'WORKOUT_SET_CONFLICT' } } })
    await controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })
    expect(api.updateWorkoutSet).toHaveBeenCalledTimes(1)

    await controller.updateSet('exercise-1', 'set-1', { actualReps: 9 })
    expect(api.updateWorkoutSet).toHaveBeenCalledTimes(1)
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.CONFLICT)
    expect(controller.session.value.exercises[0].sets[0].actualReps).toBe(9)
  })

  it('reloadSession clears the conflict and adopts the fresh server state', async () => {
    api.updateWorkoutSet.mockRejectedValue({ status: 409, data: { error: { code: 'WORKOUT_SET_CONFLICT' } } })
    await controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.CONFLICT)

    api.getOwnWorkoutSession.mockResolvedValue({
      workoutSession: makeSession({ exercises: [makeExercise({ sets: [makeSet({ actualReps: 5, revision: 3 })] })] }),
    })
    await controller.reloadSession()

    const set = controller.session.value.exercises[0].sets[0]
    expect(set.actualReps).toBe(5)
    expect(set.revision).toBe(3)
    expect(set._save.status).toBe(SAVE_STATUS.IDLE)
  })

  it('hasUnsettledWork is true while conflicted, blocking session completion until resolved', async () => {
    api.updateWorkoutSet.mockRejectedValue({ status: 409, data: { error: { code: 'WORKOUT_SET_CONFLICT' } } })
    await controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })
    expect(controller.hasUnsettledWork()).toBe(true)
  })

  it('a plain network/server error (not 409) allows a manual retry to resend', async () => {
    api.updateWorkoutSet.mockRejectedValueOnce({ status: 500, data: {} })
    await controller.updateSet('exercise-1', 'set-1', { actualReps: 8 })
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.ERROR)

    api.updateWorkoutSet.mockResolvedValueOnce({ workoutSet: makeSet({ actualReps: 8, revision: 1 }) })
    await controller.retrySet('exercise-1', 'set-1')
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.SAVED)
    expect(controller.session.value.exercises[0].sets[0].revision).toBe(1)
  })
})

describe('useWorkoutSession: completion and abort', () => {
  let controller

  beforeEach(async () => {
    api.getOwnWorkoutSession.mockResolvedValue({ workoutSession: makeSession() })
    controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')
  })

  it('surfaces WORKOUT_SESSION_INCOMPLETE with the first incomplete exercise/set location', async () => {
    api.completeWorkoutSession.mockRejectedValue({ status: 409, data: { error: { code: 'WORKOUT_SESSION_INCOMPLETE' } } })
    const result = await controller.completeSession()

    expect(result.ok).toBe(false)
    expect(result.incomplete).toBe(true)
    expect(result.firstIncomplete).toEqual({ exerciseId: 'exercise-1', setId: null })
  })

  it('finds a pending set under an otherwise-completed exercise as the first incomplete location', async () => {
    api.getOwnWorkoutSession.mockResolvedValue({
      workoutSession: makeSession({
        exercises: [makeExercise({
          status: 'completed',
          sets: [makeSet({ id: 'set-1', status: 'completed' }), makeSet({ id: 'set-2', position: 2, status: 'pending' })],
        })],
      }),
    })
    controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')

    api.completeWorkoutSession.mockRejectedValue({ status: 409, data: { error: { code: 'WORKOUT_SESSION_INCOMPLETE' } } })
    const result = await controller.completeSession()
    expect(result.firstIncomplete).toEqual({ exerciseId: 'exercise-1', setId: 'set-2' })
  })

  it('a successful completion replaces the session with the terminal, read-only server state', async () => {
    api.completeWorkoutSession.mockResolvedValue({
      workoutSession: makeSession({ status: 'completed', completedAt: '2026-01-01T11:00:00.000Z' }),
    })
    const result = await controller.completeSession()

    expect(result.ok).toBe(true)
    expect(controller.session.value.status).toBe('completed')
    expect(controller.isMutable()).toBe(false)
  })

  it('a successful abort preserves already-logged values and becomes read-only', async () => {
    api.abortWorkoutSession.mockResolvedValue({
      workoutSession: makeSession({
        status: 'aborted', abortedAt: '2026-01-01T11:00:00.000Z',
        exercises: [makeExercise({ sets: [makeSet({ actualReps: 5, status: 'pending' })] })],
      }),
    })
    const result = await controller.abortSession()

    expect(result.ok).toBe(true)
    expect(controller.session.value.status).toBe('aborted')
    expect(controller.session.value.exercises[0].sets[0].actualReps).toBe(5)
    expect(controller.isMutable()).toBe(false)
  })
})

describe('useWorkoutSession: add set', () => {
  it('appends a newly created set to the exercise', async () => {
    api.getOwnWorkoutSession.mockResolvedValue({ workoutSession: makeSession({ exercises: [makeExercise({ sets: [] })] }) })
    const controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')

    api.createWorkoutSet.mockResolvedValue({ workoutSet: makeSet({ id: 'set-new', position: 1 }) })
    await controller.addSet('exercise-1')

    expect(controller.session.value.exercises[0].sets).toHaveLength(1)
    expect(controller.session.value.exercises[0].sets[0].id).toBe('set-new')
    expect(controller.session.value.exercises[0].sets[0]._save.status).toBe(SAVE_STATUS.IDLE)
  })
})

describe('useWorkoutSession: reset (workspace switch / logout)', () => {
  it('reset() clears the loaded session and any in-flight generation', async () => {
    api.getOwnWorkoutSession.mockResolvedValue({ workoutSession: makeSession() })
    const controller = useWorkoutSession()
    await controller.loadSession('studio-a', 'session-1')
    expect(controller.session.value).not.toBeNull()

    controller.reset()
    expect(controller.session.value).toBeNull()
  })

  it('a load in flight at the time of reset never lands after the reset', async () => {
    const pending = deferred()
    api.getOwnWorkoutSession.mockReturnValue(pending.promise)
    const controller = useWorkoutSession()
    const loadPromise = controller.loadSession('studio-a', 'session-1')

    controller.reset()
    pending.resolve({ workoutSession: makeSession() })
    await loadPromise

    expect(controller.session.value).toBeNull()
  })
})
