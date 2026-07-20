import { expect, test } from '@playwright/test'
import {
  attachAuth,
  authenticate,
  loginApi,
  registerApi,
  userFixture,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

test('Coach- und Programmverwaltung: Trainer baut ein Programm, weist es über eine explizite Coaching-Beziehung zu, Member sieht nur den eigenen Plan', async ({ page, request, browser }) => {
  test.setTimeout(180_000)

  const owner = userFixture('training-owner')
  const trainer = userFixture('training-trainer')
  const member = userFixture('training-member')
  const foreignMember = userFixture('training-foreign')

  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, trainer)
  await registerApi(request, member)
  await registerApi(request, foreignMember)

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: {
      name: `Training Studio ${owner.username}`,
      slug: `training-${owner.username}`,
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

  const trainerAuth = await inviteAndAcceptApi('trainer', trainer)
  await inviteAndAcceptApi('member', member)
  await inviteAndAcceptApi('member', foreignMember)

  // 1: Owner creates a coaching relationship (trainer <-> member) through the UI.
  await attachAuth(page, ownerAuth)
  await page.goto(`/studios/${studio.id}/coaching`)
  await page.getByLabel('Trainer:in').selectOption({ label: `${trainer.username} · Trainer:in` })
  await page.getByLabel('Mitglied').selectOption({ label: member.username })
  await page.getByRole('button', { name: 'Beziehung erstellen' }).click()
  await expect(page.locator('.table tbody tr').filter({ hasText: trainer.username })).toBeVisible()
  await expect(page.locator('.table tbody tr').filter({ hasText: member.username })).toBeVisible()

  // 2: The trainer only ever sees their own coached member, never the foreign member.
  const trainerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const memberContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const foreignContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  let programId
  try {
    const trainerPage = await trainerContext.newPage()
    await attachAuth(trainerPage, trainerAuth)
    await trainerPage.goto(`/studios/${studio.id}/coaching`)
    await expect(trainerPage.getByText('Du siehst ausschließlich die Mitglieder, die du aktuell betreust.')).toBeVisible()
    await expect(trainerPage.getByText(member.username)).toBeVisible()
    await expect(trainerPage.getByText(foreignMember.username)).toHaveCount(0)
    await expect(trainerPage.getByRole('button', { name: 'Beziehung erstellen' })).toHaveCount(0)

    // 3: Trainer creates a program, a draft version, a day and an exercise.
    await trainerPage.goto(`/studios/${studio.id}/training-programs`)
    await trainerPage.getByRole('button', { name: 'Programm erstellen' }).click()
    await trainerPage.getByLabel('Name', { exact: true }).fill('Ganzkörper Grundlagen')
    await trainerPage.getByRole('button', { name: 'Programm erstellen' }).click()
    await expect(trainerPage.getByText('Ganzkörper Grundlagen')).toBeVisible()
    await trainerPage.getByRole('link', { name: /Ganzkörper Grundlagen/ }).click()
    await expect(trainerPage).toHaveURL(/\/training-programs\/[0-9a-f-]+$/)
    programId = trainerPage.url().split('/').at(-1)

    await trainerPage.getByRole('button', { name: 'Neue Entwurfsversion erstellen' }).click()
    await expect(trainerPage.getByText('Version 1')).toBeVisible()

    await trainerPage.getByLabel('Name des Trainingstags').fill('Tag 1: Ganzkörper')
    await trainerPage.getByRole('button', { name: 'Trainingstag hinzufügen' }).click()
    await expect(trainerPage.getByRole('heading', { name: 'Tag 1: Ganzkörper' })).toBeVisible()

    await trainerPage.getByRole('button', { name: 'Übung hinzufügen' }).click()
    await trainerPage.getByLabel('Name der Übung').fill('Kniebeuge')
    await trainerPage.getByLabel('Ziel-Sätze').fill('4')
    await trainerPage.getByLabel('Wdh. min.').fill('6')
    await trainerPage.getByLabel('Wdh. max.').fill('8')
    await trainerPage.getByRole('button', { name: 'Übung hinzufügen' }).click()
    await expect(trainerPage.getByText('Kniebeuge')).toBeVisible()

    // 4: Publishing makes the version read-only.
    await trainerPage.getByRole('button', { name: 'Version veröffentlichen' }).click()
    await trainerPage.getByRole('dialog').getByRole('button', { name: 'Version veröffentlichen' }).click()
    await expect(trainerPage.getByText('Diese Version ist veröffentlicht und daher unveränderlich.')).toBeVisible()
    await expect(trainerPage.getByLabel('Name des Trainingstags')).toHaveCount(0)

    // 5: Trainer assigns the published version to their coached member through their own explicit relationship.
    await trainerPage.goto(`/studios/${studio.id}/assignments`)
    await trainerPage.getByRole('button', { name: 'Zuweisung erstellen' }).click()
    await trainerPage.getByLabel('Mitglied wählen').selectOption({ label: member.username })
    await trainerPage.getByLabel('Programm wählen').selectOption({ label: 'Ganzkörper Grundlagen' })
    await trainerPage.getByLabel('Version wählen').selectOption({ label: 'Version 1' })
    await trainerPage.getByLabel('Coaching-Beziehung wählen').selectOption({ label: trainer.username })
    await trainerPage.getByRole('button', { name: 'Zuweisung erstellen' }).click()
    await expect(trainerPage.getByText(member.username)).toBeVisible()

    // 6: The assigned member sees their plan with days and exercises, and can start
    // the training day since the assignment is active with no date restrictions
    // (Stage 1B.2B2A: member-facing workout execution).
    const memberAuth = await loginApi(memberContext.request, member)
    const memberPage = await memberContext.newPage()
    await attachAuth(memberPage, memberAuth)
    await memberPage.goto(`/studios/${studio.id}/my-training-plan`)
    await expect(memberPage.getByText('Ganzkörper Grundlagen')).toBeVisible()
    await expect(memberPage.getByText('Version 1')).toBeVisible()
    await memberPage.getByRole('button', { name: 'Details anzeigen' }).click()
    await expect(memberPage.getByText('Tag 1: Ganzkörper')).toBeVisible()
    await expect(memberPage.getByText('Kniebeuge')).toBeVisible()
    await expect(memberPage.getByRole('button', { name: /Training starten/i })).toBeVisible()

    // 7: A foreign member of the same studio sees no assignment at all.
    const foreignAuth = await loginApi(foreignContext.request, foreignMember)
    const foreignPage = await foreignContext.newPage()
    await attachAuth(foreignPage, foreignAuth)
    await foreignPage.goto(`/studios/${studio.id}/my-training-plan`)
    await expect(foreignPage.getByText('Dir ist aktuell kein Trainingsprogramm zugewiesen.')).toBeVisible()

    // 8: Ending the coaching relationship immediately removes it as a usable option for new assignments.
    await page.goto(`/studios/${studio.id}/coaching`)
    await page.getByRole('button', { name: 'Beenden' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Beenden' }).click()
    await expect(page.locator('.table tbody tr').filter({ hasText: member.username }).getByText('Beendet')).toBeVisible()

    await page.goto(`/studios/${studio.id}/assignments`)
    await page.getByRole('button', { name: 'Zuweisung erstellen' }).click()
    await page.getByLabel('Mitglied wählen').selectOption({ label: member.username })
    await expect(page.getByText('Für dieses Mitglied besteht keine aktive Coaching-Beziehung, die du verwenden kannst.')).toBeVisible()
  } finally {
    await trainerContext.close()
    await memberContext.close()
    await foreignContext.close()
  }

  // 9: The personal area remains unaffected and fully functional.
  await page.goto('/workouts')
  await expect(page.getByLabel('Aktiver Bereich').first()).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Workout erstellen' })).toBeVisible()

  expect(programId).toMatch(/^[0-9a-f-]+$/)
})
