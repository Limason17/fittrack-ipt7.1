// Display-status -> visual/textual mapping for the personal calendar (Stage
// 5A2). `displayStatus` (never `persistedStatus`) is always what drives the
// UI - it is the field the backend derives specifically for display
// (DUE_TODAY/OVERDUE are never persisted, see
// docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md, "Display Status").
import { t } from './i18n'

const DISPLAY_STATUS_TONES = {
  PLANNED: 'info',
  DUE_TODAY: 'due-today',
  OVERDUE: 'warning',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'success',
  SKIPPED: 'danger',
  CANCELLED: 'danger',
}

// SKIPPED and CANCELLED intentionally share the same red tone (see Stage 5A2
// brief, section 6) - text and icon are what keep them distinguishable, not
// color. Every status also gets a distinct optional icon (decorative,
// aria-hidden) as a second, non-color channel beyond the text label.
const DISPLAY_STATUS_ICONS = {
  PLANNED: '○',
  DUE_TODAY: '◆',
  OVERDUE: '▲',
  IN_PROGRESS: '▶',
  COMPLETED: '✓',
  SKIPPED: '⤫',
  CANCELLED: '✕',
}

const KNOWN_DISPLAY_STATUSES = new Set(Object.keys(DISPLAY_STATUS_TONES))
const KNOWN_SOURCE_TYPES = new Set(['personal', 'studio'])

function devWarn(message) {
  // import.meta.env.DEV is Vite's build-time flag - this branch is stripped
  // entirely from production bundles, so an unexpected value from a future
  // backend change is visible to developers without ever reaching a real
  // user's console, and never logs the raw entry payload (which could
  // contain another user's-adjacent metadata in a shared bug report).
  if (import.meta.env?.DEV) {
    console.warn(`[calendar] ${message}`)
  }
}

// Never trust an unrecognized status as if it were a normal one - falls back
// to a neutral tone and a clearly generic label rather than silently
// rendering it as (for example) green/COMPLETED.
export function calendarDisplayStatusTone(displayStatus) {
  if (!KNOWN_DISPLAY_STATUSES.has(displayStatus)) {
    devWarn(`Unknown calendar displayStatus "${displayStatus}" - rendering a neutral fallback.`)
    return 'neutral'
  }
  return DISPLAY_STATUS_TONES[displayStatus]
}

export function calendarDisplayStatusIcon(displayStatus) {
  return DISPLAY_STATUS_ICONS[displayStatus] || '•'
}

export function calendarDisplayStatusLabel(displayStatus) {
  if (!KNOWN_DISPLAY_STATUSES.has(displayStatus)) {
    devWarn(`Unknown calendar displayStatus "${displayStatus}" - rendering a neutral fallback.`)
    return t('calendar.status.unknown')
  }
  return t(`calendar.status.${displayStatus}`)
}

export function calendarSourceLabel(sourceType) {
  if (!KNOWN_SOURCE_TYPES.has(sourceType)) {
    devWarn(`Unknown calendar sourceType "${sourceType}" - rendering a neutral fallback.`)
    return t('calendar.source.unknown')
  }
  return t(`calendar.source.${sourceType}`)
}

export function isKnownDisplayStatus(displayStatus) {
  return KNOWN_DISPLAY_STATUSES.has(displayStatus)
}

export function isKnownSourceType(sourceType) {
  return KNOWN_SOURCE_TYPES.has(sourceType)
}

export const CALENDAR_DISPLAY_STATUS_ORDER = [
  'PLANNED',
  'DUE_TODAY',
  'OVERDUE',
  'IN_PROGRESS',
  'COMPLETED',
  'SKIPPED',
  'CANCELLED',
]
