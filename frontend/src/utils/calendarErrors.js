import { t } from './i18n'

// Maps the exact stable backend error codes (backend/errors/TrainingCalendarErrors.js)
// to a translated, non-technical message - mirrors utils/workoutSessionErrors.js's
// convention exactly. Falls back to a generic message for anything
// unrecognized (network failure, 500, etc.) rather than ever surfacing a raw
// error code, SQL detail, or server stack trace to the member.
const CODE_KEYS = Object.freeze({
  CALENDAR_DATE_RANGE_INVALID: 'dateRangeInvalid',
  CALENDAR_RANGE_TOO_LARGE: 'rangeTooLarge',
  CALENDAR_ENTRY_NOT_FOUND: 'entryNotFound',
  CALENDAR_ENTRY_FORBIDDEN: 'entryForbidden',
  CALENDAR_INVALID_TRANSITION: 'invalidTransition',
  CALENDAR_ENTRY_CONFLICT: 'entryConflict',
  CALENDAR_WORKOUT_ALREADY_LINKED: 'workoutAlreadyLinked',
  CALENDAR_SCHEDULE_RULE_CONFLICT: 'scheduleRuleConflict',
  CALENDAR_SCHEDULE_RULE_NOT_FOUND: 'scheduleRuleNotFound',
  CALENDAR_ASSIGNMENT_INACTIVE: 'assignmentInactive',
  CALENDAR_PROGRAM_DAY_INVALID: 'programDayInvalid',
  CALENDAR_TIMEZONE_INVALID: 'timezoneInvalid',
  VALIDATION_ERROR: 'validationError',
})

export function calendarErrorCode(error) {
  return error?.data?.error?.code || null
}

// The one stable signal the UI must treat specially (Section 19): reload
// data, never show a local success message, and use the dedicated
// stale-data message rather than the generic conflict text.
export function isCalendarConflictError(error) {
  return error?.status === 409 && calendarErrorCode(error) === 'CALENDAR_ENTRY_CONFLICT'
}

export function calendarErrorMessage(error) {
  const code = calendarErrorCode(error)
  const key = code && CODE_KEYS[code]
  if (key) return t(`calendar.errors.${key}`)
  if (error?.status === 401) return t('calendar.errors.unauthorized')
  if (error?.status === 403) return t('calendar.errors.entryForbidden')
  if (error?.status === 404) return t('calendar.errors.entryNotFound')
  return t('calendar.errors.generic')
}
