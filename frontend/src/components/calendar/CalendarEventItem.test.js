import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../../utils/i18n'
import CalendarEventItem from './CalendarEventItem.vue'

function baseEntry(overrides = {}) {
  return {
    id: 'entry-1',
    scheduledDate: '2026-07-31',
    persistedStatus: 'PLANNED',
    displayStatus: 'PLANNED',
    sourceType: 'personal',
    title: 'Push Day',
    revision: 0,
    studio: null,
    program: null,
    programDay: null,
    linkedWorkoutType: null,
    linkedWorkoutPublicId: null,
    availableActions: ['COMPLETE', 'SKIP', 'CANCEL', 'RESCHEDULE'],
    ...overrides,
  }
}

function mountItem(entry, variant = 'agenda') {
  return mount(CalendarEventItem, { props: { entry, variant } })
}

describe('CalendarEventItem', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  it.each([
    ['PLANNED', 'calendar-event-info', 'Geplant'],
    ['DUE_TODAY', 'calendar-event-due-today', 'Heute fällig'],
    ['OVERDUE', 'calendar-event-warning', 'Noch zu bestätigen'],
    ['IN_PROGRESS', 'calendar-event-in-progress', 'In Bearbeitung'],
    ['COMPLETED', 'calendar-event-success', 'Abgeschlossen'],
    ['SKIPPED', 'calendar-event-danger', 'Übersprungen'],
    ['CANCELLED', 'calendar-event-danger', 'Abgesagt'],
  ])('renders %s with its tone class and translated text label', (displayStatus, toneClass, label) => {
    const wrapper = mountItem(baseEntry({ displayStatus }))
    expect(wrapper.classes()).toContain(toneClass)
    expect(wrapper.text()).toContain(label)
  })

  it('never conveys status through color alone: the accessible name always includes the status text', () => {
    const wrapper = mountItem(baseEntry({ displayStatus: 'COMPLETED', title: 'Leg Day', scheduledDate: '2026-07-26' }))
    const label = wrapper.attributes('aria-label')
    expect(label).toContain('Leg Day')
    expect(label).toContain('Abgeschlossen')
  })

  it('SKIPPED and CANCELLED share the same red tone but render different text and icon', () => {
    const skipped = mountItem(baseEntry({ displayStatus: 'SKIPPED' }))
    const cancelled = mountItem(baseEntry({ displayStatus: 'CANCELLED' }))
    expect(skipped.classes()).toEqual(cancelled.classes())
    expect(skipped.text()).not.toBe(cancelled.text())
  })

  it('shows a compact source line for a studio entry with a program name', () => {
    const wrapper = mountItem(
      baseEntry({
        sourceType: 'studio',
        studio: { id: 'studio-1', name: 'FitTrack Studio' },
        program: { id: 'program-1', name: 'Upper/Lower Plan' },
      })
    )
    expect(wrapper.text()).toContain('FitTrack Studio')
    expect(wrapper.text()).toContain('Upper/Lower Plan')
  })

  it('shows "Persönlich" for a personal entry', () => {
    const wrapper = mountItem(baseEntry({ sourceType: 'personal' }))
    expect(wrapper.text()).toContain('Persönlich')
  })

  it('falls back to a neutral tone for an unknown display status, never a fabricated known one', () => {
    const wrapper = mountItem(baseEntry({ displayStatus: 'SOMETHING_NEW' }))
    expect(wrapper.classes()).toContain('calendar-event-neutral')
  })

  it('renders a long title without crashing and keeps it in the accessible name', () => {
    const longTitle = 'A'.repeat(160)
    const wrapper = mountItem(baseEntry({ title: longTitle }))
    expect(wrapper.attributes('aria-label')).toContain(longTitle)
  })

  it('emits "open" when clicked', async () => {
    const wrapper = mountItem(baseEntry())
    await wrapper.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('renders correctly in English locale', () => {
    locale.value = 'en'
    const wrapper = mountItem(baseEntry({ displayStatus: 'OVERDUE' }))
    expect(wrapper.text()).toContain('Awaiting confirmation')
  })
})
