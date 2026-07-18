import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProgressView from './ProgressView.vue'
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

const strengthEntry = {
  id: 11,
  exercise_id: 1,
  exercise_name: 'Bench Press',
  category: 'Brust',
  muscle_group: 'Brustmitte',
  entry_date: '2026-07-18',
  sets: 3,
  reps: 10,
  weight: 100,
  duration_minutes: null,
  distance_km: null,
  intensity_level: null,
  image_url: null,
  workout_title: null,
}

const cardioEntry = {
  id: 12,
  exercise_id: 1,
  exercise_name: 'Changed later',
  category: 'Cardio',
  muscle_group: 'Whole body',
  entry_date: '2026-07-19',
  sets: null,
  reps: null,
  weight: null,
  duration_minutes: 30,
  distance_km: 8,
  intensity_level: 7,
  image_url: null,
  workout_title: null,
}

const apiState = {
  entries: [],
  summary: [],
}

let wrapper

async function chooseFirstExercise(wrapper) {
  await wrapper.get('.exercise-choice').trigger('click')
  await flushPromises()

  const chooseButton = document.body.querySelector('.exercise-picker .picker-card .btn-primary')
  expect(chooseButton).not.toBeNull()
  chooseButton.click()
  await flushPromises()
}

describe('ProgressView measurement regressions', () => {
  beforeEach(() => {
    localStorage.clear()
    weightUnit.value = 'kg'
    apiState.entries = []
    apiState.summary = []
    apiRequest.mockReset()
    apiRequest.mockImplementation(async (path, options = {}) => {
      if (path === '/progress' && options.method === 'POST') return { id: 99 }
      if (path === '/progress') return apiState.entries
      if (path === '/progress/summary') return apiState.summary
      if (path === '/exercises') return [strengthExercise]
      throw new Error(`Unexpected API request: ${path}`)
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    weightUnit.value = 'kg'
  })

  it('converts an open manual-progress weight and saves the same canonical kg value', async () => {
    wrapper = mount(ProgressView, { attachTo: document.body })
    await flushPromises()
    await chooseFirstExercise(wrapper)
    await wrapper.get('#weight').setValue('100')

    weightUnit.value = 'lb'
    await flushPromises()

    expect(wrapper.get('#weight').element.value).toBe('220.4623')

    await wrapper.get('.form-actions .btn-primary').trigger('click')
    await flushPromises()

    const createCall = apiRequest.mock.calls.find(
      ([path, options]) => path === '/progress' && options?.method === 'POST'
    )

    expect(createCall).toBeDefined()
    expect(createCall[1].body.weight).toBe(100)
  })

  it('displays an estimated 1RM in lb with exactly one conversion', async () => {
    apiState.entries = [strengthEntry]
    weightUnit.value = 'lb'

    wrapper = mount(ProgressView, { attachTo: document.body })
    await flushPromises()

    const chartLabel = wrapper.get('.line-chart-wrap').attributes('aria-label')
    expect(chartLabel).toContain('293.9 lb')
    expect(chartLabel).not.toContain('648')
  })

  it('keeps an untouched optional manual weight empty when the unit changes', async () => {
    wrapper = mount(ProgressView, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.get('#weight').element.value).toBe('')

    weightUnit.value = 'lb'
    await flushPromises()

    expect(wrapper.get('#weight').element.value).toBe('')
  })

  it('keeps historical strength and current cardio variants in separate charts and summaries', async () => {
    apiState.entries = [strengthEntry, cardioEntry]
    apiState.summary = [
      {
        exercise_id: 1,
        exercise_name: 'Bench Press',
        category: 'Brust',
        muscle_group: 'Brustmitte',
        image_url: null,
        total_entries: 1,
        max_weight: 100,
        max_reps: 10,
        max_sets: 3,
        max_estimated_one_rep_max: 133.3333,
        max_duration_minutes: null,
        latest_date: '2026-07-18',
      },
      {
        exercise_id: 1,
        exercise_name: 'Changed later',
        category: 'Cardio',
        muscle_group: 'Whole body',
        image_url: null,
        total_entries: 1,
        max_duration_minutes: 30,
        max_distance_km: 8,
        max_speed_kmh: 16,
        max_intensity_level: 7,
        latest_date: '2026-07-19',
      },
    ]

    wrapper = mount(ProgressView, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.findAll('.chart-card')).toHaveLength(2)
    expect(wrapper.findAll('.summary-card')).toHaveLength(2)
  })
})
