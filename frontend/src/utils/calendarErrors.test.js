import { beforeEach, describe, expect, it } from 'vitest'
import { locale } from './i18n'
import { calendarErrorCode, calendarErrorMessage, isCalendarConflictError } from './calendarErrors'

function backendError(status, code) {
  return { status, data: { error: { code, message: 'ignored' } } }
}

describe('calendarErrors', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  it('extracts the stable backend error code', () => {
    expect(calendarErrorCode(backendError(409, 'CALENDAR_ENTRY_CONFLICT'))).toBe('CALENDAR_ENTRY_CONFLICT')
    expect(calendarErrorCode({})).toBeNull()
    expect(calendarErrorCode(null)).toBeNull()
  })

  it('identifies exactly CALENDAR_ENTRY_CONFLICT at 409 as a conflict, nothing else', () => {
    expect(isCalendarConflictError(backendError(409, 'CALENDAR_ENTRY_CONFLICT'))).toBe(true)
    expect(isCalendarConflictError(backendError(409, 'CALENDAR_INVALID_TRANSITION'))).toBe(false)
    expect(isCalendarConflictError(backendError(404, 'CALENDAR_ENTRY_NOT_FOUND'))).toBe(false)
    expect(isCalendarConflictError({})).toBe(false)
  })

  it('maps every documented calendar error code to a non-technical, translated message', () => {
    const codes = [
      'CALENDAR_DATE_RANGE_INVALID', 'CALENDAR_RANGE_TOO_LARGE', 'CALENDAR_ENTRY_NOT_FOUND',
      'CALENDAR_ENTRY_FORBIDDEN', 'CALENDAR_INVALID_TRANSITION', 'CALENDAR_ENTRY_CONFLICT',
      'CALENDAR_WORKOUT_ALREADY_LINKED', 'CALENDAR_SCHEDULE_RULE_CONFLICT', 'CALENDAR_SCHEDULE_RULE_NOT_FOUND',
      'CALENDAR_ASSIGNMENT_INACTIVE', 'CALENDAR_PROGRAM_DAY_INVALID', 'CALENDAR_TIMEZONE_INVALID',
      'VALIDATION_ERROR',
    ]
    for (const code of codes) {
      const message = calendarErrorMessage(backendError(400, code))
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain(code)
      expect(message.toUpperCase()).not.toContain('SQL')
    }
  })

  it('the conflict message matches the exact required wording', () => {
    expect(calendarErrorMessage(backendError(409, 'CALENDAR_ENTRY_CONFLICT'))).toBe(
      'Der Kalendereintrag wurde zwischenzeitlich geändert. Die aktuellen Daten wurden neu geladen.'
    )
  })

  it('falls back to a generic message for an unrecognized or network error, never a raw code', () => {
    expect(calendarErrorMessage({})).toBeTruthy()
    expect(calendarErrorMessage(new Error('network down'))).toBeTruthy()
    expect(calendarErrorMessage(backendError(500, 'INTERNAL_ERROR'))).toBeTruthy()
  })

  it('maps 401/403/404 without a specific calendar code to sensible fallbacks', () => {
    expect(calendarErrorMessage({ status: 401 })).toBeTruthy()
    expect(calendarErrorMessage({ status: 403 })).toBeTruthy()
    expect(calendarErrorMessage({ status: 404 })).toBeTruthy()
  })
})
