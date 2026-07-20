import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({ listOwnWorkoutSessions: vi.fn() }))
vi.mock('../utils/workoutSessionApi', () => api)

import WorkoutSessionHistoryView from './WorkoutSessionHistoryView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

let wrapper

function session(overrides = {}) {
  return {
    id: 'session-1',
    status: 'in_progress',
    program: { id: 'program-1', name: 'Beginner Strength' },
    programDay: { id: 'day-1', name: 'Day 1: Push' },
    startedAt: '2026-07-01T10:00:00.000Z',
    completedAt: null,
    abortedAt: null,
    ...overrides,
  }
}

function studio(role = 'member') {
  return {
    id: 'studio-a',
    name: 'Studio A',
    slug: 'studio-a',
    status: 'active',
    membership: { id: `membership-${role}`, role, status: 'active' },
  }
}

async function mountView(role = 'member') {
  addAndSelectStudio(studio(role))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId/workout-sessions', name: 'studio-workout-sessions', component: WorkoutSessionHistoryView },
      { path: '/studios/:studioId/workout-sessions/:sessionId', name: 'studio-workout-session-detail', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/workout-sessions')
  await router.isReady()
  wrapper = mount(WorkoutSessionHistoryView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('WorkoutSessionHistoryView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Member' }
    locale.value = 'de'
    api.listOwnWorkoutSessions.mockReset()
    api.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [],
      pagination: { total: 0, page: 1, totalPages: 0 },
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('loads only the own sessions for the current studio on mount', async () => {
    await mountView()
    expect(api.listOwnWorkoutSessions).toHaveBeenCalledWith('studio-a', { page: 1, limit: 20 })
  })

  it('shows a loading skeleton while fetching', async () => {
    let resolveFetch
    api.listOwnWorkoutSessions.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
    addAndSelectStudio(studio())
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/studios/:studioId/workout-sessions', name: 'studio-workout-sessions', component: WorkoutSessionHistoryView }],
    })
    await router.push('/studios/studio-a/workout-sessions')
    await router.isReady()
    wrapper = mount(WorkoutSessionHistoryView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)

    resolveFetch({ workoutSessions: [], pagination: { total: 0, page: 1, totalPages: 0 } })
    await flushPromises()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
  })

  it('renders a row per session with date, program, day, status and finished-at', async () => {
    api.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [session({
        id: 'session-2', status: 'completed', completedAt: '2026-07-01T11:30:00.000Z',
      })],
      pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()

    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Day 1: Push')
    expect(wrapper.text()).toContain('Abgeschlossen')
  })

  it('shows a resume link for an in-progress session and a view-details link for a finished one', async () => {
    api.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [
        session({ id: 'session-running', status: 'in_progress' }),
        session({ id: 'session-done', status: 'completed', completedAt: '2026-07-01T11:00:00.000Z' }),
      ],
      pagination: { total: 2, page: 1, totalPages: 1 },
    })
    await mountView()

    const links = wrapper.findAll('a')
    const resumeLink = links.find((a) => a.attributes('href')?.includes('session-running'))
    const detailLink = links.find((a) => a.attributes('href')?.includes('session-done'))
    expect(resumeLink.text()).toBe('Fortsetzen')
    expect(detailLink.text()).toBe('Details ansehen')
  })

  it('shows a dash for finished-at on a still-running session', async () => {
    api.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [session({ id: 'session-running', status: 'in_progress' })],
      pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()

    const row = wrapper.find('tbody tr')
    expect(row.text()).toContain('—')
  })

  it('shows an empty state when there are no sessions', async () => {
    await mountView()
    expect(wrapper.text()).toContain('Noch keine Trainingseinheiten vorhanden.')
  })

  it('shows an understandable error message when loading fails', async () => {
    api.listOwnWorkoutSessions.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    await mountView()

    expect(wrapper.get('[role="alert"]').text().length).toBeGreaterThan(0)
  })

  it('sends the selected status filter to the backend instead of filtering an already-loaded page', async () => {
    api.listOwnWorkoutSessions.mockResolvedValueOnce({
      workoutSessions: [
        session({ id: 'session-running', status: 'in_progress' }),
        session({ id: 'session-done', status: 'completed', completedAt: '2026-07-01T11:00:00.000Z' }),
      ],
      pagination: { total: 2, page: 1, totalPages: 1 },
    })
    await mountView()
    expect(api.listOwnWorkoutSessions).toHaveBeenCalledTimes(1)

    api.listOwnWorkoutSessions.mockResolvedValueOnce({
      workoutSessions: [session({ id: 'session-done', status: 'completed', completedAt: '2026-07-01T11:00:00.000Z' })],
      pagination: { total: 1, page: 1, totalPages: 1 },
    })
    const tabs = wrapper.findAll('[role="tab"]')
    const completedTab = tabs.find((tabButton) => tabButton.text() === 'Abgeschlossen')
    await completedTab.trigger('click')
    await flushPromises()

    expect(api.listOwnWorkoutSessions).toHaveBeenCalledTimes(2)
    expect(api.listOwnWorkoutSessions).toHaveBeenLastCalledWith('studio-a', { page: 1, limit: 20, status: 'completed' })
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('resets to page 1 when the status filter changes', async () => {
    api.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [session({ id: 'session-1' })],
      pagination: { total: 40, page: 2, totalPages: 2 },
    })
    await mountView()
    const nextButton = wrapper.findAll('button').find((b) => b.text() === 'Weiter')
    await nextButton.trigger('click')
    await flushPromises()
    expect(api.listOwnWorkoutSessions).toHaveBeenLastCalledWith('studio-a', { page: 2, limit: 20, status: undefined })

    const tabs = wrapper.findAll('[role="tab"]')
    const abortedTab = tabs.find((tabButton) => tabButton.text() === 'Abgebrochen')
    await abortedTab.trigger('click')
    await flushPromises()

    expect(api.listOwnWorkoutSessions).toHaveBeenLastCalledWith('studio-a', { page: 1, limit: 20, status: 'aborted' })
  })

  it('shows a filter-specific empty state when sessions exist overall but none match the selected status', async () => {
    api.listOwnWorkoutSessions.mockResolvedValueOnce({
      workoutSessions: [session({ id: 'session-running', status: 'in_progress' })],
      pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()

    api.listOwnWorkoutSessions.mockResolvedValueOnce({ workoutSessions: [], pagination: { total: 0, page: 1, totalPages: 0 } })
    const tabs = wrapper.findAll('[role="tab"]')
    const completedTab = tabs.find((tabButton) => tabButton.text() === 'Abgeschlossen')
    await completedTab.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Keine Trainingseinheiten mit diesem Status.')
    expect(wrapper.text()).not.toContain('Noch keine Trainingseinheiten vorhanden.')
  })

  it('shows the generic empty state, not the filtered one, when there are no sessions at all', async () => {
    api.listOwnWorkoutSessions.mockResolvedValue({ workoutSessions: [], pagination: { total: 0, page: 1, totalPages: 0 } })
    await mountView()

    const tabs = wrapper.findAll('[role="tab"]')
    const completedTab = tabs.find((tabButton) => tabButton.text() === 'Abgeschlossen')
    await completedTab.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Noch keine Trainingseinheiten vorhanden.')
    expect(wrapper.text()).not.toContain('Keine Trainingseinheiten mit diesem Status.')
  })

  it('fetches the next page from the backend when paginating', async () => {
    api.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [session({ id: 'session-1' })],
      pagination: { total: 40, page: 1, totalPages: 2 },
    })
    await mountView()

    const nextButton = wrapper.findAll('button').find((b) => b.text() === 'Weiter')
    await nextButton.trigger('click')
    await flushPromises()

    expect(api.listOwnWorkoutSessions).toHaveBeenCalledWith('studio-a', { page: 2, limit: 20 })
  })

  it('resets to page 1 and clears the filter when the studio route param changes', async () => {
    api.listOwnWorkoutSessions.mockResolvedValue({
      workoutSessions: [session({ id: 'session-1' })],
      pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()
    const router = wrapper.vm.$.appContext.config.globalProperties.$router
    await router.push('/studios/studio-b/workout-sessions')
    await flushPromises()

    expect(api.listOwnWorkoutSessions).toHaveBeenCalledWith('studio-b', { page: 1, limit: 20 })
  })
})
