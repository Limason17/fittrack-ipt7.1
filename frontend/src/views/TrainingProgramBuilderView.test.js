import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({
  getTrainingProgram: vi.fn(),
  listProgramVersions: vi.fn(),
  getProgramVersion: vi.fn(),
  createProgramVersion: vi.fn(),
  updateProgramVersion: vi.fn(),
  publishProgramVersion: vi.fn(),
  updateTrainingProgram: vi.fn(),
  createProgramDay: vi.fn(),
  updateProgramDay: vi.fn(),
  deleteProgramDay: vi.fn(),
  createProgramExercise: vi.fn(),
  updateProgramExercise: vi.fn(),
  deleteProgramExercise: vi.fn(),
}))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

import TrainingProgramBuilderView from './TrainingProgramBuilderView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

const baseProgram = { id: 'program-1', name: 'Beginner Strength', description: 'Onboarding plan', status: 'draft' }
const draftVersionSummary = { id: 'version-1', versionNumber: 1, status: 'draft', notes: null, publishedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }
const exercise1 = {
  id: 'ex-1', position: 1, exerciseNameSnapshot: 'Bench Press', instructions: null,
  targetSets: 4, targetRepsMin: 6, targetRepsMax: 8, targetWeight: 60,
  targetDurationMinutes: null, targetDistanceKm: null, targetRpe: null, restSeconds: 90,
}
const day1 = { id: 'day-1', position: 1, name: 'Day 1: Push', instructions: 'Warm up first', exercises: [exercise1] }
const draftVersionDetail = { ...draftVersionSummary, days: [day1] }
const publishedVersionSummary = { id: 'version-1', versionNumber: 1, status: 'published', notes: 'Ready to go', publishedAt: '2026-01-05T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
const publishedVersionDetail = { ...publishedVersionSummary, days: [day1] }

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

async function mountView({ actorRole = 'trainer', program = baseProgram, versions = [draftVersionSummary], version = draftVersionDetail } = {}) {
  addAndSelectStudio(studio(actorRole))
  trainingApi.getTrainingProgram.mockResolvedValue({ trainingProgram: program })
  trainingApi.listProgramVersions.mockResolvedValue({ programVersions: versions, pagination: { total: versions.length, totalPages: 1 } })
  trainingApi.getProgramVersion.mockResolvedValue({ programVersion: version })

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/studios/:studioId/training-programs/:programId',
        name: 'studio-training-program-detail',
        component: TrainingProgramBuilderView,
      },
      { path: '/studios/:studioId/training-programs', name: 'studio-training-programs', component: { template: '<div />' } },
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId/access-denied', name: 'studio-access-denied', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/training-programs/program-1')
  await router.isReady()
  wrapper = mount(TrainingProgramBuilderView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('TrainingProgramBuilderView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Actor' }
    locale.value = 'de'
    Object.values(trainingApi).forEach((fn) => fn.mockReset())
    trainingApi.createProgramDay.mockResolvedValue({ programDay: { id: 'day-2' } })
    trainingApi.updateProgramDay.mockResolvedValue({ programDay: day1 })
    trainingApi.deleteProgramDay.mockResolvedValue({ id: 'day-1' })
    trainingApi.createProgramExercise.mockResolvedValue({ programExercise: { id: 'ex-2' } })
    trainingApi.updateProgramExercise.mockResolvedValue({ programExercise: exercise1 })
    trainingApi.deleteProgramExercise.mockResolvedValue({ id: 'ex-1' })
    trainingApi.updateProgramVersion.mockResolvedValue({ programVersion: draftVersionSummary })
    trainingApi.publishProgramVersion.mockResolvedValue({ programVersion: publishedVersionSummary })
    trainingApi.updateTrainingProgram.mockResolvedValue({ trainingProgram: { ...baseProgram, status: 'archived' } })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('loads the program, its versions and the selected draft version with its days and exercises', async () => {
    await mountView()

    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Day 1: Push')
    expect(wrapper.text()).toContain('Bench Press')
    expect(wrapper.text()).toContain('Entwurf')
  })

  it('creates a new draft version', async () => {
    await mountView()
    trainingApi.createProgramVersion.mockResolvedValue({ programVersion: { ...draftVersionSummary, id: 'version-2', versionNumber: 2 } })

    const newVersionButton = wrapper.findAll('button').find((b) => b.text().includes('Neue Entwurfsversion erstellen'))
    await newVersionButton.trigger('click')
    await flushPromises()

    expect(trainingApi.createProgramVersion).toHaveBeenCalledWith('studio-a', 'program-1', {})
  })

  it('adds a new training day to the draft version', async () => {
    await mountView()

    await wrapper.find('#new-day-name').setValue('Day 2: Pull')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(trainingApi.createProgramDay).toHaveBeenCalledWith('studio-a', 'program-1', 'version-1', {
      name: 'Day 2: Pull',
      instructions: null,
    })
  })

  it('edits a training day inline', async () => {
    await mountView()

    const editButtons = wrapper.findAll('button').filter((b) => b.text() === 'Bearbeiten')
    await editButtons[0].trigger('click')
    await wrapper.find('#day-name-day-1').setValue('Day 1: Push renamed')
    const saveButtons = wrapper.findAll('button').filter((b) => b.text().includes('Speichern'))
    await saveButtons[0].trigger('click')
    await flushPromises()

    expect(trainingApi.updateProgramDay).toHaveBeenCalledWith('studio-a', 'program-1', 'version-1', 'day-1', {
      name: 'Day 1: Push renamed',
      instructions: 'Warm up first',
    })
  })

  it('reorders a training day using the position select', async () => {
    const day2 = { ...day1, id: 'day-2', position: 2, name: 'Day 2: Pull', exercises: [] }
    await mountView({ version: { ...draftVersionDetail, days: [day1, day2] } })

    const positionSelect = wrapper.find('.program-day-card select')
    await positionSelect.setValue('2')
    await flushPromises()

    expect(trainingApi.updateProgramDay).toHaveBeenCalledWith('studio-a', 'program-1', 'version-1', 'day-1', { position: 2 })
  })

  it('removes a training day only after confirmation', async () => {
    await mountView()

    const removeButton = wrapper.findAll('button').find((b) => b.text() === 'Trainingstag entfernen')
    await removeButton.trigger('click')
    await flushPromises()
    expect(trainingApi.deleteProgramDay).not.toHaveBeenCalled()

    dialogButton('Trainingstag entfernen').click()
    await flushPromises()

    expect(trainingApi.deleteProgramDay).toHaveBeenCalledWith('studio-a', 'program-1', 'version-1', 'day-1')
  })

  it('adds an exercise to a day with numeric target fields converted to numbers', async () => {
    await mountView()

    const openAddExercise = wrapper.findAll('button').find((b) => b.text() === 'Übung hinzufügen')
    await openAddExercise.trigger('click')
    await wrapper.find('[id^="new-ex-name-"]').setValue('Squat')
    await wrapper.find('[id^="new-ex-sets-"]').setValue('5')
    const submitButton = wrapper.findAll('button').find((b) => b.text().includes('Übung hinzufügen'))
    await submitButton.trigger('click')
    await flushPromises()

    expect(trainingApi.createProgramExercise).toHaveBeenCalledWith(
      'studio-a', 'program-1', 'version-1', 'day-1',
      expect.objectContaining({ exerciseNameSnapshot: 'Squat', targetSets: 5 })
    )
  })

  it('edits an exercise inline', async () => {
    await mountView()

    const editButtons = wrapper.findAll('button').filter((b) => b.text() === 'Bearbeiten')
    const exerciseEditButton = editButtons[editButtons.length - 1]
    await exerciseEditButton.trigger('click')
    await wrapper.find('[id^="ex-sets-"]').setValue('5')
    const saveButtons = wrapper.findAll('button').filter((b) => b.text().includes('Speichern'))
    await saveButtons[saveButtons.length - 1].trigger('click')
    await flushPromises()

    expect(trainingApi.updateProgramExercise).toHaveBeenCalledWith(
      'studio-a', 'program-1', 'version-1', 'day-1', 'ex-1',
      expect.objectContaining({ exerciseNameSnapshot: 'Bench Press', targetSets: 5 })
    )
  })

  it('removes an exercise only after confirmation', async () => {
    await mountView()

    const removeButton = wrapper.findAll('button').find((b) => b.text() === 'Übung entfernen')
    await removeButton.trigger('click')
    await flushPromises()
    expect(trainingApi.deleteProgramExercise).not.toHaveBeenCalled()

    dialogButton('Übung entfernen').click()
    await flushPromises()

    expect(trainingApi.deleteProgramExercise).toHaveBeenCalledWith('studio-a', 'program-1', 'version-1', 'day-1', 'ex-1')
  })

  it('publishes a draft version only after confirmation', async () => {
    await mountView()

    const publishButton = wrapper.findAll('button').find((b) => b.text().includes('Version veröffentlichen'))
    await publishButton.trigger('click')
    await flushPromises()
    expect(trainingApi.publishProgramVersion).not.toHaveBeenCalled()

    dialogButton('Version veröffentlichen').click()
    await flushPromises()

    expect(trainingApi.publishProgramVersion).toHaveBeenCalledWith('studio-a', 'program-1', 'version-1')
  })

  it('renders a published version as read-only with no day/exercise mutation controls', async () => {
    await mountView({ versions: [publishedVersionSummary], version: publishedVersionDetail })

    expect(wrapper.text()).toContain('Diese Version ist veröffentlicht und daher unveränderlich.')
    expect(wrapper.find('#new-day-name').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Trainingstag entfernen')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Übung entfernen')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text().includes('Übung hinzufügen'))).toBe(false)
    const notesField = wrapper.find('textarea')
    expect(notesField.attributes('readonly')).toBeDefined()
  })

  it('archives the program only after confirmation', async () => {
    await mountView({ actorRole: 'owner' })

    const archiveButton = wrapper.findAll('button').find((b) => b.text() === 'Archivieren')
    await archiveButton.trigger('click')
    await flushPromises()
    expect(trainingApi.updateTrainingProgram).not.toHaveBeenCalled()

    dialogButton('Archivieren').click()
    await flushPromises()

    expect(trainingApi.updateTrainingProgram).toHaveBeenCalledWith('studio-a', 'program-1', { status: 'archived' })
  })
})
