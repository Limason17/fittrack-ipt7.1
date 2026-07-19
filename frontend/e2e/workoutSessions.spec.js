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

test('Member-Workout-Ausführung: Session starten, Sätze protokollieren, abschließen, abbrechen, Historie und Fremdzugriff', async ({ page, request, browser }) => {
  test.setTimeout(240_000)

  const owner = userFixture('wsession-owner')
  const trainer = userFixture('wsession-trainer')
  const member = userFixture('wsession-member')
  const foreignMember = userFixture('wsession-foreign')

  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, trainer)
  await registerApi(request, member)
  await registerApi(request, foreignMember)

  // ---- Fixture setup via API (studio, invitations, program, coaching, assignment). This is
  // pure boilerplate ahead of the feature under test, not the feature itself, so it is built
  // directly through the API - the same convention accessibility.spec.js already uses. ----

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: {
      name: `Workout Session Studio ${owner.username}`,
      slug: `wsession-${owner.username}`,
      defaultLocale: 'de',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  async function inviteAndAcceptApi(role, user) {
    const invitationResponse = await request.post(`/api/v1/studios/${studio.id}/invitations`, {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
      data: { email: user.email, role },
    })
    expect(invitationResponse.status()).toBe(201)
    const acceptUrl = (await invitationResponse.json()).delivery.acceptUrl
    const token = decodeURIComponent(new URL(acceptUrl).pathname.split('/').pop())
    const userAuth = await loginApi(request, user)
    const acceptResponse = await request.post(`/api/v1/invitations/${token}/accept`, {
      headers: { Authorization: `Bearer ${userAuth.token}` },
    })
    expect(acceptResponse.status()).toBe(200)
    return userAuth
  }

  const memberAuth = await inviteAndAcceptApi('member', member)
  await inviteAndAcceptApi('trainer', trainer)
  await inviteAndAcceptApi('member', foreignMember)

  const membershipsResponse = await request.get(`/api/v1/studios/${studio.id}/memberships?limit=50`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })
  expect(membershipsResponse.status()).toBe(200)
  const memberships = (await membershipsResponse.json()).memberships
  const trainerMembership = memberships.find((m) => m.user.username === trainer.username)
  const memberMembership = memberships.find((m) => m.user.username === member.username)

  const relationshipResponse = await request.post(`/api/v1/studios/${studio.id}/coaching-relationships`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { coachMembershipId: trainerMembership.id, memberMembershipId: memberMembership.id },
  })
  expect(relationshipResponse.status()).toBe(201)
  const relationship = (await relationshipResponse.json()).coachingRelationship

  const programResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { name: 'Ganzkörper Grundlagen' },
  })
  expect(programResponse.status()).toBe(201)
  const program = (await programResponse.json()).trainingProgram

  const versionResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: {} }
  )
  expect(versionResponse.status()).toBe(201)
  const version = (await versionResponse.json()).programVersion

  const dayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'Tag 1: Ganzkörper' } }
  )
  expect(dayResponse.status()).toBe(201)
  const day = (await dayResponse.json()).programDay

  const exerciseResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days/${day.id}/exercises`,
    {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
      data: { exerciseNameSnapshot: 'Kniebeuge', targetSets: 2, targetRepsMin: 6, targetRepsMax: 8, targetWeight: 40 },
    }
  )
  expect(exerciseResponse.status()).toBe(201)

  const publishResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/publish`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` } }
  )
  expect(publishResponse.status()).toBe(200)

  const assignmentResponse = await request.post(`/api/v1/studios/${studio.id}/program-assignments`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { programVersionId: version.id, memberMembershipId: memberMembership.id, coachingRelationshipId: relationship.id },
  })
  expect(assignmentResponse.status()).toBe(201)

  // ---- 1: Member opens the plan and sees the assignment with a start action. ----
  await attachAuth(page, memberAuth)
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await expect(page.getByText('Ganzkörper Grundlagen')).toBeVisible()
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByText('Kniebeuge')).toBeVisible()

  // ---- 2: Starting the day navigates to a fresh, mutable session with the planned snapshot and prefilled (empty) sets. ----
  await page.getByRole('button', { name: 'Training starten' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${studio.id}/workout-sessions/[0-9a-f-]+$`))
  const sessionAUrl = page.url()
  await expect(page.getByRole('heading', { name: 'Tag 1: Ganzkörper' })).toBeVisible()
  await expect(page.getByText('Läuft')).toBeVisible()
  await expect(page.getByText('Kniebeuge')).toBeVisible()
  await expect(page.getByText('2 × 6–8 Wdh.')).toBeVisible()
  await expect(page.getByText('40 kg')).toBeVisible()
  const setRows = page.locator('.set-row')
  await expect(setRows).toHaveCount(2)
  await expect(setRows.nth(0).getByLabel('Wdh.')).toHaveValue('')

  // ---- 3: A second "start" attempt for the exact same day converges on the same in-progress
  // session instead of creating a duplicate - the deterministic, user-facing side of the
  // idempotent-start guarantee (the finer-grained dedup-key/race mechanics are covered by
  // workoutSessionState.test.js at the unit level). ----
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByRole('button', { name: 'Fortsetzen' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Training starten' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Fortsetzen' }).click()
  await expect(page).toHaveURL(sessionAUrl)

  // ---- 4: Trying to complete an incomplete session is rejected, without silent auto-completion,
  // and the open exercise is highlighted for the member to act on. ----
  await page.getByRole('button', { name: 'Session abschließen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Session abschließen' }).click()
  await expect(page.getByText('Die Session ist noch nicht vollständig')).toBeVisible()
  await expect(page.locator('.exercise-panel')).toHaveClass(/exercise-panel-highlighted/)

  // ---- 5: Logging results for the planned sets (save-on-blur), then adding and completing an extra set. ----
  await setRows.nth(0).getByLabel('Wdh.').fill('8')
  await setRows.nth(0).getByLabel('Wdh.').blur()
  await expect(setRows.nth(0).getByLabel('Wdh.')).toHaveValue('8')
  await setRows.nth(0).getByLabel('Gewicht (kg)').fill('42.5')
  await setRows.nth(0).getByLabel('Gewicht (kg)').blur()
  await setRows.nth(0).getByRole('button', { name: 'Als erledigt markieren' }).click()
  await expect(setRows.nth(0).getByText('Abgeschlossen')).toBeVisible()

  await setRows.nth(1).getByLabel('Wdh.').fill('7')
  await setRows.nth(1).getByLabel('Wdh.').blur()
  await setRows.nth(1).getByLabel('Gewicht (kg)').fill('42.5')
  await setRows.nth(1).getByLabel('Gewicht (kg)').blur()
  await setRows.nth(1).getByRole('button', { name: 'Als erledigt markieren' }).click()

  await page.getByRole('button', { name: 'Satz hinzufügen' }).click()
  await expect(setRows).toHaveCount(3)
  await setRows.nth(2).getByLabel('Wdh.').fill('6')
  await setRows.nth(2).getByLabel('Wdh.').blur()
  await setRows.nth(2).getByRole('button', { name: 'Als erledigt markieren' }).click()

  await page.getByRole('button', { name: 'Übung abschließen' }).click()
  await expect(page.locator('.exercise-panel-status .badge')).toHaveText('Abgeschlossen')

  // ---- 6: Full completion succeeds, and the session becomes read-only (completed status,
  // completion time, no mutation controls left). ----
  await page.getByRole('button', { name: 'Session abschließen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Session abschließen' }).click()
  await expect(page.getByText('Diese Session ist abgeschlossen und schreibgeschützt.')).toBeVisible()
  await expect(page.locator('.page-header-badge .badge')).toHaveText('Abgeschlossen')
  await expect(page.getByRole('button', { name: 'Satz hinzufügen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Session abschließen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Session abbrechen' })).toHaveCount(0)
  await expect(setRows.nth(0).getByLabel('Wdh.')).toBeDisabled()

  // ---- 7: The completed session shows up in the history, opened from there read-only with the saved values. ----
  await page.getByRole('button', { name: 'Zu meinen Trainings' }).click()
  await expect(page).toHaveURL(`/studios/${studio.id}/workout-sessions`)
  const completedRow = page.locator('tbody tr').filter({ hasText: 'Ganzkörper Grundlagen' }).first()
  await expect(completedRow.getByText('Abgeschlossen')).toBeVisible()
  await completedRow.getByRole('link', { name: 'Details ansehen' }).click()
  await expect(page).toHaveURL(sessionAUrl)
  await expect(page.locator('.set-row').first().getByLabel('Wdh.')).toHaveValue('8')

  // ---- 8: A second session can be started for the same day once the first is terminal. ----
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByRole('button', { name: 'Training starten' })).toBeVisible()
  await page.getByRole('button', { name: 'Training starten' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${studio.id}/workout-sessions/[0-9a-f-]+$`))
  const sessionBUrl = page.url()
  expect(sessionBUrl).not.toBe(sessionAUrl)

  // ---- 9: A concurrent 409 conflict on the same set (two tabs of the same member, both on the
  // still-in-progress session B) is surfaced understandably, never silently overwritten, and
  // resolved via an explicit reload - all before session B is aborted below. ----
  const tabAContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const tabBContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const tabA = await tabAContext.newPage()
    const tabB = await tabBContext.newPage()
    await attachAuth(tabA, memberAuth)
    await attachAuth(tabB, memberAuth)
    await tabA.goto(sessionBUrl)
    await tabB.goto(sessionBUrl)

    const tabASet = tabA.locator('.set-row').nth(1)
    await tabASet.getByLabel('Wdh.').fill('9')
    await tabASet.getByLabel('Wdh.').blur()
    await expect(tabASet.getByText('Gespeichert')).toBeVisible()

    const tabBSet = tabB.locator('.set-row').nth(1)
    await tabBSet.getByLabel('Wdh.').fill('3')
    await tabBSet.getByLabel('Wdh.').blur()
    await expect(tabBSet.getByText('Konflikt')).toBeVisible()
    await expect(tabB.getByText('Diese Daten wurden inzwischen durch eine andere Anfrage verändert.')).toBeVisible()
    await expect(tabBSet.getByLabel('Wdh.')).toHaveValue('3')

    await tabB.getByRole('button', { name: 'Aktuellen Stand laden' }).first().click()
    await expect(tabB.locator('.set-row').nth(1).getByLabel('Wdh.')).toHaveValue('9')
  } finally {
    await tabAContext.close()
    await tabBContext.close()
  }

  // ---- 10: Aborting session B keeps already-saved values while making the session read-only. ----
  const sessionBSets = page.locator('.set-row')
  await sessionBSets.nth(0).getByLabel('Wdh.').fill('5')
  await sessionBSets.nth(0).getByLabel('Wdh.').blur()
  await expect(sessionBSets.nth(0).getByLabel('Wdh.')).toHaveValue('5')

  await page.getByRole('button', { name: 'Session abbrechen' }).click()
  await expect(page.getByRole('dialog')).toContainText('schreibgeschützt')
  await page.getByRole('dialog').getByRole('button', { name: 'Session abbrechen' }).click()
  await expect(page.getByText('Diese Session wurde abgebrochen und ist schreibgeschützt.')).toBeVisible()
  await expect(page.locator('.page-header-badge .badge')).toHaveText('Abgebrochen')
  await expect(sessionBSets.nth(0).getByLabel('Wdh.')).toHaveValue('5')
  await expect(sessionBSets.nth(0).getByLabel('Wdh.')).toBeDisabled()

  // ---- 11: A foreign member of the same studio cannot open the session at all (404, no
  // existence disclosure), and their own logged-in session is not affected. ----
  const foreignContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const foreignAuth = await loginApi(foreignContext.request, foreignMember)
    const foreignPage = await foreignContext.newPage()
    await attachAuth(foreignPage, foreignAuth)
    await foreignPage.goto(sessionAUrl)
    await expect(foreignPage.getByText('Diese Trainingseinheit wurde nicht gefunden.')).toBeVisible()
    await foreignPage.goto(`/studios/${studio.id}/my-training-plan`)
    await expect(foreignPage.getByText('Dir ist aktuell kein Trainingsprogramm zugewiesen.')).toBeVisible()
  } finally {
    await foreignContext.close()
  }

  // ---- 12: The personal workout area remains fully unaffected. ----
  await page.goto('/workouts')
  await expect(page.getByRole('button', { name: 'Workout erstellen' })).toBeVisible()

  // ---- 13: Axe smoke on the three new member views. ----
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await expectNoSeriousAxeViolations(page)
  await page.goto(sessionAUrl)
  await expectNoSeriousAxeViolations(page)
  await page.goto(`/studios/${studio.id}/workout-sessions`)
  await expectNoSeriousAxeViolations(page)
})
