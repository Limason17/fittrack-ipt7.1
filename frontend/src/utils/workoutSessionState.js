import { reactive, ref } from 'vue'

import {
  abortWorkoutSession,
  completeWorkoutSession,
  createWorkoutSet,
  getOwnWorkoutSession,
  startWorkoutSession as startWorkoutSessionRequest,
  updateWorkoutSession,
  updateWorkoutSessionExercise,
  updateWorkoutSet,
} from './workoutSessionApi'
import { clearStartKey, getOrCreateStartKey } from './workoutSessionStartKeys'
import { workoutErrorMessage } from './workoutSessionErrors'

export const SAVE_STATUS = Object.freeze({
  IDLE: 'idle',
  DIRTY: 'dirty',
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error',
  CONFLICT: 'conflict',
})

// ---- Idempotent, de-duplicated session start ----
//
// A module-level map (not per-component) so a genuine double-click racing
// two event handlers for the exact same assignment+day always resolves to
// the same in-flight promise, never two parallel start requests.
const startsInFlight = new Map()

export function startWorkoutSession(studioId, assignmentId, programDayId) {
  const dedupeKey = `${studioId}:${assignmentId}:${programDayId}`
  const existing = startsInFlight.get(dedupeKey)
  if (existing) return existing

  const promise = (async () => {
    const clientStartKey = getOrCreateStartKey(studioId, assignmentId, programDayId)
    try {
      const result = await startWorkoutSessionRequest(studioId, assignmentId, {
        programDayId,
        clientStartKey,
      })
      clearStartKey(studioId, assignmentId, programDayId)
      return { session: result.workoutSession, error: null }
    } catch (error) {
      return { session: null, error }
    }
  })()

  startsInFlight.set(dedupeKey, promise)
  promise.finally(() => {
    if (startsInFlight.get(dedupeKey) === promise) startsInFlight.delete(dedupeKey)
  })
  return promise
}

// ---- Per-resource optimistic-concurrency mutation queue ----
//
// Every mutable resource (the session note, each exercise, each set) gets at
// most one in-flight PATCH. A local edit that arrives while a save is still
// in flight is merged into a single queued follow-up payload instead of
// firing a second overlapping request. A response is only allowed to
// overwrite the locally displayed fields if no newer local edit was made
// while that request was in flight — otherwise only its `revision` is
// adopted (so the next send uses a valid expectedRevision) and the newer
// local draft is preserved and sent next.
function createMutationQueue() {
  const books = new Map()

  function ensureBook(key) {
    let book = books.get(key)
    if (!book) {
      book = { inFlight: false, pendingPatch: null, editSeq: 0, blocked: false }
      books.set(key, book)
    }
    return book
  }

  async function drain(key, resourceState, ctx) {
    const book = ensureBook(key)
    while (book.pendingPatch) {
      const payload = book.pendingPatch
      book.pendingPatch = null
      const seqAtSend = book.editSeq
      book.inFlight = true
      resourceState.status = SAVE_STATUS.SAVING
      resourceState.error = ''
      try {
        const expectedRevision = ctx.getRevision()
        const result = await ctx.send({ ...payload, expectedRevision })
        book.inFlight = false
        if (book.editSeq === seqAtSend && !book.pendingPatch) {
          ctx.applyServerResult(result)
          resourceState.status = SAVE_STATUS.SAVED
        } else {
          ctx.applyServerRevisionOnly(result)
        }
      } catch (error) {
        book.inFlight = false
        book.pendingPatch = { ...payload, ...(book.pendingPatch || {}) }
        if (error?.status === 409) {
          book.blocked = true
          resourceState.status = SAVE_STATUS.CONFLICT
          resourceState.error = workoutErrorMessage(error)
        } else {
          resourceState.status = SAVE_STATUS.ERROR
          resourceState.error = workoutErrorMessage(error)
        }
        return
      }
    }
  }

  // A local edit always updates the visible draft immediately, but once a
  // resource is `blocked` (a conflict was seen and not yet acknowledged via
  // reloadSession), further local edits are recorded without automatically
  // firing another request — the whole point of pausing is that resending
  // against a known-stale revision would just conflict again.
  function mutate(key, patch, resourceState, ctx) {
    ctx.mergeLocalDraft(patch)
    const book = ensureBook(key)
    book.editSeq += 1
    book.pendingPatch = { ...(book.pendingPatch || {}), ...patch }
    if (book.blocked) {
      resourceState.status = SAVE_STATUS.CONFLICT
      return Promise.resolve()
    }
    resourceState.status = SAVE_STATUS.DIRTY
    if (book.inFlight) return Promise.resolve()
    return drain(key, resourceState, ctx)
  }

  function retry(key, resourceState, ctx) {
    const book = ensureBook(key)
    if (book.inFlight || book.blocked || !book.pendingPatch) return Promise.resolve()
    return drain(key, resourceState, ctx)
  }

  function hasUnsettledWork(key) {
    const book = books.get(key)
    return Boolean(book && (book.inFlight || book.pendingPatch))
  }

  function anyUnsettled() {
    for (const book of books.values()) {
      if (book.inFlight || book.pendingPatch) return true
    }
    return false
  }

  function reset() {
    books.clear()
  }

  return { mutate, retry, hasUnsettledWork, anyUnsettled, reset }
}

