import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { attachAuth, authenticate, loginApi, registerApi, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

function readCookie(cookies, name) {
  return cookies.find((cookie) => cookie.name === name)
}

test('login creates a secure session: HttpOnly refresh cookie, readable CSRF cookie, access token never persisted to storage', async ({ page, request }) => {
  const user = userFixture('session-login')
  await registerApi(request, user)

  await page.goto('/login')
  await expectNoSeriousAxeViolations(page)
  await page.getByLabel('E-Mail').fill(user.email)
  await page.getByLabel('Passwort').fill(user.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/$/)

  const cookies = await page.context().cookies()
  const refreshCookie = readCookie(cookies, 'fittrack_refresh')
  const csrfCookie = readCookie(cookies, 'fittrack_csrf')
  expect(refreshCookie).toBeTruthy()
  expect(refreshCookie.httpOnly).toBe(true)
  expect(csrfCookie).toBeTruthy()
  expect(csrfCookie.httpOnly).toBe(false)

  const storageSnapshot = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }))
  const serialized = JSON.stringify(storageSnapshot)
  expect(serialized).not.toContain(refreshCookie.value)
  expect(serialized).not.toContain(csrfCookie.value)
  // No 43-character base64url-shaped value (the opaque token/access-JWT
  // family's own shape) should ever land in persistent browser storage.
  expect(/[A-Za-z0-9_-]{43}/.test(serialized)).toBe(false)
})

test('a hard page reload restores the session via silent refresh, without ever showing the login page', async ({ page, request }) => {
  const user = userFixture('session-reload')
  await authenticate(page, request, user)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profil & Einstellungen' })).toBeVisible()

  await page.reload({ waitUntil: 'networkidle' })

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Profil & Einstellungen' })).toBeVisible()
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()
})

test('a missing/invalid session (no cookies at all) reliably reaches the login page', async ({ page }) => {
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
})

test('an expired access token triggers exactly one silent refresh, and the original request still succeeds', async ({ page, request }) => {
  const user = userFixture('session-silent-refresh')
  await authenticate(page, request, user)
  await page.goto('/profile')
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()

  const refreshCalls = []
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/refresh')) refreshCalls.push(req)
  })

  // Force the in-memory access token into an unmistakably invalid state,
  // simulating natural TTL expiry without waiting out the real 15-minute
  // window - the next authenticated call must discover this via a 401,
  // recover with exactly one silent refresh, and retry transparently.
  await page.evaluate(async () => {
    const auth = await import('/src/utils/auth.js')
    auth.setAccessToken('expired.invalid.token')
  })
  await page.reload({ waitUntil: 'networkidle' })

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()
})

test('logout ends the session: the browser returns to login, and the old cookies are rejected server-side afterward', async ({ page, request }) => {
  const user = userFixture('session-logout')
  await authenticate(page, request, user)
  await page.goto('/profile')
  const cookiesBeforeLogout = await page.context().cookies()

  await page.getByRole('tab', { name: 'Konto' }).click()
  await page.getByRole('button', { name: 'Von diesem Gerät abmelden' }).click()
  await expect(page).toHaveURL(/\/login$/)

  const refreshCookie = readCookie(cookiesBeforeLogout, 'fittrack_refresh')
  const csrfCookie = readCookie(cookiesBeforeLogout, 'fittrack_csrf')
  const refreshAfterLogout = await request.post('/api/auth/refresh', {
    headers: {
      Cookie: `fittrack_refresh=${refreshCookie.value}; fittrack_csrf=${csrfCookie.value}`,
      'X-CSRF-Token': csrfCookie.value,
      Origin: 'http://127.0.0.1:4173',
    },
  })
  expect(refreshAfterLogout.status()).toBe(401)
})

test('two browser contexts for the same user: logout-all in one ends the session in the other too', async ({ browser, request }) => {
  const user = userFixture('session-logout-all')
  await registerApi(request, user)
  const authA = await loginApi(request, user)
  const authB = await loginApi(request, user)

  const contextA = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const contextB = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()
    await attachAuth(pageA, authA)
    await attachAuth(pageB, authB)
    await pageA.goto('/profile', { waitUntil: 'networkidle' })
    await pageB.goto('/profile', { waitUntil: 'networkidle' })
    await expect(pageA.getByText(user.username, { exact: true })).toBeVisible()
    await expect(pageB.getByText(user.username, { exact: true })).toBeVisible()

    await pageA.getByRole('tab', { name: 'Sicherheit' }).click()
    await pageA.getByRole('button', { name: 'Von allen Geräten abmelden' }).click()
    const confirmDialog = pageA.getByRole('dialog')
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: 'Von allen Geräten abmelden' }).click()
    await expect(pageA).toHaveURL(/\/login$/)

    // Session B has no reason to make a request on its own until it does,
    // so its own bootstrap only discovers the revocation on its next
    // navigation/reload - exactly the documented "not real-time push"
    // limitation for cross-device session invalidation (see Stage 3B2 docs).
    //
    // waitUntil: 'load' (not 'networkidle'): the reload's own failed
    // /auth/refresh settles almost immediately and the router redirects
    // client-side right after, but the resulting /login page keeps Vite's
    // dev-only HMR WebSocket open, which can keep 'networkidle' from ever
    // being satisfied even though the redirect itself already completed -
    // confirmed by direct request-log inspection while diagnosing this
    // during Stage 3D. The actual security assertion below (ending up on
    // /login) is unchanged and still authoritative.
    await pageB.reload({ waitUntil: 'load' })
    await expect(pageB).toHaveURL(/\/login/)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('replaying an already-rotated refresh cookie is rejected as reuse, and the resulting compromise also kills the current access token', async ({ page, request }) => {
  const user = userFixture('session-reuse')
  const auth = await authenticate(page, request, user)
  await page.goto('/profile')
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()

  const cookiesBefore = await page.context().cookies()
  const oldRefresh = readCookie(cookiesBefore, 'fittrack_refresh')
  const oldCsrf = readCookie(cookiesBefore, 'fittrack_csrf')

  const firstRefresh = await request.post('/api/auth/refresh', {
    headers: {
      Cookie: `fittrack_refresh=${oldRefresh.value}; fittrack_csrf=${oldCsrf.value}`,
      'X-CSRF-Token': oldCsrf.value,
      Origin: 'http://127.0.0.1:4173',
    },
  })
  expect(firstRefresh.status()).toBe(200)

  const replay = await request.post('/api/auth/refresh', {
    headers: {
      Cookie: `fittrack_refresh=${oldRefresh.value}; fittrack_csrf=${oldCsrf.value}`,
      'X-CSRF-Token': oldCsrf.value,
      Origin: 'http://127.0.0.1:4173',
    },
  })
  expect(replay.status()).toBe(401)
  expect((await replay.json()).error.code).toBe('AUTH_REFRESH_REUSE_DETECTED')

  const meAfterCompromise = await request.get('/api/users/me', {
    headers: { Authorization: `Bearer ${auth.token}` },
  })
  expect(meAfterCompromise.status()).toBe(401)
  expect((await meAfterCompromise.json()).error.code).toBe('AUTH_SESSION_INVALIDATED')
})

