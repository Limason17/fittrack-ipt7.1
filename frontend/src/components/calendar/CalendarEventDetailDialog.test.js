import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../../utils/i18n'
import CalendarEventDetailDialog from './CalendarEventDetailDialog.vue'

// Renders via Modal.vue's <Teleport to="body"> - content is queried directly
// from the document, matching views/WorkoutSessionView.test.js's convention.
function dialogRoot() {
  return document.querySelector('[role="dialog"]')
}

function dialogButton(label) {
  const root = dialogRoot()
  if (!root) return undefined
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === label)
}

function dialogText() {
  return dialogRoot()?.textContent || ''
}

async function setValue(element, value) {
  element.value = value
  element.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submitForm() {
  dialogRoot().querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

async function click(element) {
  element.click()
  await flushPromises()
}

function baseEntry(overrides = {}) {
  return {
    id: 'entry-1',
    scheduledDate: '2026-07-31',
    persistedStatus: 'PLANNED',
    displayStatus: 'PLANNED',
    sourceType: 'personal',
    title: 'Push Day',
    revision: 2,
    studio: null,
    program: null,
    programDay: null,
    assignmentId: null,
    linkedWorkoutType: null,
    linkedWorkoutPublicId: null,
    availableActions: ['COMPLETE', 'SKIP', 'CANCEL', 'RESCHEDULE'],
    ...overrides,
  }
}

let wrapper

function mountDialog(entry, busy = false) {
  wrapper = mount(CalendarEventDetailDialog, { attachTo: document.body, props: { entry, busy } })
  return wrapper
}

describe('CalendarEventDetailDialog', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('shows title, date, status and source for a personal entry', () => {
    mountDialog(baseEntry())
    expect(dialogText()).toContain('Push Day')
    expect(dialogText()).toContain('Geplant')
    expect(dialogText()).toContain('Persönlich')
  })

  it('shows studio, program and program day for a studio entry', () => {
    mountDialog(
      baseEntry({
        sourceType: 'studio',
        studio: { id: 's1', name: 'FitTrack Studio' },
        program: { id: 'p1', name: 'Upper/Lower' },
        programDay: { id: 'd1', name: 'Push Day' },
        availableActions: ['START', 'SKIP', 'CANCEL'],
      })
    )
    expect(dialogText()).toContain('FitTrack Studio')
    expect(dialogText()).toContain('Upper/Lower')
  })

  it('renders exactly the actions the server allows, in a stable order, and never invents extra ones', () => {
    mountDialog(baseEntry({ availableActions: ['VIEW_WORKOUT'], sourceType: 'studio', displayStatus: 'COMPLETED' }))
    expect(dialogButton('Workout öffnen')).toBeTruthy()
    expect(dialogButton('Training starten')).toBeFalsy()
    expect(dialogButton('Überspringen')).toBeFalsy()
  })

  it('shows an edit button only when RESCHEDULE is available for a personal entry', () => {
    mountDialog(baseEntry({ availableActions: ['RESCHEDULE'] }))
    expect(dialogButton('Bearbeiten')).toBeTruthy()
  })

  it('hides the edit button when RESCHEDULE is not available', () => {
    mountDialog(baseEntry({ availableActions: ['SKIP'] }))
    expect(dialogButton('Bearbeiten')).toBeFalsy()
  })

  it('never shows edit for a studio entry even if RESCHEDULE were somehow present', () => {
    mountDialog(baseEntry({ sourceType: 'studio', availableActions: ['RESCHEDULE', 'START'] }))
    expect(dialogButton('Bearbeiten')).toBeFalsy()
  })

  it('emits request-start, request-complete, request-skip, request-cancel, request-view-workout', async () => {
    const wrapper = mountDialog(baseEntry({ availableActions: ['START', 'COMPLETE', 'SKIP', 'CANCEL', 'VIEW_WORKOUT'] }))
    await click(dialogButton('Training starten'))
    await click(dialogButton('Als abgeschlossen bestätigen'))
    await click(dialogButton('Überspringen'))
    await click(dialogButton('Absagen'))
    await click(dialogButton('Workout öffnen'))
    expect(wrapper.emitted('request-start')).toHaveLength(1)
    expect(wrapper.emitted('request-complete')).toHaveLength(1)
    expect(wrapper.emitted('request-skip')).toHaveLength(1)
    expect(wrapper.emitted('request-cancel')).toHaveLength(1)
    expect(wrapper.emitted('request-view-workout')).toHaveLength(1)
  })

  it('opens an inline reschedule form and emits submit-reschedule with the chosen date', async () => {
    const wrapper = mountDialog(baseEntry())
    await click(dialogButton('Verschieben'))
    await setValue(dialogRoot().querySelector('input[type="date"]'), '2026-08-10')
    await submitForm()
    expect(wrapper.emitted('submit-reschedule')).toEqual([['2026-08-10']])
  })

  it('opens an inline edit form and emits submit-edit with the trimmed title', async () => {
    const wrapper = mountDialog(baseEntry())
    await click(dialogButton('Bearbeiten'))
    await setValue(dialogRoot().querySelector('input[type="text"]'), 'New title')
    await submitForm()
    expect(wrapper.emitted('submit-edit')).toEqual([['New title']])
  })

  it('disables every action button while busy, preventing a double submit', () => {
    mountDialog(baseEntry({ availableActions: ['COMPLETE'] }), true)
    expect(dialogButton('Als abgeschlossen bestätigen').disabled).toBe(true)
  })

  it('resets inline edit/reschedule mode whenever the entry prop changes (post-mutation refresh)', async () => {
    const wrapper = mountDialog(baseEntry())
    await click(dialogButton('Verschieben'))
    expect(dialogRoot().querySelector('input[type="date"]')).toBeTruthy()
    await wrapper.setProps({ entry: baseEntry({ revision: 3 }) })
    expect(dialogButton('Verschieben')).toBeTruthy()
    expect(dialogRoot().querySelector('input[type="date"]')).toBeFalsy()
  })

  it('shows a clear empty-actions message when nothing is available (e.g. a terminal studio entry)', () => {
    mountDialog(baseEntry({ sourceType: 'studio', availableActions: [], displayStatus: 'CANCELLED' }))
    expect(dialogText()).toContain('keine Aktionen verfügbar')
  })

  it('renders nothing (closed) when entry is null', () => {
    mountDialog(null)
    expect(dialogRoot()).toBeFalsy()
  })
})
