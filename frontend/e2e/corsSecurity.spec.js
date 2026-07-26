// Section 14: genuine BROWSER-enforced CORS proof, not just a raw HTTP
// client asserting response headers (that half of the contract - exact
// header values, Vary: Origin, no wildcard, minimal methods/headers, a
// lookalike-domain Origin string rejected server-side - already has direct
// coverage in backend/test/integration/corsHeaders.test.js). What only a
// real browser can prove is that fetch() itself is actually blocked by
// those headers being absent/wrong - that is what this file exercises.
//
// The frontend dev server proxies /api/* same-origin (see
// playwright.config.js's API_PROXY_TARGET) precisely so the real app never
// needs cross-origin CORS at all in normal operation - every test below
// therefore deliberately targets the backend's own port (3201) directly
// from page-evaluated fetch() calls, bypassing that proxy, to force a
// genuine cross-origin request the browser must itself adjudicate.
import http from 'node:http'
import { expect, test } from '@playwright/test'
import { authenticate, userFixture } from './helpers.js'

const BACKEND_ORIGIN = 'http://127.0.0.1:3201'
const ALLOWED_ORIGIN = 'http://127.0.0.1:4173'
const EVIL_PORT = 4174
const EVIL_ORIGIN = `http://127.0.0.1:${EVIL_PORT}`

let evilServer

test.beforeAll(async () => {
  evilServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><html><body>evil origin test page</body></html>')
  })
  await new Promise((resolve) => evilServer.listen(EVIL_PORT, '127.0.0.1', resolve))
})

test.afterAll(async () => {
  await new Promise((resolve) => evilServer.close(resolve))
})

async function fetchOutcome(page, url, options) {
  return page.evaluate(async ([targetUrl, fetchOptions]) => {
    try {
      const response = await fetch(targetUrl, fetchOptions)
      return { ok: true, status: response.status }
    } catch (error) {
      return { ok: false, message: String(error) }
    }
  }, [url, options])
}

test('1-2. an allowed origin can make a real credentialed cross-origin request, including one that requires a preflight', async ({ page, request }) => {
  const user = userFixture('cors-allowed')
  const auth = await authenticate(page, request, user)

  // waitUntil: 'networkidle' lets the app's own bootstrap-time silent
  // refresh (see docs/STAGE_3B2_SESSION_HARDENING.md) fully settle before
  // this test reads cookie state itself - otherwise the CSRF cookie value
  // read below could be the one from the login response, already rotated
  // away by the bootstrap's own refresh by the time this fetch reaches the
  // server, which the backend's (correct, unweakened) reuse detection would
  // then reject.
  await page.goto('/profile', { waitUntil: 'networkidle' })

  // A credentialed request to a cookie-authenticated endpoint (Section 14.1) -
  // the live CSRF cookie value, read from the page's actual current cookie
  // jar, not the possibly-stale value captured at login time above.
  const csrf = await page.evaluate(() => document.cookie.split('; ').find((c) => c.startsWith('fittrack_csrf='))?.split('=')[1])
  const refreshResult = await fetchOutcome(page, `${BACKEND_ORIGIN}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrf },
  })
  // A resolved (non-rejected) fetch() in 'cors' mode is itself the proof
  // the browser's own CORS check passed - Access-Control-Allow-Origin is
  // not among the response headers exposed to page JS by default (nor does
  // it need to be: the browser already used it to decide whether to let
  // this resolve at all), so there is nothing further to read here.
  expect(refreshResult.ok).toBe(true)
  expect(refreshResult.status).toBe(200)

  // PUT + a custom header forces a real preflight; success here proves the
  // browser's own preflight (Section 14.2) was answered correctly, not just
  // that the simple-request path works.
  const preferenceResult = await fetchOutcome(page, `${BACKEND_ORIGIN}/api/users/language`, {
    method: 'PUT',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ language_preference: 'de' }),
  })
  expect(preferenceResult.ok).toBe(true)
  expect(preferenceResult.status).toBe(200)
})

test('3-4-5. a disallowed (evil) origin is blocked by the browser for both a plain and a credentialed request, with no ACAO ever observed', async ({ page }) => {
  await page.goto(EVIL_ORIGIN)
  expect(new URL(page.url()).origin).toBe(EVIL_ORIGIN)

  const plain = await fetchOutcome(page, `${BACKEND_ORIGIN}/api/health/live`, { method: 'GET' })
  expect(plain.ok).toBe(false)

  const credentialed = await fetchOutcome(page, `${BACKEND_ORIGIN}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': 'irrelevant' },
  })
  expect(credentialed.ok).toBe(false)
})

test('8. a header outside the minimal allowed set fails the preflight even from an otherwise-allowed origin', async ({ page }) => {
  await page.goto('/login')
  expect(new URL(page.url()).origin).toBe(ALLOWED_ORIGIN)

  const result = await fetchOutcome(page, `${BACKEND_ORIGIN}/api/health/live`, {
    method: 'GET',
    headers: { 'X-Not-An-Allowed-Header': 'value' },
  })
  expect(result.ok).toBe(false)
})

test('10. a literal Origin: null context (data: URL) is never treated as allowed', async ({ page }) => {
  await page.goto('data:text/html,<html><body>null origin</body></html>')

  const result = await fetchOutcome(page, `${BACKEND_ORIGIN}/api/health/live`, { method: 'GET' })
  expect(result.ok).toBe(false)
})

test('12. localhost and 127.0.0.1 are distinct origins - only the one actually configured is allowed', async ({ page }) => {
  // CORS_ALLOWED_ORIGINS for this E2E run is 127.0.0.1:4173 only (see
  // playwright.config.js) - localhost:4173 serves the exact same Vite dev
  // server, but is a genuinely different origin the allowlist does not
  // contain.
  await page.goto('http://localhost:4173/login')
  expect(new URL(page.url()).origin).toBe('http://localhost:4173')

  const result = await fetchOutcome(page, `${BACKEND_ORIGIN}/api/health/live`, { method: 'GET' })
  expect(result.ok).toBe(false)
})
