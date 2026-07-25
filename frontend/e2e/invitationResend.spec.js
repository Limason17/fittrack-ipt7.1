import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  attachAuth,
  authenticate,
  loginApi,
  registerApi,
  userFixture,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

function extractToken(acceptUrl) {
  return decodeURIComponent(new URL(acceptUrl).pathname.split('/').pop())
}

test('Stage 3C: Owner lädt Admin ein, Admin nimmt an, lädt Trainer ein, löst Resend aus - alter Link stirbt, neuer funktioniert, Zweitverwendung und Widerruf bleiben sicher, Audit-Log ist lesbar', async ({ page, request, browser }) => {
  test.setTimeout(120_000)

  const owner = userFixture('resend-owner')
  const admin = userFixture('resend-admin')
  const trainer = userFixture('resend-trainer')
  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, admin)
  await registerApi(request, trainer)

  // 1: Owner creates the studio and invites an admin through the UI.
  await page.goto('/studios/new')
  await page.getByLabel('Name', { exact: true }).fill(`Stage 3C ${owner.username}`)
  await page.getByLabel('Zeitzone').fill('Europe/Zurich')
  await page.getByRole('button', { name: 'Studio erstellen' }).click()
  await expect(page).toHaveURL(/\/studios\/[0-9a-f-]+$/)
  const studioId = page.url().split('/').at(-1)

  await page.goto(`/studios/${studioId}/invitations`)
  await page.getByLabel('E-Mail-Adresse').fill(admin.email)
  await page.getByLabel('Rolle').selectOption('admin')
  await page.getByRole('button', { name: 'Einladung erstellen' }).click()
  const adminDelivery = page.locator('.studio-delivery a')
  await expect(adminDelivery).toBeVisible()
  const adminAcceptUrl = await adminDelivery.getAttribute('href')

  // 2: Admin accepts.
  const adminContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const adminAuth = await loginApi(adminContext.request, admin)
    const adminPage = await adminContext.newPage()
    await attachAuth(adminPage, adminAuth)
    await adminPage.goto(adminAcceptUrl)
    await adminPage.getByRole('button', { name: 'Einladung annehmen' }).click()
    await expect(adminPage).toHaveURL(new RegExp(`/studios/${studioId}$`))
    await expect(adminPage.locator('.page-header-badge .badge')).toHaveText('Administration')

    // 3: Admin invites a trainer.
    await adminPage.goto(`/studios/${studioId}/invitations`)
    await adminPage.getByLabel('E-Mail-Adresse').fill(trainer.email)
    await adminPage.getByLabel('Rolle').selectOption('trainer')
    await adminPage.getByRole('button', { name: 'Einladung erstellen' }).click()
    const trainerDelivery = adminPage.locator('.studio-delivery a')
    await expect(trainerDelivery).toBeVisible()
    const oldTrainerAcceptUrl = await trainerDelivery.getAttribute('href')
    const oldTrainerToken = extractToken(oldTrainerAcceptUrl)

    // 4: Admin resends the trainer invitation - the shared ConfirmDialog is used,
    // not a native confirm(), and the row shows a fresh delivery link afterwards.
    const row = adminPage.locator('tbody tr').filter({ hasText: trainer.email })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Erneut senden' }).click()
    const dialog = adminPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Einladung erneut senden?')
    await expect(dialog).toContainText(trainer.email)
    await dialog.getByRole('button', { name: 'Erneut senden' }).click()
    await expect(adminPage.getByText('Die Einladung wurde erneut gesendet.').first()).toBeVisible()

    const newTrainerDelivery = adminPage.locator('.studio-delivery a')
    await expect(newTrainerDelivery).toBeVisible()
    const newTrainerAcceptUrl = await newTrainerDelivery.getAttribute('href')
    const newTrainerToken = extractToken(newTrainerAcceptUrl)
    expect(newTrainerToken).not.toBe(oldTrainerToken)

    // 5: The old link is rejected server-side (not just hidden in the UI).
    const trainerAuthForOldCheck = await loginApi(request, trainer)
    const oldTokenAttempt = await request.post(`/api/v1/invitations/${oldTrainerToken}/accept`, {
      headers: { Authorization: `Bearer ${trainerAuthForOldCheck.token}` },
    })
    expect(oldTokenAttempt.status()).toBe(404)
    expect((await oldTokenAttempt.json()).error.code).toBe('INVITATION_INVALID')

    // 6: The new link works.
    const trainerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
    try {
      const trainerAuth = await loginApi(trainerContext.request, trainer)
      const trainerPage = await trainerContext.newPage()
      await attachAuth(trainerPage, trainerAuth)
      await trainerPage.goto(newTrainerAcceptUrl)
      await trainerPage.getByRole('button', { name: 'Einladung annehmen' }).click()
      await expect(trainerPage).toHaveURL(new RegExp(`/studios/${studioId}$`))
      await expect(trainerPage.locator('.page-header-badge .badge')).toHaveText('Trainer:in')

      // 7: A second use of the very same (now-accepted) link is rejected.
      const replay = await trainerContext.request.post(`/api/v1/invitations/${newTrainerToken}/accept`, {
        headers: { Authorization: `Bearer ${trainerAuth.token}` },
      })
      expect(replay.status()).toBe(409)
      expect((await replay.json()).error.code).toBe('INVITATION_ALREADY_USED')
    } finally {
      await trainerContext.close()
    }

    // 8: A revoked invitation can never be resent or used - create a fresh one, revoke it,
    // and confirm both its own accept link and any resend attempt are rejected.
    const secondTrainer = userFixture('resend-trainer2')
    await registerApi(request, secondTrainer)
    await adminPage.goto(`/studios/${studioId}/invitations`)
    await adminPage.getByLabel('E-Mail-Adresse').fill(secondTrainer.email)
    await adminPage.getByLabel('Rolle').selectOption('trainer')
    await adminPage.getByRole('button', { name: 'Einladung erstellen' }).click()
    const secondTrainerAcceptUrl = await adminPage.locator('.studio-delivery a').getAttribute('href')
    const secondTrainerToken = extractToken(secondTrainerAcceptUrl)

    // Located by position (newest invitation, listed first) rather than by
    // e-mail: revoking redacts the e-mail from the row, so a hasText(email)
    // filter would stop matching anything the moment the optimistic UI
    // update lands.
    const secondRow = adminPage.locator('tbody tr').first()
    await expect(secondRow).toContainText(secondTrainer.email)
    await secondRow.getByRole('button', { name: 'Widerrufen' }).click()
    const revokeDialog = adminPage.getByRole('dialog')
    await expect(revokeDialog).toBeVisible()
    await revokeDialog.getByRole('button', { name: 'Widerrufen' }).click()
    await expect(adminPage.getByText('Die Einladung wurde widerrufen.')).toBeVisible()
    await expect(secondRow.getByRole('button')).toHaveCount(0)
    await expect(secondRow.getByText('Keine Aktion verfügbar')).toBeVisible()

    const secondTrainerAuth = await loginApi(request, secondTrainer)
    const revokedAcceptAttempt = await request.post(`/api/v1/invitations/${secondTrainerToken}/accept`, {
      headers: { Authorization: `Bearer ${secondTrainerAuth.token}` },
    })
    expect(revokedAcceptAttempt.status()).toBe(409)
    expect((await revokedAcceptAttempt.json()).error.code).toBe('INVITATION_REVOKED')

    const revokedInvitationsAfterRevoke = await request.get(`/api/v1/studios/${studioId}/invitations?limit=50`, {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
    })
    const revokedInvitation = (await revokedInvitationsAfterRevoke.json()).invitations
      .find((invitation) => invitation.role === 'trainer' && invitation.status === 'revoked')
    const resendOnRevoked = await request.post(
      `/api/v1/studios/${studioId}/invitations/${revokedInvitation.id}/resend`,
      { headers: { Authorization: `Bearer ${ownerAuth.token}` } }
    )
    expect(resendOnRevoked.status()).toBe(409)
    expect((await resendOnRevoked.json()).error.code).toBe('INVITATION_REVOKED')

    // 9: The audit log shows understandable, translated labels - not raw event codes.
    await adminPage.goto(`/studios/${studioId}/audit`)
    await expect(adminPage.getByText('Einladung erneut gesendet')).toBeVisible()
    await expect(adminPage.getByText('Einladung widerrufen').first()).toBeVisible()
    await expect(adminPage.getByText('Einladung angenommen').first()).toBeVisible()
    await expect(adminPage.getByText('invitation.', { exact: false })).toHaveCount(0)
    await expectNoSeriousAxeViolations(adminPage)
  } finally {
    await adminContext.close()
  }
})
