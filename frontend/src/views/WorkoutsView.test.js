import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkoutsView from './WorkoutsView.vue'
import { weightUnit } from '../utils/units'
import { apiRequest } from '../utils/api'

vi.mock('../utils/api', () => ({
  apiRequest: vi.fn(),
}))

const strengthExercise = {
  id: 1,
  name: 'Bench Press',
  description: 'Chest exercise',
  category: 'Brust',
  muscle_group: 'Brustmitte',
  user_id: null,
  image_url: null,
}

let wrapper
const apiState = {
  workouts: [],
  exercises: [],
}

async function chooseFirstExercise(wrapper) {
  await wrapper.get('.exercise-choice').trigger('click')
  await flushPromises()

  const chooseButton = document.body.querySelector('.exercise-picker .picker-card .btn-primary')
  expect(chooseButton).not.toBeNull()
  chooseButton.click()
  await flushPromises()
}

describe('WorkoutsView weight unit flow', () => {
  beforeEach(() => {
    localStorage.clear()
    weightUnit.value = 'kg'
    apiState.workouts = []
    apiState.exercises = [strengthExercise]
    apiRequest.mockReset()
    apiRequest.mockImplementation(async (path, options = {}) => {
      if (path === '/workouts' && options.method === 'POST') return { id: 99 }
      if (path.startsWith('/workouts/') && options.method === 'PUT') return { ok: true }
      if (path === '/workouts') return apiState.workouts
      if (path === '/exercises') return apiState.exercises
      throw new Error(`Unexpected API request: ${path}`)
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    weightUnit.value = 'kg'
  })

  it('converts an open weight field and saves the same canonical kg value', async () => {
    wrapper = mount(WorkoutsView, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('.header-row > .btn-primary').trigger('click')
    await wrapper.get('#workoutTitle').setValue('Push Day')
    await chooseFirstExercise(wrapper)
    await wrapper.get('#weight-0').setValue('100')

    weightUnit.value = 'lb'
    await flushPromises()

    expect(wrapper.get('#weight-0').element.value).toBe('220.4623')

    await wrapper.get('.form-actions .btn-primary').trigger('click')
    await flushPromises()

    const createCall = apiRequest.mock.calls.find(
      ([path, options]) => path === '/workouts' && options?.method === 'POST'
    )

    expect(createCall).toBeDefined()
    expect(createCall[1].body.exercises[0].weight).toBe(100)
  })

  it('keeps an untouched optional weight field empty when the unit changes', async () => {
    wrapper = mount(WorkoutsView, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('.header-row > .btn-primary').trigger('click')

    expect(wrapper.get('#weight-0').element.value).toBe('')

    weightUnit.value = 'lb'
    await flushPromises()

    expect(wrapper.get('#weight-0').element.value).toBe('')
  })

  it('preserves a low pound value while toggling and stores database precision in kg', async () => {
    weightUnit.value = 'lb'
    wrapper = mount(WorkoutsView, { attachTo: document.body })
    await flushPromises()

    await wrapper.get('.header-row > .btn-primary').trigger('click')
    await wrapper.get('#workoutTitle').setValue('Low load')
    await chooseFirstExercise(wrapper)
    await wrapper.get('#weight-0').setValue('1')

    weightUnit.value = 'kg'
    await flushPromises()
    expect(wrapper.get('#weight-0').element.value).toBe('0.4536')

    await wrapper.get('.form-actions .btn-primary').trigger('click')
    await flushPromises()
    const createCall = apiRequest.mock.calls.find(
      ([path, options]) => path === '/workouts' && options?.method === 'POST'
    )
    expect(createCall[1].body.exercises[0].weight).toBe(0.45)
  })

  it('does not discard canonical hundredths when a workout is opened for editing', async () => {
    apiState.workouts = [{
      id: 7,
      title: 'Precise workout',
      workout_date: '2026-07-18',
      notes: '',
      exercises: [{
        id: 44,
        exercise_id: 1,
        name: 'Bench Press',
        category: 'Brust',
        muscle_group: 'Brustmitte',
        sets: 3,
        reps: 8,
        weight: 100.01,
        duration_minutes: null,
        distance_km: null,
        intensity_level: null,
      }],
    }]

    wrapper = mount(WorkoutsView, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('.workout-actions .btn-secondary').trigger('click')

    expect(wrapper.get('#weight-0').element.value).toBe('100.01')
    await wrapper.get('.form-actions .btn-primary').trigger('click')
    await flushPromises()

    const updateCall = apiRequest.mock.calls.find(
      ([path, options]) => path === '/workouts/7' && options?.method === 'PUT'
    )
    expect(updateCall[1].body.exercises[0].weight).toBe(100.01)
    expect(updateCall[1].body.exercises[0].workout_exercise_id).toBe(44)
  })

  it('keeps historical strength semantics when the current exercise became cardio', async () => {
    apiState.exercises = [{
      ...strengthExercise,
      name: 'Changed later',
      category: 'Cardio',
      muscle_group: 'Whole body',
    }]
    apiState.workouts = [{
      id: 8,
      title: 'Historical workout',
      workout_date: '2026-07-18',
      notes: '',
      exercises: [{
        id: 55,
        exercise_id: 1,
        name: 'Historical name',
        category: 'Strength',
        muscle_group: 'Core',
        image_url: null,
        sets: 3,
        reps: 10,
        weight: 25,
        duration_minutes: null,
        distance_km: null,
        intensity_level: null,
      }],
    }]

    wrapper = mount(WorkoutsView, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('.workout-actions .btn-secondary').trigger('click')

    expect(wrapper.get('.exercise-choice strong').text()).toBe('Historical name')
    expect(wrapper.find('#weight-0').exists()).toBe(true)
    expect(wrapper.find('#duration-0').exists()).toBe(false)

    await wrapper.get('.form-actions .btn-primary').trigger('click')
    await flushPromises()
    const updateCall = apiRequest.mock.calls.find(
      ([path, options]) => path === '/workouts/8' && options?.method === 'PUT'
    )
    expect(updateCall[1].body.exercises[0]).toEqual({
      workout_exercise_id: 55,
      exercise_id: 1,
      sets: 3,
      reps: 10,
      weight: 25,
    })
  })
})
