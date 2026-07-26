import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({
  listProgramAssignments: vi.fn(),
  createProgramAssignment: vi.fn(),
  updateProgramAssignment: vi.fn(),
  listCoachingRelationships: vi.fn(),
  listTrainingPrograms: vi.fn(),
  listProgramVersions: vi.fn(),
}))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

const studioApi = vi.hoisted(() => ({
  listMemberships: vi.fn(),
}))
vi.mock('../utils/studioApi', () => studioApi)

import ProgramAssignmentsView from './ProgramAssignmentsView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

const assignments = [
  {
    id: 'assignment-1',
    status: 'active',
    program: { id: 'program-1', name: 'Beginner Strength', description: null },
    programVersion: { versionNumber: 1, status: 'published' },
    member: { membershipId: 'member-1', displayName: 'Member One' },
    startsOn: '2026-01-01',
    endsOn: null,
    assignedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
  },
  {
    id: 'assignment-2',
    status: 'completed',
    program: { id: 'program-1', name: 'Beginner Strength', description: null },
    programVersion: { versionNumber: 1, status: 'published' },
    member: { membershipId: 'member-2', displayName: 'Member Two' },
    startsOn: null,
    endsOn: null,
    assignedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-02-01T00:00:00.000Z',
    cancelledAt: null,
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

function dialogButton(label) {
  const buttons = [...document.body.querySelectorAll('[role="dialog"] button')]
  return buttons.find((button) => button.textContent.includes(label))
}

async function mountView(actorRole = 'trainer') {
  addAndSelectStudio(studio(actorRole))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId/assignments', name: 'studio-program-assignments', component: ProgramAssignmentsView },
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId/access-denied', name: 'studio-access-denied', component: { template: '<div />' } },
      {
        path: '/studios/:studioId/program-assignments/:assignmentId/schedule',
        name: 'studio-assignment-schedule',
        component: { template: '<div />' },
      },
    ],
  })
  await router.push('/studios/studio-a/assignments')
  await router.isReady()
  wrapper = mount(ProgramAssignmentsView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('ProgramAssignmentsView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Actor' }
    locale.value = 'de'
    Object.values(trainingApi).forEach((fn) => fn.mockReset())
    studioApi.listMemberships.mockReset()
    trainingApi.listProgramAssignments.mockResolvedValue({ programAssignments: assignments, pagination: { total: 2, totalPages: 1 } })
    studioApi.listMemberships.mockResolvedValue({
      memberships: [
        { id: 'member-1', role: 'member', status: 'active', user: { username: 'Member One' } },
        { id: 'member-2', role: 'member', status: 'active', user: { username: 'Member Two' } },
      ],
    })
    trainingApi.listCoachingRelationships.mockResolvedValue({
      coachingRelationships: [
        {
          id: 'rel-1',
          status: 'active',
          coach: { membershipId: 'coach-1', displayName: 'Trainer One' },
          member: { membershipId: 'member-1', displayName: 'Member One' },
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: null,
        },
      ],
    })
    trainingApi.listTrainingPrograms.mockResolvedValue({
      trainingPrograms: [{ id: 'program-1', name: 'Beginner Strength', description: null, status: 'active' }],
    })
    trainingApi.listProgramVersions.mockResolvedValue({
      programVersions: [{ id: 'version-1', versionNumber: 1, status: 'published', notes: null, publishedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }],
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('lists assignments with distinguishable status badges', async () => {
    await mountView()

    expect(wrapper.text()).toContain('Member One')
    expect(wrapper.text()).toContain('Member Two')
    expect(wrapper.text()).toContain('Aktiv')
    expect(wrapper.text()).toContain('Abgeschlossen')
  })

  it('filters the loaded page by status using the tabs', async () => {
    await mountView()
    const completedTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === 'Abgeschlossen')
    await completedTab.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Member Two')
    expect(wrapper.text()).not.toContain('Member One')
  })

  it('creates an assignment with an explicit coachingRelationshipId chosen for the selected member', async () => {
    await mountView()
    trainingApi.createProgramAssignment.mockResolvedValue({ programAssignment: assignments[0] })

    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    await wrapper.find('#assignment-member').setValue('member-1')
    await wrapper.find('#assignment-program').setValue('program-1')
    await flushPromises()
    await wrapper.find('#assignment-version').setValue('version-1')
    await wrapper.find('#assignment-relationship').setValue('rel-1')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(trainingApi.createProgramAssignment).toHaveBeenCalledWith('studio-a', expect.objectContaining({
      programVersionId: 'version-1',
      memberMembershipId: 'member-1',
      coachingRelationshipId: 'rel-1',
    }))
  })

  it('only offers coaching relationships that actually belong to the selected member', async () => {
    trainingApi.listCoachingRelationships.mockResolvedValue({
      coachingRelationships: [
        {
          id: 'rel-1',
          status: 'active',
          coach: { membershipId: 'coach-1', displayName: 'Trainer One' },
          member: { membershipId: 'member-1', displayName: 'Member One' },
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: null,
        },
        {
          id: 'rel-2',
          status: 'active',
          coach: { membershipId: 'coach-2', displayName: 'Trainer Two' },
          member: { membershipId: 'member-2', displayName: 'Member Two' },
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: null,
        },
      ],
    })
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    await wrapper.find('#assignment-member').setValue('member-1')
    await flushPromises()

    const relationshipOptions = wrapper.find('#assignment-relationship').findAll('option')
      .filter((option) => option.attributes('value'))
    expect(relationshipOptions).toHaveLength(1)
    expect(relationshipOptions[0].attributes('value')).toBe('rel-1')
    expect(wrapper.text()).not.toContain('Trainer Two')
  })

  it('shows a hint instead of a usable relationship when the selected member has none', async () => {
    trainingApi.listCoachingRelationships.mockResolvedValue({ coachingRelationships: [] })
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    await wrapper.find('#assignment-member').setValue('member-1')
    await flushPromises()

    expect(wrapper.text()).toContain('Für dieses Mitglied besteht keine aktive Coaching-Beziehung, die du verwenden kannst.')
  })

  it('completes and cancels an assignment only after confirmation', async () => {
    await mountView()
    trainingApi.updateProgramAssignment.mockResolvedValue({ programAssignment: { ...assignments[0], status: 'completed' } })

    const completeButton = wrapper.findAll('button').find((b) => b.text() === 'Abschließen')
    await completeButton.trigger('click')
    await flushPromises()
    expect(trainingApi.updateProgramAssignment).not.toHaveBeenCalled()

    dialogButton('Abschließen').click()
    await flushPromises()

    expect(trainingApi.updateProgramAssignment).toHaveBeenCalledWith('studio-a', 'assignment-1', { status: 'completed' })
  })

  it('shows an empty state when there are no assignments yet', async () => {
    trainingApi.listProgramAssignments.mockResolvedValue({ programAssignments: [], pagination: { total: 0, totalPages: 0 } })
    await mountView()

    expect(wrapper.text()).toContain('Noch keine Zuweisungen vorhanden.')
  })

  it('links to the schedule view for every assignment regardless of status', async () => {
    await mountView()

    const links = wrapper.findAllComponents({ name: 'RouterLink' })
      .filter((link) => link.props('to')?.name === 'studio-assignment-schedule')
    expect(links).toHaveLength(2)
    expect(links[0].props('to')).toEqual({
      name: 'studio-assignment-schedule',
      params: { studioId: 'studio-a', assignmentId: 'assignment-1' },
    })
    expect(links[1].props('to').params.assignmentId).toBe('assignment-2')
  })
})
