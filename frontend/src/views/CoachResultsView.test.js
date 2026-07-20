import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({ listOwnCoachingRelationships: vi.fn() }))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

const sessionApi = vi.hoisted(() => ({ listCoachedMemberWorkoutSessions: vi.fn() }))
vi.mock('../utils/workoutSessionApi', () => sessionApi)

import CoachResultsView from './CoachResultsView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

let wrapper

function relationship(overrides = {}) {
  return {
    id: 'rel-1',
    status: 'active',
    member: { membershipId: 'member-1', displayName: 'Anna Beispiel' },
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function session(overrides = {}) {
  return {
    id: 'session-1',
    status: 'completed',
    program: { id: 'program-1', name: 'Beginner Strength' },
    programDay: { id: 'day-1', name: 'Day 1: Push' },
    startedAt: '2026-07-01T10:00:00.000Z',
    completedAt: '2026-07-01T11:00:00.000Z',
    abortedAt: null,
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
      { path: '/studios/:studioId/coach-results', name: 'studio-coach-results', component: CoachResultsView },
      {
        path: '/studios/:studioId/coach-results/:memberMembershipId/sessions/:sessionId',
        name: 'studio-coach-result-session-detail',
        component: { template: '<div />' },
      },
    ],
  })
  await router.push('/studios/studio-a/coach-results')
  await router.isReady()
  wrapper = mount(CoachResultsView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('CoachResultsView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Trainer' }
    locale.value = 'de'
    trainingApi.listOwnCoachingRelationships.mockReset()
    sessionApi.listCoachedMemberWorkoutSessions.mockReset()
    trainingApi.listOwnCoachingRelationships.mockResolvedValue({ coachingRelationships: [], pagination: { total: 0 } })
    sessionApi.listCoachedMemberWorkoutSessions.mockResolvedValue({ workoutSessions: [], pagination: { total: 0, page: 1, totalPages: 0 } })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('loads only the coach\'s own active coaching relationships', async () => {
    await mountView()
    expect(trainingApi.listOwnCoachingRelationships).toHaveBeenCalledWith('studio-a', { status: 'active', page: 1, limit: 100 })
  })

  it('shows an empty state when there are no active coaching relationships', async () => {
    await mountView()
    expect(wrapper.text()).toContain('Du hast aktuell keine eigenen aktiven Coaching-Beziehungen.')
  })

  it('lists each coaching member with their name and relationship start date', async () => {
    trainingApi.listOwnCoachingRelationships.mockResolvedValue({
      coachingRelationships: [relationship()], pagination: { total: 1 },
    })
    await mountView()
    expect(wrapper.text()).toContain('Anna Beispiel')
    expect(wrapper.findAll('.coach-member-card')).toHaveLength(1)
  })

  it('selecting a member loads and displays their sessions', async () => {
    trainingApi.listOwnCoachingRelationships.mockResolvedValue({
      coachingRelationships: [relationship()], pagination: { total: 1 },
    })
    sessionApi.listCoachedMemberWorkoutSessions.mockResolvedValue({
      workoutSessions: [session()], pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(sessionApi.listCoachedMemberWorkoutSessions).toHaveBeenCalledWith(
      'studio-a', 'member-1', { page: 1, limit: 20, status: undefined }
    )
    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Day 1: Push')
  })

  it('sends the selected status filter to the backend', async () => {
    trainingApi.listOwnCoachingRelationships.mockResolvedValue({
      coachingRelationships: [relationship()], pagination: { total: 1 },
    })
    sessionApi.listCoachedMemberWorkoutSessions.mockResolvedValueOnce({
      workoutSessions: [session()], pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    sessionApi.listCoachedMemberWorkoutSessions.mockResolvedValueOnce({
      workoutSessions: [], pagination: { total: 0, page: 1, totalPages: 0 },
    })
    const abortedTab = wrapper.findAll('[role="tab"]').find((tabButton) => tabButton.text() === 'Abgebrochen')
    await abortedTab.trigger('click')
    await flushPromises()

    expect(sessionApi.listCoachedMemberWorkoutSessions).toHaveBeenLastCalledWith(
      'studio-a', 'member-1', { page: 1, limit: 20, status: 'aborted' }
    )
  })

  it('a link to the session detail carries the studio, member and session id', async () => {
    trainingApi.listOwnCoachingRelationships.mockResolvedValue({
      coachingRelationships: [relationship()], pagination: { total: 1 },
    })
    sessionApi.listCoachedMemberWorkoutSessions.mockResolvedValue({
      workoutSessions: [session()], pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const link = wrapper.find('a.btn')
    expect(link.attributes('href')).toBe('/studios/studio-a/coach-results/member-1/sessions/session-1')
  })

  it('going back to the member list clears the session list', async () => {
    trainingApi.listOwnCoachingRelationships.mockResolvedValue({
      coachingRelationships: [relationship()], pagination: { total: 1 },
    })
    sessionApi.listCoachedMemberWorkoutSessions.mockResolvedValue({
      workoutSessions: [session()], pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Beginner Strength')

    const backButton = wrapper.findAll('button').find((b) => b.text().includes('Zurück zur Mitgliederliste'))
    await backButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Anna Beispiel')
    expect(wrapper.text()).not.toContain('Beginner Strength')
  })

  it('shows a load error when the relationships request fails', async () => {
    trainingApi.listOwnCoachingRelationships.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    await mountView()
    expect(wrapper.text()).toContain('Deine Coaching-Mitglieder konnten nicht geladen werden.')
  })
})
