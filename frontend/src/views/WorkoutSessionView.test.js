import { flushPromises, mount } from '@vue/test-utils'
import { ref, reactive, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../utils/workoutSessionState', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useWorkoutSession: vi.fn() }
})

import WorkoutSessionView from './WorkoutSessionView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'
import { SAVE_STATUS, useWorkoutSession } from '../utils/workoutSessionState'

function withSaveMeta(entity) {
  const { _save, ...rest } = entity
  return { ...rest, _save: { status: SAVE_STATUS.IDLE, error: '', ..._save } }
}

function makeSet(overrides = {}) {
  return withSaveMeta({
    id: 'set-1', position: 1, status: 'pending',
    actualReps: null, actualWeight: null, actualDurationMinutes: null, actualDistanceKm: null, actualRpe: null,
    memberNote: null, revision: 0, completedAt: null,
    ...overrides,
  })
}

function makeExercise(overrides = {}) {
  return withSaveMeta({
    id: 'exercise-1', position: 1, exerciseNameSnapshot: 'Bench Press', instructionsSnapshot: 'Keep your back straight',
    targetSets: 2, targetRepsMin: 6, targetRepsMax: 8, targetWeight: 60, targetDurationMinutes: null,
    targetDistanceKm: null, targetRpe: null, restSeconds: 90, status: 'pending', memberNote: null, revision: 0,
    sets: [makeSet()],
    ...overrides,
  })
}

function makeSession(overrides = {}) {
  return withSaveMeta({
    id: 'session-1', assignmentId: 'assignment-1', status: 'in_progress', revision: 0,
    program: { id: 'program-1', name: 'Beginner Strength' }, programVersion: { versionNumber: 1 },
    programDay: { id: 'day-1', name: 'Day 1: Push' },
    startedAt: '2026-01-01T10:00:00.000Z', completedAt: null, abortedAt: null, memberNote: null,
    exercises: [makeExercise()],
    ...overrides,
  })
}

function makeController(overrides = {}) {
  const session = ref(overrides.session ?? makeSession())
  const controller = {
    session,
    isLoading: ref(overrides.isLoading ?? false),
    loadError: ref(overrides.loadError ?? ''),
    isCompleting: ref(false),
    isAborting: ref(false),
    completionError: ref(''),
    abortError: ref(''),
    addingSetFor: ref(null),
    addSetError: reactive({}),
    isMutable: () => session.value?.status === 'in_progress',
    hasUnsettledWork: overrides.hasUnsettledWork ?? (() => false),
    loadSession: vi.fn(),
    reloadSession: vi.fn(),
    reset: vi.fn(),
    updateSessionNote: vi.fn(),
    retrySessionNote: vi.fn(),
    updateExercise: vi.fn(),
    retryExercise: vi.fn(),
    updateSet: vi.fn(),
    retrySet: vi.fn(),
    addSet: vi.fn(),
    completeSession: overrides.completeSession ?? vi.fn().mockResolvedValue({ ok: true }),
    abortSession: overrides.abortSession ?? vi.fn().mockResolvedValue({ ok: true }),
  }
  return controller
}

let wrapper

function dialogButton(label) {
  const buttons = [...document.body.querySelectorAll('[role="dialog"] button')]
  return buttons.find((button) => button.textContent.includes(label))
}

function dialogText() {
  return document.body.querySelector('[role="dialog"]')?.textContent || ''
}

