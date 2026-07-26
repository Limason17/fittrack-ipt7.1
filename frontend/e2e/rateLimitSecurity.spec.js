// Section 23: rate-limit UX and technical security-boundary proof in a real
// browser. Login uses a short, test-specific policy configured only for
// this E2E backend instance (see playwright.config.js's
// sharedBackendEnvironment comment) - not a shrunk production default -
// keyed by e-mail + IP, so it never interferes with any other spec file's
// own unique fixture users. Invitation resend uses its real, unmodified
// production policy (5 per 15 minutes), which is already small enough to
// trip directly.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { authenticate, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

test('1-3. login rate limiting: an understandable 429 message appears, the form disables itself, and a fresh window allows login again', async ({ page }) => {
  const user = userFixture('ratelimit-login')
  await page.request.post('/api/users/register', {
    data: {
      username: user.username,
      email: user.email,
      password: user.password,
      language_preference: 'de',
      weight_unit: 'kg',
      distance_unit: 'km',
    },
  })

  await page.goto('/login')
  // AUTH_LOGIN_RATE_LIMIT_MAX=6 for this E2E backend - 7 rapid wrong-password
  // attempts against the SAME e-mail guarantees the limit trips on the 7th.
  for (let attempt = 0; attempt < 7; attempt += 1) {
    await page.getByLabel('E-Mail').fill(user.email)
    await page.getByLabel('Passwort').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: 'Login' }).click()
    await page.waitForResponse((response) => response.url().includes('/api/users/login'))
  }

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Zu viele Versuche')
  await expect(alert).not.toContainText(/RATE_LIMIT_EXCEEDED|status.*429/i)
  await expect(page.getByRole('button', { name: 'Login' })).toBeDisabled()

  // No serious/critical accessibility violation on the rate-limited error state.
  await expectNoSeriousAxeViolations(page)

  // AUTH_LOGIN_RATE_LIMIT_WINDOW_MS=8000 for this E2E backend.
  await page.waitForTimeout(8_500)
  await expect(page.getByRole('button', { name: 'Login' })).toBeEnabled()

  await page.getByLabel('E-Mail').fill(user.email)
  await page.getByLabel('Passwort').fill(user.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('4. invitation resend rate limiting shows an understandable message, a countdown, and disables the resend button', async ({ page, request }) => {
  const owner = userFixture('ratelimit-resend')
  const target = userFixture('ratelimit-resend-target')
  await authenticate(page, request, owner)

  await page.goto('/studios/new')
  await page.getByLabel('Name', { exact: true }).fill(`Ratelimit ${owner.username}`)
  await page.getByLabel('Zeitzone').fill('Europe/Zurich')
  await page.getByRole('button', { name: 'Studio erstellen' }).click()
  await expect(page).toHaveURL(/\/studios\/[0-9a-f-]+$/)
  const studioId = page.url().split('/').at(-1)

  await page.goto(`/studios/${studioId}/invitations`)
  await page.getByLabel('E-Mail-Adresse').fill(target.email)
  await page.getByLabel('Rolle').selectOption('member')
  await page.getByRole('button', { name: 'Einladung erstellen' }).click()
  await expect(page.locator('.studio-delivery a')).toBeVisible()

  const row = page.locator('tbody tr').filter({ hasText: target.email })
  await expect(row).toBeVisible()

  // The real, unmodified production policy allows 5 resends per 15 minutes -
  // the 6th attempt must be rejected.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await row.getByRole('button', { name: 'Erneut senden' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Erneut senden' }).click()
    await page.waitForResponse((response) => response.url().includes('/resend'))
  }

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Zu viele Versuche')
  await expect(row.getByRole('button', { name: 'Erneut senden' })).toBeDisabled()
  await expect(page.locator('body')).not.toContainText('INVITATION_RESEND_RATE_LIMITED')
})

test('5-6. an oversized body and a wrong Content-Type are both rejected with the documented, safe error contract', async ({ request }) => {
  const oversized = await request.post('/api/users/register', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({
      username: 'toolarge',
      email: 'toolarge@example.test',
      password: 'irrelevant',
      note: 'x'.repeat(400_000),
    }),
  })
  expect(oversized.status()).toBe(413)
  const oversizedBody = await oversized.json()
  expect(oversizedBody.error.code).toBe('PAYLOAD_TOO_LARGE')

  const wrongType = await request.post('/api/users/register', {
    headers: { 'Content-Type': 'text/plain' },
    data: 'not json',
  })
  expect(wrongType.status()).toBe(415)
  const wrongTypeBody = await wrongType.json()
  expect(wrongTypeBody.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
})

test('security headers are present on a real page response', async ({ request }) => {
  const response = await request.get('/api/health/live')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(response.headers()['x-frame-options']).toBe('DENY')
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.headers()['x-powered-by']).toBeUndefined()
})
