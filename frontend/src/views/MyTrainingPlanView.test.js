import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({
  listOwnProgramAssignments: vi.fn(),
  getOwnProgramAssignmentDetail: vi.fn(),
}))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

const sessionApi = vi.hoisted(() => ({
  listOwnWorkoutSessions: vi.fn(),
}))
vi.mock('../utils/workoutSessionApi', () => sessionApi)

const sessionState = vi.hoisted(() => ({
  startWorkoutSession: vi.fn(),
}))
vi.mock('../utils/workoutSessionState', () => sessionState)

import MyTrainingPlanView from './MyTrainingPlanView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

const ownAssignment = {
  id: 'assignment-1',
  status: 'active',
  program: { id: 'program-1', name: 'Beginner Strength', description: 'Onboarding plan' },
  programVersion: { versionNumber: 1, status: 'published' },
  startsOn: '2026-01-01',
  endsOn: null,
  assignedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
}

const assignmentDetail = {
  ...ownAssignment,
  days: [
    {
      id: 'day-1',
      position: 1,
      name: 'Day 1: Push',
      instructions: 'Warm up first',
      exercises: [
        {
          id: 'ex-1', position: 1, exerciseNameSnapshot: 'Bench Press', instructions: null,
          targetSets: 4, targetRepsMin: 6, targetRepsMax: 8, targetWeight: 60,
          targetDurationMinutes: null, targetDistanceKm: null, targetRpe: null, restSeconds: 90,
        },
      ],
    },
  ],
}

function studio(role) {
  return {
    id: 'studio-a',
    name: 'Studio A',
    slug: 'studio-a',
    status: 'active',
    membership: { id: `actor-${role}`, role, status: 'active' },
  }
}

let wrapper

