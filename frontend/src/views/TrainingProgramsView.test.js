import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({
  listTrainingPrograms: vi.fn(),
  createTrainingProgram: vi.fn(),
}))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

const studioApi = vi.hoisted(() => ({
  listStudios: vi.fn(),
}))
vi.mock('../utils/studioApi', () => studioApi)

import TrainingProgramsView from './TrainingProgramsView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

const programs = [
  { id: 'program-1', name: 'Beginner Strength', description: 'Onboarding plan', status: 'draft' },
  { id: 'program-2', name: 'Advanced Hypertrophy', description: null, status: 'active' },
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
      { path: '/studios/:studioId/training-programs', name: 'studio-training-programs', component: TrainingProgramsView },
      {
        path: '/studios/:studioId/training-programs/:programId',
        name: 'studio-training-program-detail',
        component: { template: '<div />' },
      },
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId/access-denied', name: 'studio-access-denied', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/training-programs')
  await router.isReady()
  wrapper = mount(TrainingProgramsView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('TrainingProgramsView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Actor' }
    locale.value = 'de'
    trainingApi.listTrainingPrograms.mockReset()
    trainingApi.createTrainingProgram.mockReset()
    studioApi.listStudios.mockReset()
    trainingApi.listTrainingPrograms.mockResolvedValue({ trainingPrograms: programs, pagination: { total: 2, totalPages: 1 } })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('lists programs with distinguishable status badges and a link into the builder', async () => {
    await mountView('trainer')

    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Advanced Hypertrophy')
    expect(wrapper.text()).toContain('Entwurf')
    expect(wrapper.text()).toContain('Aktiv')
    const link = wrapper.findAllComponents({ name: 'RouterLink' }).find((item) => item.text().includes('Beginner Strength'))
    expect(link.props('to')).toEqual({
      name: 'studio-training-program-detail',
      params: { studioId: 'studio-a', programId: 'program-1' },
    })
  })

  it('creates a new training program from the inline form', async () => {
    await mountView('owner')
    trainingApi.createTrainingProgram.mockResolvedValue({
      trainingProgram: { id: 'program-3', name: 'New Program', description: null, status: 'draft' },
    })

    await wrapper.get('button.btn-primary').trigger('click')
    await wrapper.find('#program-name').setValue('New Program')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(trainingApi.createTrainingProgram).toHaveBeenCalledWith('studio-a', {
      name: 'New Program',
      description: null,
    })
  })

  it('shows an empty state when the studio has no programs yet', async () => {
    trainingApi.listTrainingPrograms.mockResolvedValue({ trainingPrograms: [], pagination: { total: 0, totalPages: 0 } })
    await mountView('trainer')

    expect(wrapper.text()).toContain('Noch keine Trainingsprogramme vorhanden.')
  })

  it('shows a load error without logging the user out on a 403 response', async () => {
    const forbidden = new Error('forbidden')
    forbidden.status = 403
    trainingApi.listTrainingPrograms.mockRejectedValue(forbidden)
    studioApi.listStudios.mockResolvedValue({ studios: [studio('trainer')] })
    await mountView('trainer')

    expect(wrapper.text()).toContain('Deine aktuelle Rolle erlaubt diese Aktion nicht.')
    expect(authToken.value).toBe('token')
    expect(authUser.value).not.toBeNull()
  })
})
