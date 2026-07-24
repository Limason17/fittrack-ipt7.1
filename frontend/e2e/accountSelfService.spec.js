import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { attachAuth, authenticate, loginApi, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

test('Passwortänderung meldet den Benutzer ab; altes Passwort funktioniert nicht mehr, neues schon', async ({ page, request }) => {
  const user = userFixture('pwchange')
  await authenticate(page, request, user)
  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Sicherheit' }).click()

  await expectNoSeriousAxeViolations(page)

  const newPassword = 'stage3b1-new-browser-password-32'
  await page.locator('#current-password').fill(user.password)
  await page.getByLabel('Neues Passwort', { exact: true }).fill(newPassword)
  await page.getByLabel('Neues Passwort bestätigen').fill(newPassword)
  await page.getByRole('button', { name: 'Passwort ändern' }).click()

  await expect(page).toHaveURL(/\/login$/, { timeout: 5_000 })

  // Old password no longer works.
  const oldPasswordLogin = await request.post('/api/users/login', {
    data: { email: user.email, password: user.password },
  })
  expect(oldPasswordLogin.status()).toBe(401)

  // New password works, in the browser too.
  await page.getByLabel('E-Mail').fill(user.email)
  await page.getByLabel('Passwort').fill(newPassword)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('E-Mail-Änderung: Anfrage, Bestätigung über den lokalen Testtransport-Link, Abmeldung, neue Anmeldung, Replay-Ablehnung, Studio bleibt erhalten', async ({ page, request, browser }) => {
  test.setTimeout(60_000)
  const user = userFixture('emailchange')
  const auth = await authenticate(page, request, user)

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: 'Stage 3B1 Account Studio',
      slug: `stage3b1-account-${user.username}`,
      defaultLocale: 'de',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Sicherheit' }).click()

  const newEmail = `${user.username}-new@example.test`
  await page.getByLabel('Neue E-Mail-Adresse').fill(newEmail)
  await page.locator('#email-change-password').fill(user.password)
  await page.getByRole('button', { name: 'Änderung anfordern' }).click()

  await expect(page.getByText('Offene Anfrage')).toBeVisible()
  const link = await page.locator('.studio-delivery a').getAttribute('href')
  expect(link).toMatch(/\/account\/email-change\//)
  const storedValues = await page.evaluate(() => Object.values(localStorage))
  expect(storedValues).not.toContain(link)

  // Confirm on a fresh, unauthenticated browser context - the link was
  // delivered to the new e-mail address and may be opened anywhere.
  const confirmContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const confirmPage = await confirmContext.newPage()
    await confirmPage.goto(link)
    await expect(confirmPage.getByRole('heading', { name: 'E-Mail-Adresse bestätigen' })).toBeVisible()
    await expectNoSeriousAxeViolations(confirmPage)
    await confirmPage.getByRole('button', { name: 'E-Mail-Adresse bestätigen' }).click()
    await expect(confirmPage.getByRole('heading', { name: 'E-Mail-Adresse bestätigt' })).toBeVisible()

    // Replaying the same link is rejected, not silently re-confirmed.
    await confirmPage.reload()
    await confirmPage.getByRole('button', { name: 'E-Mail-Adresse bestätigen' }).click()
    await expect(confirmPage.getByRole('alert')).toBeVisible()
  } finally {
    await confirmContext.close()
  }

  // Old e-mail no longer works.
  const oldEmailLogin = await request.post('/api/users/login', {
    data: { email: user.email, password: user.password },
  })
  expect(oldEmailLogin.status()).toBe(401)

  // New e-mail works, and the studio membership from before the change is
  // still fully intact.
  const newAuth = await loginApi(request, { email: newEmail, password: user.password })
  await attachAuth(page, newAuth)
  await page.goto(`/studios/${studio.id}`)
  await expect(page.getByRole('heading', { name: 'Stage 3B1 Account Studio' })).toBeVisible()
})
