import { expect, test } from '@playwright/test'
import {
  addDaysToDateOnly,
  todayInTimezone,
  weekdayForDateOnly,
} from './helpers.js'

// Deterministic, fixed-clock regression coverage for the calendar
// midnight/timezone bug (hotfix/calendar-midnight-timezone-consistency):
// frontend/e2e/calendar.spec.js and coachScheduling.spec.js used to compute
// "today" via `new Date()` plus that Date's *local* getters, which reflect
// the Node.js test-runner process's own timezone (UTC on GitHub's
// ubuntu-latest CI runners) rather than the studio's Europe/Zurich
// timezone. For the 1-2 hours around Zurich local midnight each day (CEST:
// 00:00-02:00 local, CET: 00:00-01:00 local) the two disagree on the
// calendar day, so a schedule rule pinned to "new Date()'s day" landed one
// day behind the studio's actual today - the backend then correctly
// refused to link the real today's session to that stale rule/entry,
// leaving it stranded as PLANNED/OVERDUE instead of DUE_TODAY/COMPLETED.
//
// These tests need no browser, server, or real wall-clock timing - they
// exercise the exact same pure functions the fixed spec files now use,
// with an explicitly injected `now`, so they deterministically reproduce
// both the UTC/CEST and UTC/CET boundary without depending on when the
// suite happens to run.
test.describe.configure({ mode: 'serial' })

test('UTC-Tag 27., Europe/Zurich-Tag 28. (CEST, Sommerzeit) - reproduziert den beobachteten CI-Zeitpunkt deterministisch', () => {
  // Exactly the CI run that failed: 2026-07-27T22:23Z is already
  // 2026-07-28T00:23 in Europe/Zurich (UTC+2 in July).
  const now = new Date('2026-07-27T22:23:00Z')
  expect(todayInTimezone('UTC', now)).toBe('2026-07-27')
  expect(todayInTimezone('Europe/Zurich', now)).toBe('2026-07-28')
})

test('UTC-Tag 14., Europe/Zurich-Tag 15. (CET, Winterzeit) - derselbe Versatz gilt auch ausserhalb der Sommerzeit', () => {
  // Same class of boundary in winter (UTC+1): 23:30 UTC is already past
  // midnight in Zurich.
  const now = new Date('2026-01-14T23:30:00Z')
  expect(todayInTimezone('UTC', now)).toBe('2026-01-14')
  expect(todayInTimezone('Europe/Zurich', now)).toBe('2026-01-15')
})

test('Ausserhalb der Mitternachtsgrenze stimmen UTC- und Europe/Zurich-Tag überein', () => {
  // Sanity check that the fix does not *always* diverge - only inside the
  // narrow real boundary window. Mid-afternoon UTC is safely the same
  // calendar day in Zurich in both CEST and CET.
  const summerAfternoon = new Date('2026-07-27T14:00:00Z')
  expect(todayInTimezone('UTC', summerAfternoon)).toBe(todayInTimezone('Europe/Zurich', summerAfternoon))

  const winterAfternoon = new Date('2026-01-14T14:00:00Z')
  expect(todayInTimezone('UTC', winterAfternoon)).toBe(todayInTimezone('Europe/Zurich', winterAfternoon))
})

test('addDaysToDateOnly rechnet in Kalendertagen, nie in Stunden - unbeeinflusst von Zeitumstellungen', () => {
  // 2026-10-25 is Europe/Zurich's autumn DST transition (CEST -> CET). If
  // day arithmetic were done on wall-clock instants in a timezone-aware
  // way instead of on the UTC-anchored date-only string, a "+3 days" step
  // spanning this transition could land a calendar day off.
  expect(addDaysToDateOnly('2026-10-24', 3)).toBe('2026-10-27')
  // 2026-03-29 is Europe/Zurich's spring DST transition (CET -> CEST).
  expect(addDaysToDateOnly('2026-03-27', 3)).toBe('2026-03-30')
  // Negative offsets and month/year rollovers.
  expect(addDaysToDateOnly('2026-08-02', -1)).toBe('2026-08-01')
  expect(addDaysToDateOnly('2026-12-31', 1)).toBe('2027-01-01')
})

test('weekdayForDateOnly stimmt mit der 0=Montag..6=Sonntag-Konvention aus trainingCalendarDomain.js überein', () => {
  expect(weekdayForDateOnly('2026-07-27')).toBe(0) // Monday
  expect(weekdayForDateOnly('2026-07-28')).toBe(1) // Tuesday
  expect(weekdayForDateOnly('2026-08-02')).toBe(6) // Sunday
})
