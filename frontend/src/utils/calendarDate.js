// Date-only helpers for the personal training calendar (Stage 5A2).
//
// The backend's calendar API works exclusively with YYYY-MM-DD "date-only"
// values (see docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md, "Zeitzonenvertrag")
// - these are local training days, never UTC instants. Every helper here is
// deliberately timezone-safe: `new Date("YYYY-MM-DD")` and
// `date.toISOString().slice(0, 10)` are never used, since both silently
// reinterpret a local calendar date through UTC and can shift it by a day
// near midnight in any non-UTC timezone.

const DEFAULT_TIMEZONE = 'Europe/Zurich'
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidTimezone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return false
  }
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// Mirrors the backend's DEFAULT_PERSONAL_TIMEZONE fallback exactly (see
// trainingCalendarDomain.js) so a browser that cannot report its own
// timezone still lands on the same default the server would otherwise use.
export function resolveBrowserTimezone() {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimezone(resolved) ? resolved : DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

// The DST-safe way to compute "today" as a plain date string in an arbitrary
// IANA timezone: the en-CA locale formats directly as YYYY-MM-DD, and Intl's
// own timezone database (not manual offset arithmetic) resolves DST.
export function todayInTimezone(timezone = resolveBrowserTimezone(), now = new Date()) {
  const zone = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function isDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

// Parses a YYYY-MM-DD string into a Date representing LOCAL midnight of that
// calendar day - never UTC midnight, so no adjacent-day shift can occur in
// any timezone. Throws on anything that is not a valid date-only string,
// rather than silently producing an Invalid Date a caller might not check.
export function parseLocalDate(dateOnly) {
  if (!isDateOnly(dateOnly)) {
    throw new TypeError(`Expected a YYYY-MM-DD date-only string, received: ${JSON.stringify(dateOnly)}`)
  }
  const [year, month, day] = dateOnly.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// The inverse of parseLocalDate: reads a Date's LOCAL calendar fields
// (never getUTC*/toISOString, which would read the UTC-shifted day instead).
export function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDaysToDateOnly(dateOnly, days) {
  const date = parseLocalDate(dateOnly)
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

export function compareDateOnly(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function isTodayDateOnly(dateOnly, today) {
  return compareDateOnly(dateOnly, today) === 0
}

export function isPastDateOnly(dateOnly, today) {
  return compareDateOnly(dateOnly, today) < 0
}

export function isFutureDateOnly(dateOnly, today) {
  return compareDateOnly(dateOnly, today) > 0
}

// selectedMonth is always the 1st of a month at local midnight, matching the
// existing convention in views/WorkoutsView.vue's own calendar.
export function startOfMonth(monthDate) {
  return new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
}

export function addMonths(monthDate, delta) {
  return new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1)
}

function mondayFirstWeekdayIndex(date) {
  return (date.getDay() + 6) % 7
}

// Builds the visible month grid: every day from the Monday on/before the 1st
// through the Sunday on/after the last day of the month, each tagged with
// whether it belongs to the displayed month. This is deliberately NOT padded
// to a fixed 6 rows - a month that starts on a Monday and has exactly 4 or 5
// full weeks renders that many rows, matching how real calendar UIs behave.
// The resulting range is always well under the backend's 93-day cap (a
// calendar month can span at most 6 weeks = 42 days).
export function buildMonthGrid(monthDate) {
  const firstOfMonth = startOfMonth(monthDate)
  const lastOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)

  const leadingDays = mondayFirstWeekdayIndex(firstOfMonth)
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - leadingDays)

  const trailingDays = 6 - mondayFirstWeekdayIndex(lastOfMonth)
  const gridEnd = new Date(lastOfMonth)
  gridEnd.setDate(gridEnd.getDate() + trailingDays)

  const days = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    days.push({
      date: formatLocalDate(cursor),
      dayNumber: cursor.getDate(),
      inCurrentMonth: cursor.getMonth() === monthDate.getMonth(),
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function monthGridRange(monthDate) {
  const days = buildMonthGrid(monthDate)
  return { from: days[0].date, to: days[days.length - 1].date }
}
