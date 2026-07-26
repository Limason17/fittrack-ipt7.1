import { beforeEach, describe, expect, it, vi } from 'vitest'
import { locale, t } from './i18n'
import {
  CALENDAR_DISPLAY_STATUS_ORDER,
  calendarDisplayStatusIcon,
  calendarDisplayStatusLabel,
  calendarDisplayStatusTone,
  calendarSourceLabel,
  isKnownDisplayStatus,
  isKnownSourceType,
} from './calendarStatus'

describe('calendarStatus', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  it('maps every known display status to a distinct tone, matching the product color contract', () => {
    expect(calendarDisplayStatusTone('PLANNED')).toBe('info')
    expect(calendarDisplayStatusTone('DUE_TODAY')).toBe('due-today')
    expect(calendarDisplayStatusTone('OVERDUE')).toBe('warning')
    expect(calendarDisplayStatusTone('IN_PROGRESS')).toBe('in-progress')
    expect(calendarDisplayStatusTone('COMPLETED')).toBe('success')
    expect(calendarDisplayStatusTone('SKIPPED')).toBe('danger')
    expect(calendarDisplayStatusTone('CANCELLED')).toBe('danger')
  })

  it('SKIPPED and CANCELLED share the same tone but must be distinguishable by label and icon', () => {
    expect(calendarDisplayStatusTone('SKIPPED')).toBe(calendarDisplayStatusTone('CANCELLED'))
    expect(calendarDisplayStatusLabel('SKIPPED')).not.toBe(calendarDisplayStatusLabel('CANCELLED'))
    expect(calendarDisplayStatusIcon('SKIPPED')).not.toBe(calendarDisplayStatusIcon('CANCELLED'))
  })

  it('every known status has a unique icon', () => {
    const icons = CALENDAR_DISPLAY_STATUS_ORDER.map(calendarDisplayStatusIcon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('produces the exact German labels required by the product spec', () => {
    expect(calendarDisplayStatusLabel('PLANNED')).toBe('Geplant')
    expect(calendarDisplayStatusLabel('DUE_TODAY')).toBe('Heute fällig')
    expect(calendarDisplayStatusLabel('OVERDUE')).toBe('Noch zu bestätigen')
    expect(calendarDisplayStatusLabel('IN_PROGRESS')).toBe('In Bearbeitung')
    expect(calendarDisplayStatusLabel('COMPLETED')).toBe('Abgeschlossen')
    expect(calendarDisplayStatusLabel('SKIPPED')).toBe('Übersprungen')
    expect(calendarDisplayStatusLabel('CANCELLED')).toBe('Abgesagt')
  })

  it('OVERDUE never surfaces the literal technical term "Overdue" to the user', () => {
    expect(calendarDisplayStatusLabel('OVERDUE').toLowerCase()).not.toContain('overdue')
  })

  it('produces the exact English labels required by the product spec', () => {
    locale.value = 'en'
    expect(calendarDisplayStatusLabel('PLANNED')).toBe('Planned')
    expect(calendarDisplayStatusLabel('DUE_TODAY')).toBe('Due today')
    expect(calendarDisplayStatusLabel('OVERDUE')).toBe('Awaiting confirmation')
    expect(calendarDisplayStatusLabel('IN_PROGRESS')).toBe('In progress')
    expect(calendarDisplayStatusLabel('COMPLETED')).toBe('Completed')
    expect(calendarDisplayStatusLabel('SKIPPED')).toBe('Skipped')
    expect(calendarDisplayStatusLabel('CANCELLED')).toBe('Cancelled')
  })

  it('falls back to a neutral tone and generic label for an unknown status, and warns only in dev', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(calendarDisplayStatusTone('SOMETHING_NEW')).toBe('neutral')
    expect(calendarDisplayStatusLabel('SOMETHING_NEW')).toBe(t('calendar.status.unknown'))
    expect(isKnownDisplayStatus('SOMETHING_NEW')).toBe(false)
    warnSpy.mockRestore()
  })

  it('maps known source types and falls back for an unknown one', () => {
    expect(calendarSourceLabel('personal')).toBe('Persönlich')
    expect(calendarSourceLabel('studio')).toBe('Studio')
    expect(isKnownSourceType('personal')).toBe(true)
    expect(isKnownSourceType('studio')).toBe(true)
    expect(isKnownSourceType('something-else')).toBe(false)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(calendarSourceLabel('something-else')).toBe(t('calendar.source.unknown'))
    warnSpy.mockRestore()
  })
})
