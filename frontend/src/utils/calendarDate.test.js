import { describe, expect, it } from 'vitest'
import {
  addDaysToDateOnly,
  addMonths,
  buildMonthGrid,
  compareDateOnly,
  formatLocalDate,
  isDateOnly,
  isFutureDateOnly,
  isPastDateOnly,
  isTodayDateOnly,
  isValidTimezone,
  monthGridRange,
  parseLocalDate,
  resolveBrowserTimezone,
  startOfMonth,
  todayInTimezone,
} from './calendarDate'

describe('isDateOnly / parseLocalDate / formatLocalDate', () => {
  it('accepts a real calendar date and round-trips it', () => {
    expect(isDateOnly('2026-07-26')).toBe(true)
    const date = parseLocalDate('2026-07-26')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(6)
    expect(date.getDate()).toBe(26)
    expect(formatLocalDate(date)).toBe('2026-07-26')
  })

  it('rejects a non-existent calendar date (e.g. 30 February)', () => {
    expect(isDateOnly('2026-02-30')).toBe(false)
  })

  it('rejects malformed or non-date-only input', () => {
    expect(isDateOnly('2026-7-26')).toBe(false)
    expect(isDateOnly('not-a-date')).toBe(false)
    expect(isDateOnly(null)).toBe(false)
    expect(isDateOnly(undefined)).toBe(false)
    expect(isDateOnly(20260726)).toBe(false)
  })

  it('parseLocalDate throws on an invalid date-only string rather than returning Invalid Date', () => {
    expect(() => parseLocalDate('2026-02-30')).toThrow()
    expect(() => parseLocalDate('garbage')).toThrow()
  })

  it('never shifts a day via UTC reinterpretation (the forbidden new Date(dateOnly) pattern)', () => {
    // new Date("2026-07-26") is parsed as UTC midnight, which is the
    // previous evening in any timezone west of UTC - parseLocalDate must
    // never exhibit that shift regardless of the host machine's own
    // timezone (the test runner's TZ is whatever CI/dev machine happens to
    // use), so this only pins the *local* getters recorded above.
    const date = parseLocalDate('2026-01-01')
    expect(date.getDate()).toBe(1)
    expect(date.getMonth()).toBe(0)
  })
})

