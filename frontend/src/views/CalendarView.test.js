import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const calendarApi = vi.hoisted(() => ({
  getCalendarRange: vi.fn(),
  createCalendarEntry: vi.fn(),
  updateCalendarEntry: vi.fn(),
  rescheduleCalendarEntry: vi.fn(),
  completeCalendarEntry: vi.fn(),
  skipCalendarEntry: vi.fn(),
  cancelCalendarEntry: vi.fn(),
  startCalendarStudioWorkout: vi.fn(),
  resolveLinkedWorkoutRoute: vi.fn(),
}))
vi.mock('../utils/calendarApi', () => calendarApi)

const toast = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock('../utils/toast', () => toast)

import CalendarView from './CalendarView.vue'
import { locale } from '../utils/i18n'

function entry(overrides = {}) {
  return {
    id: 'entry-1', scheduledDate: '2026-07-15', persistedStatus: 'PLANNED', displayStatus: 'PLANNED',
    sourceType: 'personal', title: 'Push Day', revision: 0, studio: null, program: null, programDay: null,
    assignmentId: null, linkedWorkoutType: null, linkedWorkoutPublicId: null,
    availableActions: ['COMPLETE', 'SKIP', 'CANCEL', 'RESCHEDULE'], ...overrides,
  }
}

let wrapper
let pushSpy

function dialogRoot() {
  return document.querySelector('[role="dialog"]')
}

function dialogButton(label) {
  const root = dialogRoot()
  if (!root) return undefined
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === label)
}

