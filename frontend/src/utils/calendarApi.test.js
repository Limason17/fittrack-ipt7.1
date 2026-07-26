import { describe, expect, it } from 'vitest'
import { resolveLinkedWorkoutRoute } from './calendarApi'

describe('resolveLinkedWorkoutRoute', () => {
  it('routes a personal workout link to the existing /workouts list (no new detail page)', () => {
    const route = resolveLinkedWorkoutRoute({
      linkedWorkoutType: 'personal_workout',
      linkedWorkoutPublicId: 'workout-1',
    })
    expect(route).toEqual({ name: 'workouts' })
  })

  it('routes a studio workout session link to the existing session detail view', () => {
    const route = resolveLinkedWorkoutRoute({
      linkedWorkoutType: 'studio_workout_session',
      linkedWorkoutPublicId: 'session-1',
      studio: { id: 'studio-1', name: 'Studio A' },
    })
    expect(route).toEqual({
      name: 'studio-workout-session-detail',
      params: { studioId: 'studio-1', sessionId: 'session-1' },
    })
  })

  it('returns null when there is no linked workout at all', () => {
    expect(resolveLinkedWorkoutRoute({ linkedWorkoutType: null, linkedWorkoutPublicId: null })).toBeNull()
    expect(resolveLinkedWorkoutRoute(null)).toBeNull()
  })

  it('returns null (never guesses) for a studio link missing its studio id', () => {
    const route = resolveLinkedWorkoutRoute({
      linkedWorkoutType: 'studio_workout_session',
      linkedWorkoutPublicId: 'session-1',
      studio: null,
    })
    expect(route).toBeNull()
  })

  it('returns null for an unrecognized linkedWorkoutType rather than fabricating a route', () => {
    const route = resolveLinkedWorkoutRoute({
      linkedWorkoutType: 'something_new',
      linkedWorkoutPublicId: 'x',
    })
    expect(route).toBeNull()
  })

  it('never uses internal numeric ids - only the public id fields', () => {
    const route = resolveLinkedWorkoutRoute({
      linkedWorkoutType: 'studio_workout_session',
      linkedWorkoutPublicId: 'session-public-uuid',
      studio: { id: 'studio-public-uuid' },
    })
    expect(route.params.sessionId).toBe('session-public-uuid')
    expect(route.params.studioId).toBe('studio-public-uuid')
  })
})