async function mountView(controller) {
  useWorkoutSession.mockReturnValue(controller)
  addAndSelectStudio({
    id: 'studio-a', name: 'Studio A', slug: 'studio-a', status: 'active',
    membership: { id: 'membership-member', role: 'member', status: 'active' },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId/workout-sessions/:sessionId', name: 'studio-workout-session-detail', component: WorkoutSessionView },
      { path: '/studios/:studioId/workout-sessions', name: 'studio-workout-sessions', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/workout-sessions/session-1')
  await router.isReady()
  wrapper = mount(WorkoutSessionView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('WorkoutSessionView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Member' }
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.clearAllMocks()
  })

  it('loads the session for the route params on mount', async () => {
    const controller = makeController()
    await mountView(controller)
    expect(controller.loadSession).toHaveBeenCalledWith('studio-a', 'session-1')
  })

  it('renders the program, day, status, and target values for an in-progress session', async () => {
    await mountView(makeController())
    expect(wrapper.text()).toContain('Day 1: Push')
    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Läuft')
    expect(wrapper.text()).toContain('Bench Press')
    expect(wrapper.text()).toContain('60 kg')
  })

  it('shows only relevant set fields: reps/weight for a strength exercise without duration/distance clutter', async () => {
    await mountView(makeController())
    expect(wrapper.find('input[type="number"][max="999.99"]').exists()).toBe(true) // weight
    expect(wrapper.text()).not.toContain('Dauer (min)')
  })

  it('shows a loading skeleton while fetching', async () => {
    await mountView(makeController({ isLoading: true, session: null }))
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('shows a load error message without any technical error code', async () => {
    await mountView(makeController({ loadError: 'Diese Trainingseinheit wurde nicht gefunden.', session: null }))
    expect(wrapper.text()).toContain('Diese Trainingseinheit wurde nicht gefunden.')
  })

  it('edits a set field and forwards the patch to updateSet', async () => {
    const controller = makeController()
    await mountView(controller)

    const repsInput = wrapper.find('#set-set-1-reps')
    await repsInput.setValue(8)
    await repsInput.trigger('blur')

    expect(controller.updateSet).toHaveBeenCalledWith('exercise-1', 'set-1', { actualReps: 8 })
  })

  it('rejects marking a set completed with no result metric at all, without calling updateSet', async () => {
    const controller = makeController()
    await mountView(controller)

    const completeButtons = wrapper.findAll('button').filter((b) => b.text() === 'Als erledigt markieren')
    await completeButtons[0].trigger('click')

    expect(controller.updateSet).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Ein abgeschlossener Satz braucht mindestens einen Wert')
  })

  it('adds a set via the addSet action', async () => {
    const controller = makeController()
    await mountView(controller)

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('Satz hinzufügen'))
    await addButton.trigger('click')
    expect(controller.addSet).toHaveBeenCalledWith('exercise-1')
  })

  it('disables adding sets and mutation controls for a terminal (completed) session', async () => {
    const completedSession = makeSession({
      status: 'completed', completedAt: '2026-01-01T12:00:00.000Z',
      exercises: [makeExercise({ status: 'completed', sets: [makeSet({ status: 'completed', actualReps: 8 })] })],
    })
    await mountView(makeController({ session: completedSession }))

    expect(wrapper.text()).toContain('Abgeschlossen')
    expect(wrapper.text()).toContain('Diese Session ist abgeschlossen und schreibgeschützt.')
    expect(wrapper.findAll('button').some((b) => b.text().includes('Satz hinzufügen'))).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Session abschließen')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Session abbrechen')).toBe(false)
    expect(wrapper.find('#set-set-1-reps').element.closest('fieldset').disabled).toBe(true)
  })

  it('preserves and displays already-logged values on an aborted (read-only) session', async () => {
    const abortedSession = makeSession({
      status: 'aborted', abortedAt: '2026-01-01T12:00:00.000Z',
      exercises: [makeExercise({ sets: [makeSet({ actualReps: 5, actualWeight: 40 })] })],
    })
    await mountView(makeController({ session: abortedSession }))

    expect(wrapper.text()).toContain('Abgebrochen')
    expect(wrapper.find('#set-set-1-reps').element.value).toBe('5')
    expect(wrapper.find('#set-set-1-weight').element.value).toBe('40')
  })

  it('blocks the complete action while unsettled saves/conflicts remain, with an explanatory message', async () => {
    await mountView(makeController({ hasUnsettledWork: () => true }))
    const completeButton = wrapper.findAll('button').find((b) => b.text().includes('Session abschließen'))
    expect(completeButton.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Warte, bis alle Änderungen gespeichert sind')
  })

  it('opens a confirm dialog before completing, and completes on confirmation', async () => {
    const controller = makeController()
    await mountView(controller)

    const completeButton = wrapper.findAll('button').find((b) => b.text().includes('Session abschließen'))
    await completeButton.trigger('click')
    expect(dialogText()).toContain('Session abschließen?')

    dialogButton('Session abschließen').click()
    await flushPromises()

    expect(controller.completeSession).toHaveBeenCalled()
  })

  it('on WORKOUT_SESSION_INCOMPLETE, closes the dialog, shows a summary, and highlights the first open exercise', async () => {
    const controller = makeController({
      completeSession: vi.fn().mockResolvedValue({
        ok: false, incomplete: true, firstIncomplete: { exerciseId: 'exercise-1', setId: null },
      }),
    })
    await mountView(controller)

    const completeButton = wrapper.findAll('button').find((b) => b.text().includes('Session abschließen'))
    await completeButton.trigger('click')
    dialogButton('Session abschließen').click()
    await flushPromises()
    await nextTick()

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.text()).toContain('Die Session ist noch nicht vollständig')
    expect(wrapper.find('#exercise-exercise-1').classes()).toContain('exercise-panel-highlighted')
  })

  it('opens a confirm dialog with a consequence text before aborting, and aborts on confirmation', async () => {
    const controller = makeController()
    await mountView(controller)

    const abortButton = wrapper.findAll('button').find((b) => b.text().includes('Session abbrechen'))
    await abortButton.trigger('click')
    expect(dialogText()).toContain('Session abbrechen?')
    expect(dialogText()).toContain('schreibgeschützt')

    dialogButton('Session abbrechen').click()
    await flushPromises()

    expect(controller.abortSession).toHaveBeenCalled()
  })

  it('shows a conflict banner with a reload action, never silently overwriting the server state', async () => {
    const conflictedSet = makeSet({ actualReps: 9, _save: { status: SAVE_STATUS.CONFLICT, error: 'WORKOUT_SET_CONFLICT' } })
    const controller = makeController({
      session: makeSession({ exercises: [makeExercise({ sets: [conflictedSet] })] }),
    })
    await mountView(controller)

    expect(wrapper.text()).toContain('Diese Daten wurden inzwischen durch eine andere Anfrage verändert.')
    const reloadButton = wrapper.findAll('button').find((b) => b.text().includes('Aktuellen Stand laden'))
    await reloadButton.trigger('click')
    expect(controller.reloadSession).toHaveBeenCalled()
  })

  it('reloads on studio/session param change and resets state on unmount (workspace switch / navigation away)', async () => {
    const controller = makeController()
    await mountView(controller)
    expect(controller.loadSession).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    expect(controller.reset).toHaveBeenCalled()
  })
})
