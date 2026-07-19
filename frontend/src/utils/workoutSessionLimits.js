// Mirrors backend/validation/workoutSessionValidation.js LIMITS exactly.
// This is frontend guidance only — the backend remains the authority and
// re-validates every field independently.

export const WORKOUT_LIMITS = Object.freeze({
  memberNote: 500,
  clientStartKey: 100,
  actualReps: 100,
  actualWeight: 999.99,
  actualDurationMinutes: 600,
  actualDistanceKm: 999.99,
  actualRpe: 10,
})

function isBlank(value) {
  return value === '' || value === null || value === undefined
}

// Converts a raw <input type="number"> string/number into either a finite
// number within [min, max] or null (blank input). Never returns NaN,
// Infinity, or an empty string — those must never be sent to the backend.
export function parseBoundedNumber(rawValue, { min = 0, max, integer = false } = {}) {
  if (isBlank(rawValue)) return { value: null, error: null }
  const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(numeric)) return { value: undefined, error: 'invalid' }
  if (integer && !Number.isInteger(numeric)) return { value: undefined, error: 'integer' }
  if (numeric < min) return { value: undefined, error: 'min' }
  if (max !== undefined && numeric > max) return { value: undefined, error: 'max' }
  return { value: numeric, error: null }
}

export function parseActualReps(rawValue) {
  return parseBoundedNumber(rawValue, { min: 0, max: WORKOUT_LIMITS.actualReps, integer: true })
}

export function parseActualWeight(rawValue) {
  return parseBoundedNumber(rawValue, { min: 0, max: WORKOUT_LIMITS.actualWeight })
}

export function parseActualDurationMinutes(rawValue) {
  return parseBoundedNumber(rawValue, { min: 0, max: WORKOUT_LIMITS.actualDurationMinutes, integer: true })
}

export function parseActualDistanceKm(rawValue) {
  return parseBoundedNumber(rawValue, { min: 0, max: WORKOUT_LIMITS.actualDistanceKm })
}

export function parseActualRpe(rawValue) {
  return parseBoundedNumber(rawValue, { min: 0, max: WORKOUT_LIMITS.actualRpe })
}

export function parseMemberNote(rawValue) {
  if (isBlank(rawValue)) return { value: null, error: null }
  const trimmed = String(rawValue).trim()
  if (!trimmed) return { value: null, error: null }
  if (trimmed.length > WORKOUT_LIMITS.memberNote) return { value: undefined, error: 'max' }
  return { value: trimmed, error: null }
}

// A set may only be marked completed once it carries at least one plausible
// result metric, mirroring backend hasAnyResultMetric() exactly.
export function hasAnyResultMetric(set) {
  return (
    (set.actualReps !== null && set.actualReps !== undefined) ||
    (set.actualWeight !== null && set.actualWeight !== undefined) ||
    (set.actualDurationMinutes !== null && set.actualDurationMinutes !== undefined) ||
    (set.actualDistanceKm !== null && set.actualDistanceKm !== undefined) ||
    (set.actualRpe !== null && set.actualRpe !== undefined)
  )
}