describe('addDaysToDateOnly / compareDateOnly / isPast/Future/TodayDateOnly', () => {
  it('adds and subtracts days, crossing a month boundary', () => {
    expect(addDaysToDateOnly('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDaysToDateOnly('2026-08-02', -3)).toBe('2026-07-30')
  })

  it('crosses a year boundary', () => {
    expect(addDaysToDateOnly('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('handles a leap year (2028) correctly', () => {
    expect(addDaysToDateOnly('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysToDateOnly('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('does not treat a non-leap year February as having 29 days', () => {
    expect(addDaysToDateOnly('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('compares date-only strings lexicographically as calendar order', () => {
    expect(compareDateOnly('2026-07-26', '2026-07-26')).toBe(0)
    expect(compareDateOnly('2026-07-01', '2026-07-26')).toBe(-1)
    expect(compareDateOnly('2026-08-01', '2026-07-26')).toBe(1)
  })

  it('derives past/today/future relative to an explicit today value', () => {
    const today = '2026-07-26'
    expect(isPastDateOnly('2026-07-25', today)).toBe(true)
    expect(isPastDateOnly('2026-07-26', today)).toBe(false)
    expect(isTodayDateOnly('2026-07-26', today)).toBe(true)
    expect(isTodayDateOnly('2026-07-27', today)).toBe(false)
    expect(isFutureDateOnly('2026-07-27', today)).toBe(true)
    expect(isFutureDateOnly('2026-07-26', today)).toBe(false)
  })
})

describe('timezone helpers', () => {
  it('validates a real IANA timezone and rejects a bogus one', () => {
    expect(isValidTimezone('Europe/Zurich')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone(null)).toBe(false)
  })

  it('resolveBrowserTimezone returns a valid IANA zone', () => {
    expect(isValidTimezone(resolveBrowserTimezone())).toBe(true)
  })

  it('todayInTimezone computes the correct local date across a real DST transition (Europe/Zurich CET->CEST)', () => {
    // 2026-03-29 01:30 UTC is already 2026-03-29 03:30 CEST in Zurich (the
    // 2:00 CET -> 3:00 CEST jump already happened) - a naive fixed-offset
    // calculation would get this wrong on the transition day itself.
    const instant = new Date('2026-03-29T01:30:00Z')
    expect(todayInTimezone('Europe/Zurich', instant)).toBe('2026-03-29')
  })

  it('todayInTimezone computes the correct local date late at night in UTC (already the next day locally)', () => {
    // 2026-07-26 23:30 UTC is already 2026-07-27 01:30 in Zurich (UTC+2
    // during CEST) - the forbidden toISOString().slice(0,10) pattern would
    // incorrectly report 2026-07-26 here.
    const instant = new Date('2026-07-26T23:30:00Z')
    expect(todayInTimezone('Europe/Zurich', instant)).toBe('2026-07-27')
  })

  it('falls back to the documented Europe/Zurich default for an invalid timezone', () => {
    const instant = new Date('2026-07-26T23:30:00Z')
    expect(todayInTimezone('Not/AZone', instant)).toBe(todayInTimezone('Europe/Zurich', instant))
  })
})

describe('startOfMonth / addMonths', () => {
  it('normalizes any date within a month to its 1st', () => {
    const start = startOfMonth(new Date(2026, 6, 26))
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(6)
    expect(start.getDate()).toBe(1)
  })

  it('adds and subtracts months, crossing a year boundary', () => {
    const dec = new Date(2026, 11, 1)
    expect(formatLocalDate(addMonths(dec, 1))).toBe('2027-01-01')
    expect(formatLocalDate(addMonths(dec, -12))).toBe('2025-12-01')
  })
})

describe('buildMonthGrid / monthGridRange', () => {
  it('starts the grid on a Monday and ends it on a Sunday', () => {
    const days = buildMonthGrid(new Date(2026, 6, 1)) // July 2026
    const firstWeekday = parseLocalDate(days[0].date).getDay()
    const lastWeekday = parseLocalDate(days[days.length - 1].date).getDay()
    expect(firstWeekday).toBe(1) // Monday
    expect(lastWeekday).toBe(0) // Sunday
  })

  it('includes real adjacent-month days at the grid edges, correctly flagged', () => {
    const days = buildMonthGrid(new Date(2026, 6, 1)) // July 2026 starts on a Wednesday
    expect(days[0].date).toBe('2026-06-29')
    expect(days[0].inCurrentMonth).toBe(false)
    const julyFirst = days.find((day) => day.date === '2026-07-01')
    expect(julyFirst.inCurrentMonth).toBe(true)
  })

  it('never spans more than 42 days (6 weeks), safely under the backend 93-day cap', () => {
    for (let month = 0; month < 12; month += 1) {
      const days = buildMonthGrid(new Date(2026, month, 1))
      expect(days.length).toBeLessThanOrEqual(42)
      expect(days.length % 7).toBe(0)
    }
  })

  it('handles a leap-year February (2028) grid correctly', () => {
    const days = buildMonthGrid(new Date(2028, 1, 1))
    const inMonth = days.filter((day) => day.inCurrentMonth)
    expect(inMonth.length).toBe(29)
    expect(inMonth[inMonth.length - 1].date).toBe('2028-02-29')
  })

  it('handles a non-leap-year February (2026) grid correctly', () => {
    const days = buildMonthGrid(new Date(2026, 1, 1))
    const inMonth = days.filter((day) => day.inCurrentMonth)
    expect(inMonth.length).toBe(28)
  })

  it('monthGridRange returns the first and last grid dates as from/to', () => {
    const range = monthGridRange(new Date(2026, 6, 1))
    const days = buildMonthGrid(new Date(2026, 6, 1))
    expect(range.from).toBe(days[0].date)
    expect(range.to).toBe(days[days.length - 1].date)
  })
})
