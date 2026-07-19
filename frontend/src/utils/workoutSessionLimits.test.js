import { describe, expect, it } from 'vitest'

import {
  hasAnyResultMetric,
  parseActualDistanceKm,
  parseActualDurationMinutes,
  parseActualReps,
  parseActualRpe,
  parseActualWeight,
  parseMemberNote,
  WORKOUT_LIMITS,
} from './workoutSessionLimits'

describe('workoutSessionLimits parsers', () => {
  it('treats blank input as null with no error', () => {
    expect(parseActualReps('')).toEqual({ value: null, error: null })
    expect(parseActualReps(null)).toEqual({ value: null, error: null })
    expect(parseActualReps(undefined)).toEqual({ value: null, error: null })
  })

  it('never returns NaN or Infinity for garbage input', () => {
    expect(parseActualReps('abc').value).toBeUndefined()
    expect(parseActualReps('abc').error).toBe('invalid')
    expect(parseActualWeight('Infinity').value).toBeUndefined()
    expect(parseActualWeight('Infinity').error).toBe('invalid')
  })

  it('rejects negative values', () => {
    expect(parseActualReps(-1).error).toBe('min')
    expect(parseActualWeight(-0.5).error).toBe('min')
  })

  it('enforces the exact backend integer fields', () => {
    expect(parseActualReps(8.5).error).toBe('integer')
    expect(parseActualDurationMinutes(10.5).error).toBe('integer')
    expect(parseActualWeight(60.5).error).toBeNull() // weight is not integer-constrained
  })

  it('enforces the exact backend upper bounds', () => {
    expect(WORKOUT_LIMITS.actualReps).toBe(100)
    expect(parseActualReps(100).error).toBeNull()
    expect(parseActualReps(101).error).toBe('max')

    expect(WORKOUT_LIMITS.actualWeight).toBe(999.99)
    expect(parseActualWeight(999.99).error).toBeNull()
    expect(parseActualWeight(1000).error).toBe('max')

    expect(WORKOUT_LIMITS.actualDurationMinutes).toBe(600)
    expect(parseActualDurationMinutes(600).error).toBeNull()
    expect(parseActualDurationMinutes(601).error).toBe('max')

    expect(WORKOUT_LIMITS.actualDistanceKm).toBe(999.99)
    expect(parseActualDistanceKm(999.99).error).toBeNull()
    expect(parseActualDistanceKm(1000).error).toBe('max')

    expect(WORKOUT_LIMITS.actualRpe).toBe(10)
    expect(parseActualRpe(10).error).toBeNull()
    expect(parseActualRpe(10.5).error).toBe('max')
  })

  it('accepts a plausible value within range', () => {
    expect(parseActualReps(8)).toEqual({ value: 8, error: null })
    expect(parseActualReps('8')).toEqual({ value: 8, error: null })
    expect(parseActualWeight(60.5)).toEqual({ value: 60.5, error: null })
  })

  it('a logged zero is a valid, meaningful value, not treated as blank', () => {
    expect(parseActualReps(0)).toEqual({ value: 0, error: null })
    expect(parseActualReps('0')).toEqual({ value: 0, error: null })
  })
})

describe('parseMemberNote', () => {
  it('trims and treats blank/whitespace-only input as null', () => {
    expect(parseMemberNote('')).toEqual({ value: null, error: null })
    expect(parseMemberNote('   ')).toEqual({ value: null, error: null })
    expect(parseMemberNote('  hello  ')).toEqual({ value: 'hello', error: null })
  })

  it('enforces the exact backend note length limit', () => {
    expect(WORKOUT_LIMITS.memberNote).toBe(500)
    expect(parseMemberNote('a'.repeat(500)).error).toBeNull()
    expect(parseMemberNote('a'.repeat(501)).error).toBe('max')
  })
})

describe('hasAnyResultMetric', () => {
  it('matches the backend hasAnyResultMetric exactly: false when every field is null/undefined', () => {
    expect(hasAnyResultMetric({
      actualReps: null, actualWeight: null, actualDurationMinutes: null, actualDistanceKm: null, actualRpe: null,
    })).toBe(false)
    expect(hasAnyResultMetric({})).toBe(false)
  })

  it('true when any single metric is present, including an explicit zero', () => {
    expect(hasAnyResultMetric({ actualReps: 0 })).toBe(true)
    expect(hasAnyResultMetric({ actualWeight: 0 })).toBe(true)
    expect(hasAnyResultMetric({ actualRpe: 5 })).toBe(true)
  })
})
