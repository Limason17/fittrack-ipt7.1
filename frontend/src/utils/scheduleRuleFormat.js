// Coach scheduling (Stage 5A3) - weekday mapping, human-readable recurrence
// summaries, and a purely-informational occurrence preview for assignment
// schedule rules.
//
// The occurrence math below (`scheduleRuleOccursOn`/`scheduleRuleDatesInRange`)
// is a deliberate line-for-line port of the backend's
// backend/domain/trainingCalendarDomain.js of the same name - it is the
// authoritative, already-tested algorithm the server uses to materialize
// calendar entries. Porting it (rather than approximating it) is what makes
// the preview in ScheduleRulesView.vue safe to show as a preview: it can
// never disagree with what the backend will actually produce. It is still
// never the calendar's data source - see ScheduleRulesView.vue.
import { formatDate, t, weekdayNames } from './i18n'
import { addDaysToDateOnly, compareDateOnly, parseLocalDate } from './calendarDate'

export function isoWeekdayOfDateOnly(dateOnly) {
  return (parseLocalDate(dateOnly).getDay() + 6) % 7
}

function daysBetweenDateOnly(fromDateOnly, toDateOnly) {
  const from = parseLocalDate(fromDateOnly).getTime()
  const to = parseLocalDate(toDateOnly).getTime()
  return Math.round((to - from) / 86400000)
}

// The first date on or after `fromDateOnly` whose weekday matches. Used to
// compute a consistent `anchorDate` from a user-chosen start date and
// weekday, so the create/edit forms never have to expose "anchor date" as a
// separate concept (see docs/STAGE_5A3_COACH_SCHEDULING_UI.md, "Ankerdatum").
export function rollForwardToWeekday(fromDateOnly, weekday) {
  let cursor = fromDateOnly
  for (let i = 0; i < 7; i += 1) {
    if (isoWeekdayOfDateOnly(cursor) === weekday) return cursor
    cursor = addDaysToDateOnly(cursor, 1)
  }
  return cursor
}

// Mirrors trainingCalendarDomain.js#scheduleRuleOccursOn exactly.
export function scheduleRuleOccursOn(rule, dateOnly) {
  if (compareDateOnly(dateOnly, rule.activeFrom) < 0) return false
  if (rule.activeUntil && compareDateOnly(dateOnly, rule.activeUntil) > 0) return false
  if (isoWeekdayOfDateOnly(dateOnly) !== rule.weekday) return false
  if (rule.weekInterval <= 1) return true
  const diffDays = daysBetweenDateOnly(rule.anchorDate, dateOnly)
  const diffWeeks = Math.floor(diffDays / 7)
  return ((diffWeeks % rule.weekInterval) + rule.weekInterval) % rule.weekInterval === 0
}

// Mirrors trainingCalendarDomain.js#scheduleRuleDatesInRange exactly.
export function scheduleRuleDatesInRange(rule, rangeFrom, rangeTo) {
  const start = compareDateOnly(rangeFrom, rule.activeFrom) > 0 ? rangeFrom : rule.activeFrom
  const end = rule.activeUntil && compareDateOnly(rule.activeUntil, rangeTo) < 0 ? rule.activeUntil : rangeTo
  const dates = []
  if (compareDateOnly(start, end) > 0) return dates
  let cursor = start
  while (compareDateOnly(cursor, end) <= 0) {
    if (scheduleRuleOccursOn(rule, cursor)) dates.push(cursor)
    cursor = addDaysToDateOnly(cursor, 1)
  }
  return dates
}

const PREVIEW_MAX_COUNT = 6
// Bounds the scan for a weekInterval as large as 52: finding one occurrence
// can take up to ~364 days of scanning, so 10 years of headroom comfortably
// covers PREVIEW_MAX_COUNT occurrences without an unbounded loop.
const PREVIEW_MAX_SCAN_DAYS = 3660

// Purely informational and computed only from the rule's own parameters -
// never a database read, never the calendar's data source (Section 13/25 of
// the Stage 5A3 brief). Returns at most PREVIEW_MAX_COUNT upcoming dates on
// or after `today`.
export function upcomingScheduleRuleOccurrences(rule, today, maxCount = PREVIEW_MAX_COUNT) {
  const dates = []
  let cursor = compareDateOnly(rule.activeFrom, today) > 0 ? rule.activeFrom : today
  const scanLimit = addDaysToDateOnly(cursor, PREVIEW_MAX_SCAN_DAYS)
  while (dates.length < maxCount && compareDateOnly(cursor, scanLimit) <= 0) {
    if (rule.activeUntil && compareDateOnly(cursor, rule.activeUntil) > 0) break
    if (scheduleRuleOccursOn(rule, cursor)) dates.push(cursor)
    cursor = addDaysToDateOnly(cursor, 1)
  }
  return dates
}

export function weekdayLongName(weekday) {
  return weekdayNames('long')[weekday] || ''
}

const DATE_FORMAT_OPTIONS = { day: '2-digit', month: '2-digit', year: 'numeric' }

// Central recurrence formatter (Section 15) - the only place that turns a
// rule's raw weekday/weekInterval/activeFrom/activeUntil fields into
// human-readable text. Never shows the raw technical fields (see
// ScheduleRulesView.vue's rule overview, which renders this string instead).
export function formatScheduleRuleSummary(rule) {
  const weekdayName = weekdayLongName(rule.weekday)
  const start = formatDate(rule.activeFrom, DATE_FORMAT_OPTIONS)
  const end = rule.activeUntil ? formatDate(rule.activeUntil, DATE_FORMAT_OPTIONS) : null
  const params = { weekday: weekdayName, start, end }
  if (rule.weekInterval <= 1) {
    return end
      ? t('studios.schedule.summary.weeklyRange', params)
      : t('studios.schedule.summary.weeklyOpen', params)
  }
  params.interval = rule.weekInterval
  return end
    ? t('studios.schedule.summary.intervalRange', params)
    : t('studios.schedule.summary.intervalOpen', params)
}

// Sort order required by Section 6: active rules before disabled ones, then
// Monday->Sunday, then the referenced program day's position within the
// program version, then a stable id-based tiebreaker.
export function sortScheduleRules(rules, programDayPositionById) {
  return [...rules].sort((a, b) => {
    const activeRank = (rule) => (rule.status === 'active' ? 0 : 1)
    if (activeRank(a) !== activeRank(b)) return activeRank(a) - activeRank(b)
    if (a.weekday !== b.weekday) return a.weekday - b.weekday
    const posA = programDayPositionById.get(a.programDay.id) ?? Number.MAX_SAFE_INTEGER
    const posB = programDayPositionById.get(b.programDay.id) ?? Number.MAX_SAFE_INTEGER
    if (posA !== posB) return posA - posB
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
