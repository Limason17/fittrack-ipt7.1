import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({
  listCoachingRelationships: vi.fn(),
  createCoachingRelationship: vi.fn(),
  endCoachingRelationship: vi.fn(),
}))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

const studioApi = vi.hoisted(() => ({
  listMemberships: vi.fn(),
  listStudios: vi.fn(),
}))
vi.mock('../utils/studioApi', () => studioApi)

import CoachingRelationshipsView from './CoachingRelationshipsView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

const relationships = [
  {
    id: 'relationship-1',
    status: 'active',
    coach: { membershipId: 'membership-trainer', displayName: 'Trainer Eins' },
    member: { membershipId: 'membership-member', displayName: 'Mitglied Eins' },
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
  },
]

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

async function mountView(actorRole) {
  addAndSelectStudio(studio(actorRole))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId/coaching', name: 'studio-coaching', component: CoachingRelationshipsView },
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId/access-denied', name: 'studio-access-denied', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/coaching')
  await router.isReady()
  wrapper = mount(CoachingRelationshipsView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('CoachingRelationshipsView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Actor' }
    locale.value = 'de'
    trainingApi.listCoachingRelationships.mockReset()
    trainingApi.createCoachingRelationship.mockReset()
    trainingApi.endCoachingRelationship.mockReset()
    studioApi.listMemberships.mockReset()
    studioApi.listStudios.mockReset()
    trainingApi.listCoachingRelationships.mockResolvedValue({
      coachingRelationships: relationships,
      pagination: { total: 1, totalPages: 1 },
    })
    studioApi.listMemberships.mockResolvedValue({
      memberships: [
        { id: 'membership-trainer', role: 'trainer', status: 'active', user: { username: 'Trainer Eins' } },
        { id: 'membership-member', role: 'member', status: 'active', user: { username: 'Mitglied Eins' } },
      ],
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('lets an owner create a coaching relationship using two selected memberships', async () => {
    await mountView('owner')
    expect(studioApi.listMemberships).toHaveBeenCalled()
    trainingApi.createCoachingRelationship.mockResolvedValue({
      coachingRelationship: { ...relationships[0], id: 'relationship-2' },
    })

    await wrapper.find('#coaching-coach').setValue('membership-trainer')
    await wrapper.find('#coaching-member').setValue('membership-member')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(trainingApi.createCoachingRelationship).toHaveBeenCalledWith('studio-a', {
      coachMembershipId: 'membership-trainer',
      memberMembershipId: 'membership-member',
    })
  })

  it('shows an end action to owners for active relationships and asks for confirmation first', async () => {
    await mountView('owner')
    const endButton = wrapper.get('.table-actions button')
    expect(endButton.text()).toContain('Beenden')
    await endButton.trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('[role="dialog"]') || wrapper.find('[role="dialog"]').element
    expect(dialog).toBeTruthy()
    expect(trainingApi.endCoachingRelationship).not.toHaveBeenCalled()
  })

  it('hides the create form and end action from trainers, showing only their own scoped list', async () => {
    trainingApi.listCoachingRelationships.mockResolvedValue({
      coachingRelationships: relationships,
      pagination: { total: 1, totalPages: 1 },
    })
    await mountView('trainer')

    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.table-actions').exists()).toBe(false)
    expect(wrapper.text()).toContain('Du siehst ausschließlich die Mitglieder, die du aktuell betreust.')
    expect(wrapper.text()).toContain('Trainer Eins')
  })

  it('shows an empty state when there are no relationships yet', async () => {
    trainingApi.listCoachingRelationships.mockResolvedValue({ coachingRelationships: [], pagination: { total: 0, totalPages: 0 } })
    await mountView('owner')

    expect(wrapper.text()).toContain('Noch keine Coaching-Beziehungen vorhanden.')
  })

  it('shows a load error without logging the user out on a 403 response', async () => {
    const forbidden = new Error('forbidden')
    forbidden.status = 403
    trainingApi.listCoachingRelationships.mockRejectedValue(forbidden)
    studioApi.listStudios.mockResolvedValue({ studios: [studio('owner')] })
    await mountView('owner')

    expect(wrapper.text()).toContain('Deine aktuelle Rolle erlaubt diese Aktion nicht.')
    expect(authToken.value).toBe('token')
    expect(authUser.value).not.toBeNull()
  })
})
