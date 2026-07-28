import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'

export const E2E_PASSWORD = 'stage1a-browser-password-32-chars'

export function userFixture(id) {
  const runId = randomUUID().replaceAll('-', '').slice(0, 12)
  return {
    username: `stage1a-${id}-${runId}`,
    email: `stage1a-${id}-${runId}@example.test`,
    password: E2E_PASSWORD,
  }
}

export async function registerApi(request, user) {
  const response = await request.post('/api/users/register', {
    data: {
      username: user.username,
      email: user.email,
      password: user.password,
      language_preference: 'de',
      weight_unit: 'kg',
      distance_unit: 'km',
    },
  })
  expect(response.status()).toBe(201)
}

// Stage 3B2: login no longer hands the browser anything to seed localStorage
// with - the session lives in an HttpOnly refresh cookie + a CSRF cookie,
// set via Set-Cookie on this very response. request.post() here uses a
// standalone APIRequestContext (not the page's own browser context), so
// those cookies are NOT automatically visible to any page - they must be
// parsed out of this specific response and re-attached explicitly (see
// attachAuth below). Parsing the raw Set-Cookie headers directly (rather
// than relying on the request context's own accumulated cookie jar) also
// keeps multi-user E2E tests correct: several users logging in through the
// same shared `request` fixture would otherwise overwrite each other's
// same-named cookies in one shared jar.
export async function loginApi(request, user) {
  const response = await request.post('/api/users/login', {
    data: { email: user.email, password: user.password },
  })
  expect(response.status()).toBe(200)
  const data = await response.json()
  return { ...data, cookies: parseSetCookies(response) }
}

export async function authenticate(page, request, user) {
  await registerApi(request, user)
  const auth = await loginApi(request, user)
  await attachAuth(page, auth)
  return auth
}

// Injects the session/CSRF cookies from a prior loginApi() call into a
// (possibly different) page's browser context, before it ever navigates.
// The app's own normal bootstrap (silent refresh via the cookie, then
// GET /users/me) then picks up the session exactly as it would for a real
// returning user - this is deliberately not a shortcut around that flow,
// just a way to seed the browser with cookies a real login response would
// have set.
export async function attachAuth(page, auth) {
  await page.context().addCookies(auth.cookies)
}

const COOKIE_DOMAIN = '127.0.0.1'

function parseSetCookies(response) {
  return response
    .headersArray()
    .filter(({ name }) => name.toLowerCase() === 'set-cookie')
    .map(({ value }) => parseSetCookie(value))
}

function parseSetCookie(headerValue) {
  const [nameValue, ...attributes] = headerValue.split(';').map((part) => part.trim())
  const separator = nameValue.indexOf('=')
  const cookie = {
    name: nameValue.slice(0, separator),
    value: nameValue.slice(separator + 1),
    domain: COOKIE_DOMAIN,
    path: '/',
  }
  for (const attribute of attributes) {
    const attributeSeparator = attribute.indexOf('=')
    const attributeName = (attributeSeparator === -1 ? attribute : attribute.slice(0, attributeSeparator)).toLowerCase()
    const attributeValue = attributeSeparator === -1 ? '' : attribute.slice(attributeSeparator + 1)
    if (attributeName === 'path') cookie.path = attributeValue
    else if (attributeName === 'httponly') cookie.httpOnly = true
    else if (attributeName === 'secure') cookie.secure = true
    else if (attributeName === 'samesite') cookie.sameSite = attributeValue
    else if (attributeName === 'max-age') cookie.expires = Math.floor(Date.now() / 1000) + Number(attributeValue)
  }
  return cookie
}

// ---- Studio-timezone-aware date-only helpers ----
//
// Every spec file that builds a schedule-rule/calendar-entry date used to
// compute "today" via `new Date()` plus that Date object's *local* getters
// (getFullYear/getMonth/getDate/getDay) or via `.toISOString()`. Both are
// wrong for this product: the studio (and DEFAULT_PERSONAL_TIMEZONE for
// purely personal entries) is fixed at Europe/Zurich
// (trainingCalendarDomain.js), while the Node.js test-runner process's own
// "local" timezone is whatever the CI runner's OS is set to - UTC on
// GitHub's ubuntu-latest images - and `.toISOString()` is *always* UTC
// regardless of that. For roughly the 1-2 hours around Zurich local
// midnight (CEST: 00:00-02:00, CET: 00:00-01:00) UTC and Europe/Zurich
// disagree on the calendar day, so a schedule rule pinned to
// "new Date()'s day" lands one calendar day behind the studio's actual
// today - the backend (todayInTimezone(), findOrMaterializeTodayCalendarEntry())
// then correctly refuses to link that day's session/materialize an
// occurrence for the *real* today, leaving the stale prior-day entry
// stranded as PLANNED/OVERDUE forever. See
// frontend/e2e/calendarDateHelpers.spec.js for deterministic, fixed-clock
// proof of this and docs (hotfix branch) for the full root-cause writeup.
//
// These three helpers mirror backend/domain/trainingCalendarDomain.js's own
// todayInTimezone()/addDays() exactly (same Intl.DateTimeFormat/UTC-anchor
// approach) so E2E test data is always computed the same way the product
// itself computes it - never a second, independently-drifting notion of
// "today".

export const STUDIO_TIMEZONE = 'Europe/Zurich'

// Mirrors backend/domain/trainingCalendarDomain.js#todayInTimezone exactly.
// `now` is injectable (defaults to the real clock) purely so it can be unit
// tested deterministically without waiting for a real UTC/Zurich boundary -
// see calendarDateHelpers.spec.js.
export function todayInTimezone(timezone = STUDIO_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

// Mirrors backend/domain/trainingCalendarDomain.js#addDays exactly: pure
// date-only arithmetic anchored to UTC midnight, so the result never
// depends on the Node process's own local timezone and is unaffected by
// DST transitions in any zone (it operates on the calendar-date string,
// never on a wall-clock instant).
export function addDaysToDateOnly(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Matches the backend's 0=Monday..6=Sunday convention
// (trainingCalendarDomain.js). Which weekday a calendar date falls on is a
// pure fact about that date, independent of timezone - this parses the
// date-only string as UTC midnight (never local time, unlike `new
// Date(dateOnly).getDay()`) so the result cannot be shifted by the Node
// process's own local timezone.
export function weekdayForDateOnly(dateOnly) {
  const date = new Date(`${dateOnly}T00:00:00Z`)
  return (date.getUTCDay() + 6) % 7
}

// Formats a date-only string ("YYYY-MM-DD") the same way a human-readable
// UI label would for that exact calendar day - explicit `timeZone: 'UTC'`
// is required here because the string is parsed as UTC midnight; without
// an explicit timeZone, Intl.DateTimeFormat would re-render it in the Node
// process's own local timezone and could shift the displayed day.
export function formatDateOnlyDeCH(dateOnly) {
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateOnly}T00:00:00Z`))
}

export async function chooseExercise(page, name = 'Bench Press', { keyboard = false } = {}) {
  const dialog = page.getByRole('dialog', { name: 'Übung auswählen' })
  await expect(dialog).toBeVisible()
  const card = dialog.locator('.picker-card').filter({ hasText: name }).first()
  const selection = card.getByRole('button', { name: 'Übung auswählen' })
  if (keyboard) {
    await selection.focus()
    await page.keyboard.press('Enter')
  } else {
    await selection.click()
  }
  await expect(dialog).toBeHidden()
}
