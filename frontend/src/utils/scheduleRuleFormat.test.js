import { beforeEach, describe, expect, it } from 'vitest'
import { locale } from './i18n'
import {
  formatScheduleRuleSummary,
  isoWeekdayOfDateOnly,
  rollForwardToWeekday,
  scheduleRuleDatesInRange,
  scheduleRuleOccursOn,
  sortScheduleRules,
  upcomingScheduleRuleOccurrences,
  weekdayLongName,
} from './scheduleRuleFormat'

// 2024-01-01 is a Monday (same reference date utils/i18n.js#weekdayNames uses),
// giving an unambiguous Monday(0)..Sunday(6) fixture for the whole file.
const MONDAY = '2024-01-01'
const TUESDAY = '2024-01-02'
const SUNDAY = '2024-01-07'

// Independently finds the next real-world Sunday on/after `dateOnly` using
// plain Date.getDay() (Sunday === 0) - deliberately not reusing this
// module's own isoWeekdayOfDateOnly, so the "assignment starts on a Sunday"
// fixture below is verified independently of the code under test.
function nextSundayOnOrAfter(dateOnly) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  while (date.getDay() !== 0) date.setDate(date.getDate() + 1)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Calendar-day gap between two YYYY-MM-DD strings, computed via Date.UTC so
// it is never itself sensitive to the host's local DST rules - used only to
// independently check the *spacing* of dates the module under test returns.
function utcDayGap(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

beforeEach(() => {
  locale.value = 'de'
})

describe('isoWeekdayOfDateOnly', () => {
  it('maps Monday..Sunday to 0..6, matching the backend convention', () => {
    expect(isoWeekdayOfDateOnly(MONDAY)).toBe(0)
    expect(isoWeekdayOfDateOnly(TUESDAY)).toBe(1)
    expect(isoWeekdayOfDateOnly(SUNDAY)).toBe(6)
  })
})

describe('rollForwardToWeekday', () => {
  it('returns the same date when it already matches the weekday', () => {
    expect(rollForwardToWeekday(MONDAY, 0)).toBe(MONDAY)
  })

  it('rolls forward within the same week', () => {
    expect(rollForwardToWeekday(MONDAY, 6)).toBe(SUNDAY)
  })

  it('rolls forward across a month boundary', () => {
    // 2024-01-31 is a Wednesday (day 30 after the Jan 1 Monday anchor,
    // 30 % 7 === 2 -> Wednesday); the next Friday(4) is 2024-02-02.
    expect(rollForwardToWeekday('2024-01-31', 4)).toBe('2024-02-02')
  })
})

describe('scheduleRuleOccursOn / scheduleRuleDatesInRange', () => {
  it('a weekly rule (weekInterval=1) occurs on every matching weekday within range, never outside it', () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: MONDAY, activeFrom: MONDAY, activeUntil: '2024-01-22' }
    expect(scheduleRuleOccursOn(rule, MONDAY)).toBe(true)
    expect(scheduleRuleOccursOn(rule, '2024-01-08')).toBe(true)
    expect(scheduleRuleOccursOn(rule, '2024-01-15')).toBe(true)
    expect(scheduleRuleOccursOn(rule, '2023-12-25')).toBe(false) // before activeFrom
    expect(scheduleRuleOccursOn(rule, '2024-01-29')).toBe(false) // after activeUntil
    expect(scheduleRuleOccursOn(rule, TUESDAY)).toBe(false) // wrong weekday
    expect(scheduleRuleDatesInRange(rule, MONDAY, '2024-01-22')).toEqual([
      '2024-01-01', '2024-01-08', '2024-01-15', '2024-01-22',
    ])
  })

  it('an every-2-weeks rule only fires on alternating matching weeks', () => {
    const rule = { weekday: 0, weekInterval: 2, anchorDate: MONDAY, activeFrom: MONDAY, activeUntil: '2024-01-29' }
    expect(scheduleRuleDatesInRange(rule, MONDAY, '2024-01-29')).toEqual(['2024-01-01', '2024-01-15', '2024-01-29'])
  })

  it('a custom N-week interval (e.g. every 3 weeks) fires on the right cadence', () => {
    const rule = { weekday: 0, weekInterval: 3, anchorDate: MONDAY, activeFrom: MONDAY, activeUntil: '2024-02-19' }
    expect(scheduleRuleDatesInRange(rule, MONDAY, '2024-02-19')).toEqual(['2024-01-01', '2024-01-22', '2024-02-12'])
  })

  it('includes an end date that falls exactly on an occurrence', () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: MONDAY, activeFrom: MONDAY, activeUntil: '2024-01-15' }
    expect(scheduleRuleDatesInRange(rule, MONDAY, '2024-01-31')).toEqual(['2024-01-01', '2024-01-08', '2024-01-15'])
  })

  it('supports an assignment/rule that starts on a Sunday', () => {
    const start = nextSundayOnOrAfter('2026-01-01')
    const rule = { weekday: 6, weekInterval: 1, anchorDate: start, activeFrom: start, activeUntil: null }
    expect(scheduleRuleOccursOn(rule, start)).toBe(true)
    const nextOccurrence = scheduleRuleDatesInRange(rule, start, start)[0]
    expect(nextOccurrence).toBe(start)
  })

  it('handles a leap-year February correctly (2024-02-29 exists and can be matched)', () => {
    // 2024-02-29 is day 59 after the 2024-01-01 Monday anchor; 59 % 7 === 3 -> Thursday(3).
    const rule = { weekday: 3, weekInterval: 1, anchorDate: MONDAY, activeFrom: '2024-02-01', activeUntil: '2024-03-01' }
    expect(scheduleRuleOccursOn(rule, '2024-02-29')).toBe(true)
  })

  it('crosses a year boundary without gaps or duplicates', () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: MONDAY, activeFrom: '2023-12-18', activeUntil: '2024-01-08' }
    expect(scheduleRuleDatesInRange(rule, '2023-12-18', '2024-01-08')).toEqual([
      '2023-12-18', '2023-12-25', '2024-01-01', '2024-01-08',
    ])
  })

  it('keeps a multi-week interval spaced exactly N*7 calendar days apart across a CET/CEST DST transition', () => {
    // 2026-03-29 is the EU spring-forward date; a rule anchored well before
    // it must still land exactly 14 calendar days apart on each side,
    // regardless of the host machine's own timezone/DST rules.
    const anchor = '2026-02-02'
    const rule = { weekday: isoWeekdayOfDateOnly(anchor), weekInterval: 2, anchorDate: anchor, activeFrom: anchor, activeUntil: '2026-04-27' }
    const dates = scheduleRuleDatesInRange(rule, anchor, '2026-04-27')
    expect(dates.length).toBeGreaterThan(2)
    for (let i = 1; i < dates.length; i += 1) {
      expect(utcDayGap(dates[i - 1], dates[i])).toBe(14)
    }
  })
})