async function mountView(actorRole = 'member') {
  addAndSelectStudio(studio(actorRole))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId/my-training-plan', name: 'studio-my-training-plan', component: MyTrainingPlanView },
      { path: '/studios/:studioId/workout-sessions', name: 'studio-workout-sessions', component: { template: '<div />' } },
      { path: '/studios/:studioId/workout-sessions/:sessionId', name: 'studio-workout-session-detail', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/my-training-plan')
  await router.isReady()
  wrapper = mount(MyTrainingPlanView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('MyTrainingPlanView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Actor' }
    locale.value = 'de'
    trainingApi.listOwnProgramAssignments.mockReset()
    trainingApi.getOwnProgramAssignmentDetail.mockReset()
    sessionApi.listOwnWorkoutSessions.mockReset()
    sessionState.startWorkoutSession.mockReset()
    trainingApi.listOwnProgramAssignments.mockResolvedValue({ programAssignments: [ownAssignment], pagination: { total: 1 } })
    trainingApi.getOwnProgramAssignmentDetail.mockResolvedValue({ programAssignment: assignmentDetail })
    sessionApi.listOwnWorkoutSessions.mockResolvedValue({ workoutSessions: [], pagination: { total: 0 } })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it("shows the member's own assigned program with version and dates; the start action is nested inside the collapsed day details", async () => {
    await mountView()

    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Version 1')
    expect(wrapper.text()).toContain('Aktiv')
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(false)
  })

  it('lazily loads days and exercises after "Details anzeigen" is clicked, and offers a start action for the active, in-window day', async () => {
    await mountView()
    expect(trainingApi.getOwnProgramAssignmentDetail).not.toHaveBeenCalled()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(trainingApi.getOwnProgramAssignmentDetail).toHaveBeenCalledWith('studio-a', 'assignment-1')
    expect(wrapper.text()).toContain('Day 1: Push')
    expect(wrapper.text()).toContain('Bench Press')
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(true)
  })

  it('starts a session and navigates to it when the start action is used', async () => {
    sessionState.startWorkoutSession.mockResolvedValue({
      session: { id: 'session-1' }, error: null,
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const startButton = wrapper.findAll('button').find((b) => /training starten/i.test(b.text()))
    await startButton.trigger('click')
    await flushPromises()

    expect(sessionState.startWorkoutSession).toHaveBeenCalledWith('studio-a', 'assignment-1', 'day-1')
    expect(wrapper.vm.$route.name).toBe('studio-workout-session-detail')
    expect(wrapper.vm.$route.params.sessionId).toBe('session-1')
  })

  it('shows an inline error and stays on the page when starting fails', async () => {
    sessionState.startWorkoutSession.mockResolvedValue({
      session: null, error: { status: 409, data: { error: { code: 'WORKOUT_DAY_NOT_AVAILABLE' } } },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const startButton = wrapper.findAll('button').find((b) => /training starten/i.test(b.text()))
    await startButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Dieser Trainingstag gehört nicht zur zugewiesenen Programmversion.')
    expect(wrapper.vm.$route.name).toBe('studio-my-training-plan')
  })

  it('offers "Fortsetzen" instead of "Training starten" when an in-progress session already exists, found via an exact server-side filter rather than a history-page scan', async () => {
    sessionApi.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [{
        id: 'session-existing', assignmentId: 'assignment-1', status: 'in_progress',
        programDay: { id: 'day-1', name: 'Day 1: Push' },
      }],
      pagination: { total: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(sessionApi.listOwnWorkoutSessions).toHaveBeenCalledWith('studio-a', {
      status: 'in_progress', assignmentId: 'assignment-1', programDayId: 'day-1', limit: 5,
    })
    expect(wrapper.findAll('button').some((b) => /fortsetzen/i.test(b.text()))).toBe(true)
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(false)

    const resumeButton = wrapper.findAll('button').find((b) => /fortsetzen/i.test(b.text()))
    await resumeButton.trigger('click')
    await flushPromises()

    expect(sessionState.startWorkoutSession).not.toHaveBeenCalled()
    expect(wrapper.vm.$route.params.sessionId).toBe('session-existing')
  })

  it('offers "Training starten" when the exact filter finds no running session for this assignment and day', async () => {
    sessionApi.listOwnWorkoutSessions.mockResolvedValue({ workoutSessions: [], pagination: { total: 0 } })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(true)
    expect(wrapper.findAll('button').some((b) => /fortsetzen/i.test(b.text()))).toBe(false)
  })

  it('never silently picks one when multiple in-progress sessions exist for the same day, and offers no normal start action', async () => {
    sessionApi.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [
        { id: 'session-a', assignmentId: 'assignment-1', status: 'in_progress', programDay: { id: 'day-1', name: 'Day 1: Push' } },
        { id: 'session-b', assignmentId: 'assignment-1', status: 'in_progress', programDay: { id: 'day-1', name: 'Day 1: Push' } },
      ],
      pagination: { total: 2 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('button').some((b) => /fortsetzen/i.test(b.text()))).toBe(false)
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(false)
    expect(wrapper.text()).toContain('laufen aktuell 2 Trainings gleichzeitig')
    const historyLink = wrapper.findAll('a').find((a) => /meine trainings öffnen/i.test(a.text()))
    expect(historyLink).toBeTruthy()
  })

  it('shows an explanatory reason instead of a start action when the assignment is not active', async () => {
    trainingApi.listOwnProgramAssignments.mockResolvedValue({
      programAssignments: [{ ...ownAssignment, status: 'cancelled' }], pagination: { total: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Diese Zuweisung ist aktuell nicht aktiv.')
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(false)
  })

  it('shows an explanatory reason instead of a start action before the assignment start date', async () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10)
    trainingApi.listOwnProgramAssignments.mockResolvedValue({
      programAssignments: [{ ...ownAssignment, startsOn: farFuture }], pagination: { total: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Dieses Programm beginnt am')
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(false)
  })

  it('treats a plain YYYY-MM-DD startsOn/endsOn exactly at today as already available, with no timezone-induced shift', async () => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    trainingApi.listOwnProgramAssignments.mockResolvedValue({
      programAssignments: [{ ...ownAssignment, startsOn: today, endsOn: today }], pagination: { total: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Dieses Programm beginnt am')
    expect(wrapper.text()).not.toContain('war bis zum')
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(true)
  })

  it('blocks starting the day after a plain YYYY-MM-DD endsOn that already passed', async () => {
    const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString().slice(0, 10)
    trainingApi.listOwnProgramAssignments.mockResolvedValue({
      programAssignments: [{ ...ownAssignment, endsOn: yesterday }], pagination: { total: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('war bis zum')
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(false)
  })

  it('collapses details again without a second network call when toggled twice, then reloads on a third toggle', async () => {
    await mountView()
    const toggle = wrapper.get('button')
    await toggle.trigger('click')
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Day 1: Push')
    expect(trainingApi.getOwnProgramAssignmentDetail).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when no program is assigned', async () => {
    trainingApi.listOwnProgramAssignments.mockResolvedValue({ programAssignments: [], pagination: { total: 0 } })
    await mountView()

    expect(wrapper.text()).toContain('Dir ist aktuell kein Trainingsprogramm zugewiesen.')
  })

  it('shows a load error message on failure', async () => {
    trainingApi.listOwnProgramAssignments.mockRejectedValue(new Error('network error'))
    await mountView()

    expect(wrapper.text()).toContain('Dein Trainingsplan konnte nicht geladen werden.')
  })
})
