import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const sessionApi = vi.hoisted(() => ({
  getCoachedMemberWorkoutSession: vi.fn(),
  listWorkoutSessionFeedback: vi.fn(),
  createWorkoutSessionFeedback: vi.fn(),
}))
vi.mock('../utils/workoutSessionApi', () => sessionApi)

import CoachSessionDetailView from './CoachSessionDetailView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

let wrapper

function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    status: 'completed',
    member: { membershipId: 'member-1', displayName: 'Anna Beispiel' },
    program: { id: 'program-1', name: 'Beginner Strength' },
    programVersion: { versionNumber: 1 },
    programDay: { id: 'day-1', name: 'Day 1: Push' },
    startedAt: '2026-07-01T10:00:00.000Z',
    completedAt: '2026-07-01T11:00:00.000Z',
    abortedAt: null,
    memberNote: 'Felt strong today.',
    exercises: [
      {
        id: 'exercise-1',
        position: 1,
        exerciseNameSnapshot: 'Bench Press',
        instructionsSnapshot: 'Keep your back flat.',
        targetSets: 2, targetRepsMin: 6, targetRepsMax: 8, targetWeight: 60,
        targetDurationMinutes: null, targetDistanceKm: null, targetRpe: null, restSeconds: 90,
        status: 'completed',
        memberNote: 'Bar felt heavy on set 2.',
        sets: [
          { id: 'set-1', position: 1, status: 'completed', actualReps: 7, actualWeight: 60, actualDurationMinutes: null, actualDistanceKm: null, actualRpe: null, memberNote: null },
        ],
      },
    ],
    ...overrides,
  }
}

function studio(role = 'trainer') {
  return {
    id: 'studio-a',
    name: 'Studio A',
    slug: 'studio-a',
    status: 'active',
    membership: { id: `membership-${role}`, role, status: 'active' },
  }
}

async function mountView(role = 'trainer') {
  addAndSelectStudio(studio(role))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/studios/:studioId/coach-results/:memberMembershipId/sessions/:sessionId',
        name: 'studio-coach-result-session-detail',
        component: CoachSessionDetailView,
      },
      { path: '/studios/:studioId/coach-results', name: 'studio-coach-results', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/coach-results/member-1/sessions/session-1')
  await router.isReady()
  wrapper = mount(CoachSessionDetailView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('CoachSessionDetailView', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Trainer' }
    locale.value = 'de'
    sessionApi.getCoachedMemberWorkoutSession.mockReset()
    sessionApi.listWorkoutSessionFeedback.mockReset()
    sessionApi.createWorkoutSessionFeedback.mockReset()
    sessionApi.getCoachedMemberWorkoutSession.mockResolvedValue({ workoutSession: makeSession() })
    sessionApi.listWorkoutSessionFeedback.mockResolvedValue({ workoutSessionFeedback: [], pagination: { total: 0 } })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('loads the session with the exact studio/member/session route params', async () => {
    await mountView()
    expect(sessionApi.getCoachedMemberWorkoutSession).toHaveBeenCalledWith('studio-a', 'member-1', 'session-1')
  })

  it('renders member name, program, day, status and target-vs-actual values', async () => {
    await mountView()
    expect(wrapper.text()).toContain('Anna Beispiel')
    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Day 1: Push')
    expect(wrapper.text()).toContain('Abgeschlossen')
    expect(wrapper.text()).toContain('Bench Press')
    expect(wrapper.text()).toContain('7 Wdh.')
    expect(wrapper.text()).toContain('60 kg')
  })

  it('shows member notes at session, exercise and set level when present', async () => {
    await mountView()
    expect(wrapper.text()).toContain('Felt strong today.')
    expect(wrapper.text()).toContain('Bar felt heavy on set 2.')
  })

  it('is entirely read-only: no input, textarea beyond feedback, or mutation button exists', async () => {
    await mountView()
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => /abschließen|abbrechen|erledigt|überspringen/i.test(b.text()))).toBe(false)
    expect(wrapper.text()).toContain('Diese Ansicht ist schreibgeschützt.')
  })

  it('shows an understandable error instead of raw details when the session cannot be loaded', async () => {
    sessionApi.getCoachedMemberWorkoutSession.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    await mountView()
    expect(wrapper.text()).toContain('nicht verfügbar')
  })

  it('hides the feedback form and shows a hint for an in_progress session, but still shows the feedback list', async () => {
    sessionApi.getCoachedMemberWorkoutSession.mockResolvedValue({
      workoutSession: makeSession({ status: 'in_progress', completedAt: null }),
    })
    await mountView()

    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).toContain('Feedback ist möglich, sobald diese Session abgeschlossen oder abgebrochen wurde.')
  })

  it('shows the feedback form for a completed session and displays existing feedback', async () => {
    sessionApi.listWorkoutSessionFeedback.mockResolvedValue({
      workoutSessionFeedback: [
        { id: 'fb-1', coach: { membershipId: 'membership-trainer', displayName: 'Trainer' }, body: 'Nice tempo.', createdAt: '2026-07-01T12:00:00.000Z' },
      ],
      pagination: { total: 1 },
    })
    await mountView()

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('Nice tempo.')
  })

  it('shows the feedback form for an aborted session too', async () => {
    sessionApi.getCoachedMemberWorkoutSession.mockResolvedValue({
      workoutSession: makeSession({ status: 'aborted', completedAt: null, abortedAt: '2026-07-01T10:30:00.000Z' }),
    })
    await mountView()
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('submitting feedback sends studio/session id and clears the form on success', async () => {
    sessionApi.createWorkoutSessionFeedback.mockResolvedValue({
      workoutSessionFeedback: { id: 'fb-new', coach: { membershipId: 'membership-trainer', displayName: 'Trainer' }, body: 'Great job', createdAt: '2026-07-01T13:00:00.000Z' },
    })
    await mountView()

    await wrapper.get('textarea').setValue('Great job')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(sessionApi.createWorkoutSessionFeedback).toHaveBeenCalledWith(
      'studio-a', 'session-1', { clientFeedbackKey: expect.any(String), body: 'Great job' }
    )
    expect(wrapper.get('textarea').element.value).toBe('')
    expect(wrapper.text()).toContain('Great job')
  })

  it('a network error keeps the drafted feedback text visible in the form', async () => {
    sessionApi.createWorkoutSessionFeedback.mockRejectedValue(Object.assign(new Error('network'), { status: 0 }))
    await mountView()

    await wrapper.get('textarea').setValue('Do not lose this text')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('textarea').element.value).toBe('Do not lose this text')
  })

  it('reloads session and feedback when the route session id changes', async () => {
    await mountView()
    expect(sessionApi.getCoachedMemberWorkoutSession).toHaveBeenCalledTimes(1)

    const router = wrapper.vm.$.appContext.config.globalProperties.$router
    await router.push('/studios/studio-a/coach-results/member-1/sessions/session-2')
    await flushPromises()

    expect(sessionApi.getCoachedMemberWorkoutSession).toHaveBeenCalledWith('studio-a', 'member-1', 'session-2')
  })
})
