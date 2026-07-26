import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../../utils/i18n'
import { buildMonthGrid } from '../../utils/calendarDate'
import CalendarAgendaList from './CalendarAgendaList.vue'

function entry(overrides = {}) {
  return {
    id: 'e1', scheduledDate: '2026-07-15', persistedStatus: 'PLANNED', displayStatus: 'PLANNED',
    sourceType: 'personal', title: 'Push Day', revision: 0, studio: null, program: null, programDay: null,
    linkedWorkoutType: null, linkedWorkoutPublicId: null, availableActions: [], ...overrides,
  }
}

const days = buildMonthGrid(new Date(2026, 6, 1))

function mountAgenda(entriesByDate = new Map(), today = '2026-07-15') {
  return mount(CalendarAgendaList, {
    props: { days, entriesByDate, today, monthLabel: 'Juli 2026' },
  })
}

describe('CalendarAgendaList', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  it('shows only days that actually have an event, not every day of the grid', () => {
    const map = new Map([['2026-07-15', [entry()]]])
    const wrapper = mountAgenda(map)
    expect(wrapper.findAll('.agenda-day')).toHaveLength(1)
  })

  it('shows a clear empty state when there are no events at all', () => {
    const wrapper = mountAgenda(new Map())
    expect(wrapper.text()).toContain('Keine Trainings in diesem Zeitraum.')
  })

  it('groups events chronologically under their day heading', () => {
    const map = new Map([
      ['2026-07-10', [entry({ id: 'e1', title: 'Earlier', scheduledDate: '2026-07-10' })]],
      ['2026-07-20', [entry({ id: 'e2', title: 'Later', scheduledDate: '2026-07-20' })]],
    ])
    const wrapper = mountAgenda(map)
    const headings = wrapper.findAll('.agenda-day-heading').map((el) => el.text())
    const earlierIndex = headings.findIndex((h) => h.includes('10.'))
    const laterIndex = headings.findIndex((h) => h.includes('20.'))
    expect(earlierIndex).toBeLessThan(laterIndex)
  })

  it('marks today\'s heading distinctly', () => {
    const map = new Map([['2026-07-15', [entry()]]])
    const wrapper = mountAgenda(map, '2026-07-15')
    expect(wrapper.find('.agenda-day-heading-today').text()).toContain('Heute')
  })

  it('emits open-event, change-month and go-today', async () => {
    const theEntry = entry()
    const map = new Map([['2026-07-15', [theEntry]]])
    const wrapper = mountAgenda(map)
    await wrapper.find('.calendar-event').trigger('click')
    expect(wrapper.emitted('open-event')[0][0]).toEqual(theEntry)

    await wrapper.find('[aria-label="Vorheriger Zeitraum"]').trigger('click')
    await wrapper.find('[aria-label="Nächster Zeitraum"]').trigger('click')
    expect(wrapper.emitted('change-month')).toEqual([[-1], [1]])
  })

  it('shows status and source for each agenda event', () => {
    const map = new Map([['2026-07-15', [entry({ sourceType: 'studio', studio: { id: 's1', name: 'FitTrack Studio' } })]]])
    const wrapper = mountAgenda(map)
    expect(wrapper.text()).toContain('FitTrack Studio')
    expect(wrapper.text()).toContain('Geplant')
  })
})
