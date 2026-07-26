import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../../utils/i18n'
import CalendarMonthGrid from './CalendarMonthGrid.vue'

function entry(overrides = {}) {
  return {
    id: 'e1', scheduledDate: '2026-07-15', persistedStatus: 'PLANNED', displayStatus: 'PLANNED',
    sourceType: 'personal', title: 'Push Day', revision: 0, studio: null, program: null, programDay: null,
    linkedWorkoutType: null, linkedWorkoutPublicId: null, availableActions: [], ...overrides,
  }
}

function mountGrid(entriesByDate = new Map(), monthDate = new Date(2026, 6, 1), today = '2026-07-15') {
  return mount(CalendarMonthGrid, { props: { monthDate, entriesByDate, today } })
}

describe('CalendarMonthGrid', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  it('renders Monday-first weekday headers', () => {
    const wrapper = mountGrid()
    const headers = wrapper.findAll('.weekday-grid span').map((el) => el.text())
    expect(headers[0]).toBe('Mo')
    expect(headers[6]).toBe('So')
  })

  it('renders the month and year label', () => {
    const wrapper = mountGrid()
    expect(wrapper.text()).toContain('Juli 2026')
  })

  it('marks the current day distinctly for screen readers and visually', () => {
    const wrapper = mountGrid(new Map(), new Date(2026, 6, 1), '2026-07-15')
    const todayCell = wrapper.findAll('.calendar-day').find((cell) => cell.classes().includes('calendar-day-today'))
    expect(todayCell).toBeTruthy()
    expect(todayCell.text()).toContain('Heute')
  })

  it('renders events on their correct day', () => {
    const map = new Map([['2026-07-15', [entry()]]])
    const wrapper = mountGrid(map)
    expect(wrapper.text()).toContain('Push Day')
  })

  it('emits open-event with the entry when an event button is clicked', async () => {
    const theEntry = entry()
    const map = new Map([['2026-07-15', [theEntry]]])
    const wrapper = mountGrid(map)
    await wrapper.find('.calendar-event').trigger('click')
    expect(wrapper.emitted('open-event')[0][0]).toEqual(theEntry)
  })

  it('emits change-month with -1/+1 and go-today', async () => {
    const wrapper = mountGrid()
    await wrapper.find('[aria-label="Vorheriger Monat"]').trigger('click')
    await wrapper.find('[aria-label="Nächster Monat"]').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Heute').trigger('click')
    expect(wrapper.emitted('change-month')).toEqual([[-1], [1]])
    expect(wrapper.emitted('go-today')).toHaveLength(1)
  })

  it('renders multiple events on the same day without dropping any', () => {
    const map = new Map([
      ['2026-07-15', [entry({ id: 'e1', title: 'Morning' }), entry({ id: 'e2', title: 'Evening' })]],
    ])
    const wrapper = mountGrid(map)
    expect(wrapper.text()).toContain('Morning')
    expect(wrapper.text()).toContain('Evening')
  })

  it('does not overflow to more than 6 weeks (42 cells)', () => {
    const wrapper = mountGrid()
    expect(wrapper.findAll('.calendar-day').length).toBeLessThanOrEqual(42)
  })
})