async function click(element) {
  element.click()
  await flushPromises()
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/calendar', name: 'calendar', component: CalendarView },
      { path: '/workouts', name: 'workouts', component: { template: '<div />' } },
      {
        path: '/studios/:studioId/workout-sessions/:sessionId',
        name: 'studio-workout-session-detail',
        component: { template: '<div />' },
      },
    ],
  })
  pushSpy = vi.spyOn(router, 'push')
  await router.push('/calendar')
  await router.isReady()
  wrapper = mount(CalendarView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

// CalendarView.vue deliberately reads the real wall clock on mount
// (`selectedMonth = ref(startOfMonth(new Date()))`, `todayInTimezone(...)`
// with no injected `now`) - correct product behavior (a user opening the
// calendar should see the actual current month), but it means every
// fixture below (`entry()`'s default 2026-07-15, the race-guard test's
// 2026-09-15) is only visible if the real test-run date happens to fall in
// the month those fixtures assumed. That held when this file was written
// in July 2026 and silently broke the moment the wall clock crossed into
// August - reproduced live: with no system-time pinning, mounting in
// August 2026 shows "August 2026"/"Oktober 2026" instead of the assumed
// "Juli 2026"/"September 2026", so none of the July/September-dated fixture
// entries fall within the rendered grid ("Keine Trainings in diesem
// Zeitraum"). Fixed by pinning only the `Date` global via fake timers
// (never `setTimeout`/`setInterval`, which `flushPromises()` and the
// dialogs below do not need faked) to the exact date these fixtures were
// always written against - this is dependency injection of the clock at
// the test-environment boundary, not a production code change.
const PINNED_NOW = new Date(2026, 6, 15, 12, 0, 0) // 2026-07-15 12:00 local

describe('CalendarView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(PINNED_NOW)
    locale.value = 'de'
    calendarApi.getCalendarRange.mockReset().mockResolvedValue({ entries: [] })
    calendarApi.createCalendarEntry.mockReset()
    calendarApi.updateCalendarEntry.mockReset()
    calendarApi.rescheduleCalendarEntry.mockReset()
    calendarApi.completeCalendarEntry.mockReset()
    calendarApi.skipCalendarEntry.mockReset()
    calendarApi.cancelCalendarEntry.mockReset()
    calendarApi.startCalendarStudioWorkout.mockReset()
    calendarApi.resolveLinkedWorkoutRoute.mockReset()
    toast.toastSuccess.mockReset()
    toast.toastError.mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('loads the visible range exactly once on mount, bounded well under the 93-day cap', async () => {
    await mountView()
    expect(calendarApi.getCalendarRange).toHaveBeenCalledTimes(1)
    const [{ from, to }] = calendarApi.getCalendarRange.mock.calls[0]
    const days = (new Date(to) - new Date(from)) / 86400000 + 1
    expect(days).toBeLessThanOrEqual(42)
  })

  it('shows an empty state when there are no events in the range', async () => {
    await mountView()
    expect(wrapper.text()).toContain('Für diesen Zeitraum sind keine Trainings geplant.')
  })

  it('shows a translated error with a retry button when loading fails, and retry reloads', async () => {
    calendarApi.getCalendarRange.mockRejectedValueOnce(new Error('network down'))
    await mountView()
    expect(wrapper.text()).toContain('Der Kalender konnte nicht geladen werden.')
    calendarApi.getCalendarRange.mockResolvedValueOnce({ entries: [] })
    await wrapper.findAll('button').find((b) => b.text() === 'Erneut versuchen').trigger('click')
    await flushPromises()
    expect(calendarApi.getCalendarRange).toHaveBeenCalledTimes(2)
  })

  it('month navigation issues a new, range-bounded request for the new month', async () => {
    await mountView()
    const nextButton = wrapper.find('[aria-label="Nächster Monat"]')
    await nextButton.trigger('click')
    await flushPromises()
    expect(calendarApi.getCalendarRange).toHaveBeenCalledTimes(2)
    const firstFrom = calendarApi.getCalendarRange.mock.calls[0][0].from
    const secondFrom = calendarApi.getCalendarRange.mock.calls[1][0].from
    expect(secondFrom).not.toBe(firstFrom)
  })

  // ---- Date-determinism regression coverage ----
  // These three tests exist specifically to prove the fixture/system-time
  // relationship is genuinely under test control, not an artifact of one
  // month (July) happening to work. Each pins its own system time rather
  // than relying on the shared PINNED_NOW default from beforeEach.

  it('month boundary: navigating from July into August shows an entry actually scheduled in August', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)) // 2026-07-15, mount shows July
    calendarApi.getCalendarRange
      .mockResolvedValueOnce({ entries: [] }) // initial mount (July)
      .mockResolvedValueOnce({ entries: [entry({ id: 'aug-1', title: 'August Entry', scheduledDate: '2026-08-10' })] })

    await mountView()
    expect(wrapper.text()).toContain('Juli 2026')

    await wrapper.find('[aria-label="Nächster Monat"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('August 2026')
    expect(wrapper.text()).toContain('August Entry')
  })

  it('year boundary: navigating from December into January shows an entry actually scheduled in the new year', async () => {
    vi.setSystemTime(new Date(2026, 11, 15, 12, 0, 0)) // 2026-12-15, mount shows December 2026
    calendarApi.getCalendarRange
      .mockResolvedValueOnce({ entries: [] }) // initial mount (December 2026)
      .mockResolvedValueOnce({ entries: [entry({ id: 'jan-1', title: 'January Entry', scheduledDate: '2027-01-10' })] })

    await mountView()
    expect(wrapper.text()).toContain('Dezember 2026')

    await wrapper.find('[aria-label="Nächster Monat"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Januar 2027')
    expect(wrapper.text()).toContain('January Entry')
  })

  it('the visible month always matches the (arbitrarily pinned) system date, and an entry scheduled within it renders - proving no hardcoded assumption about which real month it is', async () => {
    // Deliberately a month untouched by any other test in this file (not
    // July, not the December/January pair above) - if anything here were
    // silently relying on July specifically, this would fail.
    vi.setSystemTime(new Date(2027, 3, 20, 12, 0, 0)) // 2027-04-20
    calendarApi.getCalendarRange.mockResolvedValueOnce({
      entries: [entry({ id: 'apr-1', title: 'April Consistency Entry', scheduledDate: '2027-04-05' })],
    })

    await mountView()

    expect(wrapper.text()).toContain('April 2027')
    expect(wrapper.text()).not.toContain('Juli 2026')
    expect(wrapper.text()).toContain('April Consistency Entry')
  })

  it('a stale, superseded response never overwrites more recent data (request race guard)', async () => {
    // Two clicks move the view from July to September - both competing
    // responses are dated in September so either one (correctly or, if the
    // guard were broken, incorrectly applied) would actually be visible in
    // the currently displayed grid.
    let resolveSecondCall
    calendarApi.getCalendarRange.mockReset()
    calendarApi.getCalendarRange
      .mockResolvedValueOnce({ entries: [] }) // initial mount load (July)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondCall = resolve })) // 1st "next month" click (August) - stays pending
      .mockResolvedValueOnce({ entries: [entry({ id: 'fresh', title: 'Fresh Entry', scheduledDate: '2026-09-15' })] }) // 2nd click (September) - resolves first

    await mountView()
    const nextButton = wrapper.find('[aria-label="Nächster Monat"]')
    await nextButton.trigger('click') // fires the pending 2nd call, not yet resolved
    await nextButton.trigger('click') // fires the 3rd call, resolves immediately
    await flushPromises()
    expect(wrapper.text()).toContain('Fresh Entry')

    // The stale 2nd request (for August) now resolves with different, older
    // data - it must be discarded rather than clobbering the already-applied
    // fresh one, even though its date would also fall within a visible grid.
    resolveSecondCall({ entries: [entry({ id: 'stale', title: 'Stale Entry', scheduledDate: '2026-09-15' })] })
    await flushPromises()
    expect(wrapper.text()).toContain('Fresh Entry')
    expect(wrapper.text()).not.toContain('Stale Entry')
  })

  it('filters are applied client-side without triggering a new backend request', async () => {
    calendarApi.getCalendarRange.mockResolvedValue({
      entries: [
        entry({ id: 'personal-1', sourceType: 'personal', title: 'Personal One' }),
        entry({ id: 'studio-1', sourceType: 'studio', title: 'Studio One', studio: { id: 's1', name: 'Studio' } }),
      ],
    })
    await mountView()
    expect(wrapper.text()).toContain('Personal One')
    expect(wrapper.text()).toContain('Studio One')

    const studioTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === 'Studio')
    await studioTab.trigger('click')
    await flushPromises()

    expect(calendarApi.getCalendarRange).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('Personal One')
    expect(wrapper.text()).toContain('Studio One')
  })

  it('opening an event and completing it calls the API with the entry id and revision, then reloads and toasts success', async () => {
    calendarApi.getCalendarRange
      .mockResolvedValueOnce({ entries: [entry({ id: 'e1', revision: 3, scheduledDate: '2026-07-15' })] })
      .mockResolvedValueOnce({ entries: [] })
    calendarApi.completeCalendarEntry.mockResolvedValueOnce({ calendarEntry: entry({ persistedStatus: 'COMPLETED' }) })

    await mountView()
    await click(wrapper.find('.calendar-event').element)
    await click(dialogButton('Als abgeschlossen bestätigen'))
    await click(dialogButton('Bestätigen'))

    expect(calendarApi.completeCalendarEntry).toHaveBeenCalledWith('e1', { expectedRevision: 3 })
    expect(toast.toastSuccess).toHaveBeenCalled()
    expect(calendarApi.getCalendarRange).toHaveBeenCalledTimes(2)
  })

  it('a 409 CALENDAR_ENTRY_CONFLICT reloads data and shows the dedicated stale-data message, never a false success toast', async () => {
    calendarApi.getCalendarRange
      .mockResolvedValueOnce({ entries: [entry({ id: 'e1', revision: 0 })] })
      .mockResolvedValueOnce({ entries: [entry({ id: 'e1', revision: 1 })] })
    const conflictError = Object.assign(new Error('conflict'), {
      status: 409, data: { error: { code: 'CALENDAR_ENTRY_CONFLICT' } },
    })
    calendarApi.skipCalendarEntry.mockRejectedValueOnce(conflictError)

    await mountView()
    await click(wrapper.find('.calendar-event').element)
    await click(dialogButton('Überspringen'))
    await click(dialogButton('Überspringen'))

    expect(toast.toastError).toHaveBeenCalledWith(
      'Der Kalendereintrag wurde zwischenzeitlich geändert. Die aktuellen Daten wurden neu geladen.'
    )
    expect(toast.toastSuccess).not.toHaveBeenCalled()
    expect(calendarApi.getCalendarRange).toHaveBeenCalledTimes(2)
  })

  it('creating a personal entry calls createCalendarEntry and closes the dialog on success', async () => {
    calendarApi.createCalendarEntry.mockResolvedValueOnce({ calendarEntry: entry({ id: 'new-1' }) })
    await mountView()
    await click(wrapper.find('.page-header button').element)
    dialogRoot().querySelector('input[type="text"]').value = 'New Workout'
    dialogRoot().querySelector('input[type="text"]').dispatchEvent(new Event('input'))
    dialogRoot().querySelector('input[type="date"]').value = '2026-08-01'
    dialogRoot().querySelector('input[type="date"]').dispatchEvent(new Event('input'))
    await flushPromises()
    dialogRoot().querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()

    expect(calendarApi.createCalendarEntry).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New Workout', scheduledDate: '2026-08-01' })
    )
    expect(dialogRoot()).toBeFalsy()
  })

  it('starting a studio workout calls the existing session-start contract and navigates to the session detail route', async () => {
    calendarApi.getCalendarRange.mockResolvedValueOnce({
      entries: [
        entry({
          id: 'studio-e1', sourceType: 'studio', displayStatus: 'PLANNED', availableActions: ['START', 'SKIP', 'CANCEL'],
          studio: { id: 'studio-1', name: 'FitTrack Studio' }, programDay: { id: 'day-1', name: 'Push Day' },
          assignmentId: 'assignment-1',
        }),
      ],
    })
    calendarApi.startCalendarStudioWorkout.mockResolvedValueOnce({ workoutSession: { id: 'session-1' } })

    await mountView()
    await click(wrapper.find('.calendar-event').element)
    await click(dialogButton('Training starten'))

    expect(calendarApi.startCalendarStudioWorkout).toHaveBeenCalledWith(
      'studio-1', 'assignment-1', expect.objectContaining({ programDayId: 'day-1' })
    )
    expect(pushSpy).toHaveBeenCalledWith({
      name: 'studio-workout-session-detail', params: { studioId: 'studio-1', sessionId: 'session-1' },
    })
  })

  it('view-workout navigates using resolveLinkedWorkoutRoute, never a hand-built route', async () => {
    calendarApi.getCalendarRange.mockResolvedValueOnce({
      entries: [entry({ id: 'e1', displayStatus: 'COMPLETED', availableActions: ['VIEW_WORKOUT'], linkedWorkoutType: 'personal_workout', linkedWorkoutPublicId: 'w1' })],
    })
    calendarApi.resolveLinkedWorkoutRoute.mockReturnValueOnce({ name: 'workouts' })

    await mountView()
    await click(wrapper.find('.calendar-event').element)
    await click(dialogButton('Workout öffnen'))

    expect(calendarApi.resolveLinkedWorkoutRoute).toHaveBeenCalled()
    expect(pushSpy).toHaveBeenCalledWith({ name: 'workouts' })
  })

  it('go-today resets the visible month and reloads', async () => {
    await mountView()
    await wrapper.find('[aria-label="Nächster Monat"]').trigger('click')
    await flushPromises()
    const beforeToday = calendarApi.getCalendarRange.mock.calls.length
    await wrapper.findAll('button').find((b) => b.text() === 'Heute').trigger('click')
    await flushPromises()
    expect(calendarApi.getCalendarRange.mock.calls.length).toBe(beforeToday + 1)
  })
})
