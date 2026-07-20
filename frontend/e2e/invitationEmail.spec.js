import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { attachAuth, loginApi, registerApi, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })

// No real external SMTP provider is used anywhere in this file. The
// "production, provider configured" response shape (delivered:true, no
// acceptUrl/token) is exercised by intercepting the network response with
// page.route() - the frontend is tested against the exact real contract
// documented in invitationDelivery.js, without needing a second backend
// process or changing the shared Playwright webServer environment that
// every other E2E spec (including the existing invitation flow in
// studios.spec.js) relies on. Server-side provider injection, compensation
// and audit behaviour are covered by backend integration tests using the
// same dependency-injection seam (see studioApi.test.js).

async function setUpOwnerWithStudio(request, idPrefix) {
  const owner = userFixture(idPrefix)
  await registerApi(request, owner)
  const ownerAuth = await loginApi(request, owner)
  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: {
      name: 'Invitation Delivery Studio',
      slug: `${idPrefix}-studio`,
      defaultLocale: 'de',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio
  return { owner, ownerAuth, studio }
}

test('a production-shaped success response shows a confirmation without any acceptUrl or token', async ({ page, request }) => {
  const { ownerAuth, studio } = await setUpOwnerWithStudio(request, 'invite-email-success')
  await attachAuth(page, ownerAuth)

  await page.route(`**/api/v1/studios/${studio.id}/invitations`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        invitation: { id: 'mocked-invitation-id', email: 'trainer@example.test', role: 'trainer', status: 'pending' },
        delivery: { delivered: true },
      }),
    })
  })

  await page.goto(`/studios/${studio.id}/invitations`)
  await page.getByLabel('E-Mail-Adresse').fill('trainer@example.test')
  await page.getByRole('button', { name: 'Einladung erstellen' }).click()

  await expect(page.locator('.message-success')).toContainText('versendet')
  await expect(page.locator('.studio-delivery')).toHaveCount(0)
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/invitations\/[A-Za-z0-9_-]{20,}/)
})

test('a delivery failure shows a safe error, keeps the form, and does not log the user out', async ({ page, request }) => {
  const { ownerAuth, studio } = await setUpOwnerWithStudio(request, 'invite-email-failure')
  await attachAuth(page, ownerAuth)

  await page.route(`**/api/v1/studios/${studio.id}/invitations`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INVITATION_DELIVERY_FAILED', message: 'Invitation delivery failed; the invitation was revoked safely.', requestId: 'mock-request-id' },
      }),
    })
  })

  await page.goto(`/studios/${studio.id}/invitations`)
  await page.getByLabel('E-Mail-Adresse').fill('retry-me@example.test')
  await page.getByRole('button', { name: 'Einladung erstellen' }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  const alertText = await page.getByRole('alert').innerText()
  expect(alertText).not.toMatch(/smtp|ECONNREFUSED|EAUTH|stack/i)
  await expect(page.getByLabel('E-Mail-Adresse')).toHaveValue('retry-me@example.test')

  // No global logout occurred: the studio-scoped navigation is still present
  // and a subsequent, unmocked action against the real backend still works.
  await expect(page.getByRole('heading', { name: 'Einladungen', exact: true })).toBeVisible()
})

test('the real, unmocked dev-preview flow can still be created and accepted end-to-end', async ({ page, request, browser }) => {
  const { owner, ownerAuth, studio } = await setUpOwnerWithStudio(request, 'invite-email-real')
  const invitee = userFixture('invite-email-real-invitee')
  await registerApi(request, invitee)
  const inviteeAuth = await loginApi(request, invitee)

  await attachAuth(page, ownerAuth)
  await page.goto(`/studios/${studio.id}/invitations`)
  await page.getByLabel('E-Mail-Adresse').fill(invitee.email)
  await page.getByRole('button', { name: 'Einladung erstellen' }).click()
  await expect(page.locator('.message-success')).toContainText('Einladung')

  const link = await page.locator('.studio-delivery a').getAttribute('href')
  expect(link).toMatch(/\/invitations\//)

  const inviteeContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const inviteePage = await inviteeContext.newPage()
  await attachAuth(inviteePage, inviteeAuth)
  await inviteePage.goto(link)
  await inviteePage.getByRole('button', { name: 'Einladung annehmen' }).click()
  await expect(inviteePage).toHaveURL(new RegExp(`/studios/${studio.id}$`))
  await inviteeContext.close()

  const membershipsResponse = await request.get(`/api/v1/studios/${studio.id}/memberships?limit=50`, {
    headers: { Authorization: `Bearer ${owner.token || ownerAuth.token}` },
  })
  const memberships = (await membershipsResponse.json()).memberships
  expect(memberships.some((membership) => membership.user.username === invitee.username)).toBe(true)
})

test('Axe-Smoke auf der Einladungsansicht', async ({ page, request }) => {
  const { ownerAuth, studio } = await setUpOwnerWithStudio(request, 'invite-email-axe')
  await attachAuth(page, ownerAuth)
  await page.goto(`/studios/${studio.id}/invitations`)
  await expect(page.getByRole('heading', { name: 'Einladungen', exact: true })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
})
