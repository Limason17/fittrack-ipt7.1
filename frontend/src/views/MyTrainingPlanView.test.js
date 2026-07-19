import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({
  listOwnProgramAssignments: vi.fn(),
  getOwnProgramAssignmentDetail: vi.fn(),
}))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

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
    trainingApi.listOwnProgramAssignments.mockResolvedValue({ programAssignments: [ownAssignment], pagination: { total: 1 } })
    trainingApi.getOwnProgramAssignmentDetail.mockResolvedValue({ programAssignment: assignmentDetail })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it("shows the member's own assigned program with version and dates but no training-start action", async () => {
    await mountView()

    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Version 1')
    expect(wrapper.text()).toContain('Aktiv')
    expect(wrapper.findAll('button').some((b) => /training starten/i.test(b.text()))).toBe(false)
  })

  it('lazily loads and displays days and exercises only after "Details anzeigen" is clicked', async () => {
    await mountView()
    expect(trainingApi.getOwnProgramAssignmentDetail).not.toHaveBeenCalled()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(trainingApi.getOwnProgramAssignmentDetail).toHaveBeenCalledWith('studio-a', 'assignment-1')
    expect(wrapper.text()).toContain('Day 1: Push')
    expect(wrapper.text()).toContain('Bench Press')
    expect(wrapper.text()).toContain('Die Trainingsausführung ist in dieser Phase noch nicht verfügbar')
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
