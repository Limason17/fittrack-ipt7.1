import { beforeEach, describe, expect, it } from 'vitest'

import { locale } from './i18n'
import { isConflictError, workoutErrorCode, workoutErrorMessage } from './workoutSessionErrors'

function backendError(status, code) {
  return { status, data: { error: { code, message: 'ignored' } } }
}

describe('workoutSessionErrors', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  it('extracts the stable backend error code', () => {
    expect(workoutErrorCode(backendError(409, 'WORKOUT_SESSION_CONFLICT'))).toBe('WORKOUT_SESSION_CONFLICT')
    expect(workoutErrorCode({})).toBeNull()
    expect(workoutErrorCode(null)).toBeNull()
  })

  it('identifies exactly the three revision-conflict codes as conflicts', () => {
    for (const code of ['WORKOUT_SESSION_CONFLICT', 'WORKOUT_EXERCISE_CONFLICT', 'WORKOUT_SET_CONFLICT']) {
      expect(isConflictError(backendError(409, code))).toBe(true)
    }
    expect(isConflictError(backendError(409, 'WORKOUT_START_KEY_CONFLICT'))).toBe(false)
    expect(isConflictError(backendError(404, 'WORKOUT_SESSION_NOT_FOUND'))).toBe(false)
  })

  it('maps every documented workout error code to a non-technical, translated message', () => {
    const codes = [
      'WORKOUT_ASSIGNMENT_NOT_AVAILABLE', 'WORKOUT_DAY_NOT_AVAILABLE', 'WORKOUT_SESSION_NOT_FOUND',
      'WORKOUT_SESSION_NOT_MUTABLE', 'WORKOUT_SESSION_ALREADY_TERMINAL', 'WORKOUT_SESSION_INCOMPLETE',
      'WORKOUT_SESSION_CONFLICT', 'WORKOUT_EXERCISE_NOT_FOUND', 'WORKOUT_EXERCISE_CONFLICT',
      'WORKOUT_SET_NOT_FOUND', 'WORKOUT_SET_CONFLICT', 'WORKOUT_RESULT_INVALID',
      'WORKOUT_START_KEY_CONFLICT', 'VALIDATION_ERROR',
    ]
    for (const code of codes) {
      const message = workoutErrorMessage(backendError(400, code))
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain(code)
      expect(message.toUpperCase()).not.toContain('OPTIMISTIC')
      expect(message.toUpperCase()).not.toContain('LOCKING')
    }
  })

  it('falls back to a generic message for an unrecognized or network error, without ever surfacing a raw code', () => {
    expect(workoutErrorMessage({})).toBeTruthy()
    expect(workoutErrorMessage(new Error('network down'))).toBeTruthy()
    expect(workoutErrorMessage(backendError(500, 'INTERNAL_ERROR'))).toBeTruthy()
  })

  it('maps 401/403/404 without a specific workout code to sensible fallbacks', () => {
    expect(workoutErrorMessage({ status: 401 })).toBeTruthy()
    expect(workoutErrorMessage({ status: 403 })).toBeTruthy()
    expect(workoutErrorMessage({ status: 404 })).toBeTruthy()
  })
})
