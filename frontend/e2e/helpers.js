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