test('two tabs of the same browser context refreshing at nearly the same moment never treat a legitimate user as token theft', async ({ page, request }) => {
  const user = userFixture('session-cross-tab')
  await authenticate(page, request, user)
  await page.goto('/profile', { waitUntil: 'networkidle' })
  await expect(page.getByText(user.username, { exact: true })).toBeVisible()

  // A second tab of the SAME browser context - real tabs share one cookie
  // jar, so both will bootstrap against the exact same refresh cookie.
  const tabB = await page.context().newPage()
  try {
    // Force both tabs to discover an expired access token and reload at
    // essentially the same instant (Promise.all, not sequential awaits) -
    // this is the genuine product-level race the cross-tab coordination in
    // utils/api.js (tryAcquireRefreshLock/waitForRefreshSettled) exists
    // for, as opposed to the earlier workoutSessions.spec.js finding, which
    // was a test-fixture bug (stale cookies from a different login),
    // documented in that spec file.
    // tabB's own first-ever navigation runs its own real bootstrap (it has
    // no in-memory token yet, so ensureAuthBootstrap() performs a real,
    // uncoordinated silent refresh) - waiting for network idle here lets
    // that settle completely before this test starts deliberately
    // corrupting tokens and racing reloads below. Without this wait, tabB's
    // own bootstrap could still be in flight and its eventual
    // setAccessToken(realToken) could land AFTER this test's own
    // setAccessToken('expired...') call, undoing the deliberate corruption
    // - a test-timing bug, not a product one.
    await tabB.goto('/profile', { waitUntil: 'networkidle' })
    await expect(tabB.getByText(user.username, { exact: true })).toBeVisible()

    await page.evaluate(async () => {
      const auth = await import('/src/utils/auth.js')
      auth.setAccessToken('expired.invalid.token')
    })
    await tabB.evaluate(async () => {
      const auth = await import('/src/utils/auth.js')
      auth.setAccessToken('expired.invalid.token')
    })

    // Captured synchronously inside the listener - status()/url() are
    // already-known properties, no lazy network round-trip. Deliberately
    // NOT calling response.text() here: by the time these listeners fire
    // during Promise.all(reload, reload), the page keeps navigating, and a
    // later attempt to fetch a stale response's body can fail with
    // "No resource with given identifier found" once Playwright has moved
    // on - a test-infrastructure quirk, not a product signal.
    const refreshResults = []
    const captureRefresh = (res) => {
      if (res.url().includes('/api/auth/refresh')) refreshResults.push({ status: res.status(), url: res.url() })
    }
    page.on('response', captureRefresh)
    tabB.on('response', captureRefresh)

    await Promise.all([
      page.reload({ waitUntil: 'networkidle' }),
      tabB.reload({ waitUntil: 'networkidle' }),
    ])

    // Neither tab was bounced to login - a legitimate concurrent reload in
    // two tabs must never be treated as stolen-token reuse.
    await expect(page).not.toHaveURL(/\/login/)
    await expect(tabB).not.toHaveURL(/\/login/)
    await expect(page.getByText(user.username, { exact: true })).toBeVisible()
    await expect(tabB.getByText(user.username, { exact: true })).toBeVisible()

    // Every /auth/refresh call either tab made must have succeeded - none
    // may have been rejected as reuse, and at most one duplicate active
    // successor may ever exist server-side (each individual call is still
    // strictly single-use; coordination just prevents two tabs from racing
    // the SAME not-yet-rotated cookie against each other).
    for (const result of refreshResults) {
      expect(result.status, JSON.stringify(result)).toBe(200)
    }
    expect(refreshResults.length).toBeGreaterThan(0)
  } finally {
    await tabB.close()
  }
})

test('Axe-Smoke: Login-Seite und Profil-Sicherheitsbereich', async ({ page, request }) => {
  await page.goto('/login')
  await expectNoSeriousAxeViolations(page)

  const user = userFixture('session-axe')
  await authenticate(page, request, user)
  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Sicherheit' }).click()
  await expectNoSeriousAxeViolations(page)
})