describe('upcomingScheduleRuleOccurrences', () => {
  it('returns at most maxCount upcoming dates on/after today', () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: MONDAY, activeFrom: MONDAY, activeUntil: null }
    const dates = upcomingScheduleRuleOccurrences(rule, MONDAY, 6)
    expect(dates).toHaveLength(6)
    expect(dates[0]).toBe(MONDAY)
    expect(dates[5]).toBe('2024-02-05')
  })

  it('returns fewer than maxCount when activeUntil cuts the horizon short', () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: MONDAY, activeFrom: MONDAY, activeUntil: '2024-01-08' }
    expect(upcomingScheduleRuleOccurrences(rule, MONDAY, 6)).toEqual(['2024-01-01', '2024-01-08'])
  })

  it('returns an empty array when the rule has already fully elapsed', () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: MONDAY, activeFrom: MONDAY, activeUntil: '2024-01-08' }
    expect(upcomingScheduleRuleOccurrences(rule, '2024-06-01', 6)).toEqual([])
  })
})

describe('weekdayLongName', () => {
  it('returns the exact German weekday names for indices 0..6', () => {
    locale.value = 'de'
    expect(weekdayLongName(0)).toBe('Montag')
    expect(weekdayLongName(6)).toBe('Sonntag')
  })

  it('returns the exact English weekday names for indices 0..6', () => {
    locale.value = 'en'
    expect(weekdayLongName(0)).toBe('Monday')
    expect(weekdayLongName(6)).toBe('Sunday')
  })
})

describe('formatScheduleRuleSummary', () => {
  const openWeekly = { weekday: 0, weekInterval: 1, activeFrom: '2026-08-10', activeUntil: null }
  const rangeWeekly = { weekday: 0, weekInterval: 1, activeFrom: '2026-08-10', activeUntil: '2026-11-30' }
  const openInterval = { weekday: 2, weekInterval: 2, activeFrom: '2026-08-12', activeUntil: null }
  const rangeInterval = { weekday: 2, weekInterval: 3, activeFrom: '2026-08-12', activeUntil: '2026-12-02' }

  it('formats German summaries exactly', () => {
    locale.value = 'de'
    expect(formatScheduleRuleSummary(openWeekly)).toBe('Jede Woche am Montag, ab 10.08.2026')
    expect(formatScheduleRuleSummary(rangeWeekly)).toBe('Jede Woche am Montag, 10.08.2026 bis 30.11.2026')
    expect(formatScheduleRuleSummary(openInterval)).toBe('Alle 2 Wochen am Mittwoch, ab 12.08.2026')
    expect(formatScheduleRuleSummary(rangeInterval)).toBe('Alle 3 Wochen am Mittwoch, 12.08.2026 bis 02.12.2026')
  })

  it('formats English summaries exactly, with correct week/weeks pluralization', () => {
    locale.value = 'en'
    expect(formatScheduleRuleSummary(openWeekly)).toBe('Every week on Monday, starting 08/10/2026')
    expect(formatScheduleRuleSummary(rangeWeekly)).toBe('Every week on Monday, 08/10/2026 to 11/30/2026')
    expect(formatScheduleRuleSummary(openInterval)).toBe('Every 2 weeks on Wednesday, starting 08/12/2026')
  })
})

describe('sortScheduleRules', () => {
  it('sorts active before disabled, then Monday->Sunday, then program day position, then id', () => {
    const positions = new Map([['day-a', 1], ['day-b', 2]])
    const rules = [
      { id: 'r5', status: 'active', weekday: 3, programDay: { id: 'day-b' } },
      { id: 'r1', status: 'disabled', weekday: 0, programDay: { id: 'day-a' } },
      { id: 'r4', status: 'active', weekday: 3, programDay: { id: 'day-a' } },
      { id: 'r2', status: 'active', weekday: 0, programDay: { id: 'day-b' } },
      { id: 'r3', status: 'active', weekday: 0, programDay: { id: 'day-a' } },
    ]
    expect(sortScheduleRules(rules, positions).map((rule) => rule.id)).toEqual(['r3', 'r2', 'r4', 'r5', 'r1'])
  })

  it('falls back to a stable id-based tiebreaker for equal weekday and position', () => {
    const positions = new Map([['day-a', 1]])
    const rules = [
      { id: 'rb', status: 'active', weekday: 0, programDay: { id: 'day-a' } },
      { id: 'ra', status: 'active', weekday: 0, programDay: { id: 'day-a' } },
    ]
    expect(sortScheduleRules(rules, positions).map((rule) => rule.id)).toEqual(['ra', 'rb'])
  })
})
