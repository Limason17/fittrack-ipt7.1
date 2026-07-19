// Transient idempotency-key storage for starting a workout session.
//
// Only an opaque, randomly generated key is ever stored here — never
// assignment, program, or result data. sessionStorage (not localStorage) is
// used deliberately so the key never survives a browser restart, and it is
// scoped per studio/assignment/day so unrelated start attempts can never
// collide or reuse each other's key.

function storageKey(studioId, assignmentId, programDayId) {
  return `fittrack_workout_start_key:${studioId}:${assignmentId}:${programDayId}`
}

function storageAvailable() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

export function getOrCreateStartKey(studioId, assignmentId, programDayId, { createKey = () => crypto.randomUUID() } = {}) {
  if (!storageAvailable()) return createKey()
  const key = storageKey(studioId, assignmentId, programDayId)
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const created = createKey()
  sessionStorage.setItem(key, created)
  return created
}

export function clearStartKey(studioId, assignmentId, programDayId) {
  if (!storageAvailable()) return
  sessionStorage.removeItem(storageKey(studioId, assignmentId, programDayId))
}