function withSaveMeta(entity) {
  return { ...entity, _save: { status: SAVE_STATUS.IDLE, error: '' } }
}

function hydrateSession(raw) {
  return {
    ...raw,
    _save: { status: SAVE_STATUS.IDLE, error: '' },
    exercises: (raw.exercises || []).map((exercise) => ({
      ...withSaveMeta(exercise),
      sets: (exercise.sets || []).map((set) => withSaveMeta(set)),
    })),
  }
}

export function useWorkoutSession() {
  const session = ref(null)
  const isLoading = ref(false)
  const loadError = ref('')
  const isCompleting = ref(false)
  const isAborting = ref(false)
  const completionError = ref('')
  const abortError = ref('')
  const addingSetFor = ref(null)
  const addSetError = reactive({})

  const queue = createMutationQueue()
  let currentStudioId = null
  let currentSessionId = null
  let generation = 0

  function isMutable() {
    return session.value?.status === 'in_progress'
  }

  function reset() {
    generation += 1
    session.value = null
    isLoading.value = false
    loadError.value = ''
    queue.reset()
  }

  async function loadSession(studioId, sessionId) {
    const thisGeneration = ++generation
    currentStudioId = studioId
    currentSessionId = sessionId
    session.value = null
    isLoading.value = true
    loadError.value = ''
    try {
      const result = await getOwnWorkoutSession(studioId, sessionId)
      if (thisGeneration !== generation) return
      session.value = hydrateSession(result.workoutSession)
    } catch (error) {
      if (thisGeneration !== generation) return
      loadError.value = workoutErrorMessage(error)
    } finally {
      if (thisGeneration === generation) isLoading.value = false
    }
  }

  async function reloadSession() {
    if (!currentStudioId || !currentSessionId) return
    queue.reset()
    await loadSession(currentStudioId, currentSessionId)
  }

  function findExercise(exerciseId) {
    return (session.value?.exercises || []).find((exercise) => exercise.id === exerciseId) || null
  }

  function findSet(exerciseId, setId) {
    const exercise = findExercise(exerciseId)
    return exercise ? (exercise.sets || []).find((set) => set.id === setId) || null : null
  }

  // ---- Session note ----

  function updateSessionNote(memberNote) {
    if (!session.value) return Promise.resolve()
    const key = 'session'
    const resourceState = session.value._save
    return queue.mutate(key, { memberNote }, resourceState, {
      getRevision: () => session.value.revision,
      mergeLocalDraft: (patch) => { session.value.memberNote = patch.memberNote },
      send: (body) => updateWorkoutSession(currentStudioId, currentSessionId, body).then((r) => r.workoutSession),
      applyServerResult: (result) => {
        session.value.revision = result.revision
        session.value.memberNote = result.memberNote
      },
      applyServerRevisionOnly: (result) => { session.value.revision = result.revision },
    })
  }

  function retrySessionNote() {
    if (!session.value) return Promise.resolve()
    return queue.retry('session', session.value._save, {
      getRevision: () => session.value.revision,
      mergeLocalDraft: () => {},
      send: (body) => updateWorkoutSession(currentStudioId, currentSessionId, body).then((r) => r.workoutSession),
      applyServerResult: (result) => {
        session.value.revision = result.revision
        session.value.memberNote = result.memberNote
      },
      applyServerRevisionOnly: (result) => { session.value.revision = result.revision },
    })
  }

  // ---- Session exercises ----

  function updateExercise(exerciseId, patch) {
    const exercise = findExercise(exerciseId)
    if (!exercise) return Promise.resolve()
    const key = `exercise:${exerciseId}`
    return queue.mutate(key, patch, exercise._save, {
      getRevision: () => exercise.revision,
      mergeLocalDraft: (p) => {
        if (Object.hasOwn(p, 'status')) exercise.status = p.status
        if (Object.hasOwn(p, 'memberNote')) exercise.memberNote = p.memberNote
      },
      send: (body) => updateWorkoutSessionExercise(currentStudioId, currentSessionId, exerciseId, body)
        .then((r) => r.workoutExercise),
      applyServerResult: (result) => {
        exercise.revision = result.revision
        exercise.status = result.status
        exercise.memberNote = result.memberNote
      },
      applyServerRevisionOnly: (result) => { exercise.revision = result.revision },
    })
  }

  function retryExercise(exerciseId) {
    const exercise = findExercise(exerciseId)
    if (!exercise) return Promise.resolve()
    return queue.retry(`exercise:${exerciseId}`, exercise._save, {
      getRevision: () => exercise.revision,
      mergeLocalDraft: () => {},
      send: (body) => updateWorkoutSessionExercise(currentStudioId, currentSessionId, exerciseId, body)
        .then((r) => r.workoutExercise),
      applyServerResult: (result) => {
        exercise.revision = result.revision
        exercise.status = result.status
        exercise.memberNote = result.memberNote
      },
      applyServerRevisionOnly: (result) => { exercise.revision = result.revision },
    })
  }

  // ---- Session sets ----

  function updateSet(exerciseId, setId, patch) {
    const set = findSet(exerciseId, setId)
    if (!set) return Promise.resolve()
    const key = `set:${setId}`
    return queue.mutate(key, patch, set._save, {
      getRevision: () => set.revision,
      mergeLocalDraft: (p) => { Object.assign(set, p) },
      send: (body) => updateWorkoutSet(currentStudioId, currentSessionId, exerciseId, setId, body)
        .then((r) => r.workoutSet),
      applyServerResult: (result) => { Object.assign(set, result, { _save: set._save }) },
      applyServerRevisionOnly: (result) => { set.revision = result.revision },
    })
  }

  function retrySet(exerciseId, setId) {
    const set = findSet(exerciseId, setId)
    if (!set) return Promise.resolve()
    return queue.retry(`set:${setId}`, set._save, {
      getRevision: () => set.revision,
      mergeLocalDraft: () => {},
      send: (body) => updateWorkoutSet(currentStudioId, currentSessionId, exerciseId, setId, body)
        .then((r) => r.workoutSet),
      applyServerResult: (result) => { Object.assign(set, result, { _save: set._save }) },
      applyServerRevisionOnly: (result) => { set.revision = result.revision },
    })
  }

  async function addSet(exerciseId) {
    const exercise = findExercise(exerciseId)
    if (!exercise) return
    addingSetFor.value = exerciseId
    addSetError[exerciseId] = ''
    try {
      const result = await createWorkoutSet(currentStudioId, currentSessionId, exerciseId)
      exercise.sets.push(withSaveMeta(result.workoutSet))
    } catch (error) {
      addSetError[exerciseId] = workoutErrorMessage(error)
    } finally {
      if (addingSetFor.value === exerciseId) addingSetFor.value = null
    }
  }

  // ---- Whole-session actions ----

  function hasUnsettledWork() {
    if (queue.anyUnsettled()) return true
    return false
  }

  function firstIncompleteLocation() {
    for (const exercise of session.value?.exercises || []) {
      if (exercise.status === 'pending') return { exerciseId: exercise.id, setId: null }
      const pendingSet = (exercise.sets || []).find((set) => set.status === 'pending')
      if (exercise.status === 'completed' && pendingSet) return { exerciseId: exercise.id, setId: pendingSet.id }
    }
    return null
  }

  async function completeSession() {
    if (!session.value) return { ok: false }
    isCompleting.value = true
    completionError.value = ''
    try {
      const result = await completeWorkoutSession(currentStudioId, currentSessionId)
      session.value = hydrateSession(result.workoutSession)
      return { ok: true }
    } catch (error) {
      const incomplete = error?.data?.error?.code === 'WORKOUT_SESSION_INCOMPLETE'
      completionError.value = workoutErrorMessage(error)
      return { ok: false, incomplete, firstIncomplete: incomplete ? firstIncompleteLocation() : null }
    } finally {
      isCompleting.value = false
    }
  }

  async function abortSession() {
    if (!session.value) return { ok: false }
    isAborting.value = true
    abortError.value = ''
    try {
      const result = await abortWorkoutSession(currentStudioId, currentSessionId)
      session.value = hydrateSession(result.workoutSession)
      return { ok: true }
    } catch (error) {
      abortError.value = workoutErrorMessage(error)
      return { ok: false }
    } finally {
      isAborting.value = false
    }
  }

  return {
    session,
    isLoading,
    loadError,
    isCompleting,
    isAborting,
    completionError,
    abortError,
    addingSetFor,
    addSetError,
    isMutable,
    hasUnsettledWork,
    loadSession,
    reloadSession,
    reset,
    updateSessionNote,
    retrySessionNote,
    updateExercise,
    retryExercise,
    updateSet,
    retrySet,
    addSet,
    completeSession,
    abortSession,
  }
}
