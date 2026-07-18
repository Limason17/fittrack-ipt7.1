import { expect, test } from '@playwright/test'

import {
  attachAuth,
  authenticate,
  loginApi,
  registerApi,
  userFixture,
} from './helpers.js'

test('Studio-Lebenszyklus, Rollen, Isolation, Suspension und persönlicher Bestand', async ({ page, request, browser }) => {
  test.setTimeout(120_000)

  const owner = userFixture('studio-owner')
  const trainer = userFixture('studio-trainer')
  const member = userFixture('studio-member')
  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, trainer)

  const exerciseResponse = await request.get('/api/exercises', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })
  expect(exerciseResponse.status()).toBe(200)
  const exercise = (await exerciseResponse.json()).find((item) => item.category !== 'Cardio')
  const personalTitle = `Persönlich ${owner.username}`
  const personalWorkout = await request.post('/api/workouts', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: {
      title: personalTitle,
      workout_date: '2026-07-18',
      exercises: [{ exercise_id: exercise.id, sets: 3, reps: 8, weight: 50 }],
    },
  })
  expect(personalWorkout.status()).toBe(201)

  await page.goto('/studios/new')
  await page.getByLabel('Name', { exact: true }).fill(`Stage 1A ${owner.username}`)
  await page.getByLabel('Kurzname (optional)').fill(`stage1a-${owner.username}`)
  await page.getByLabel('Zeitzone').fill('Europe/Zurich')
  await page.getByRole('button', { name: 'Studio erstellen' }).click()
  await expect(page).toHaveURL(/\/studios\/[0-9a-f-]+$/)
  const studioId = page.url().split('/').at(-1)
  await expect(page.getByRole('heading', { name: `Stage 1A ${owner.username}` })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Einstellungen' })).toBeVisible()

  async function invite(email, invitedRole) {
    await page.goto(`/studios/${studioId}/invitations`)
    await page.getByLabel('E-Mail-Adresse').fill(email)
    await page.getByLabel('Rolle').selectOption(invitedRole)
    await page.getByRole('button', { name: 'Einladung erstellen' }).click()
    const delivery = page.locator('.studio-delivery a')
    await expect(delivery).toBeVisible()
    const url = await delivery.getAttribute('href')
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4173\/invitations\/[A-Za-z0-9_-]{43}$/)
    return url
  }

  const trainerInvitation = await invite(trainer.email, 'trainer')
  const memberInvitation = await invite(member.email, 'member')

  const trainerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const memberContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const trainerAuth = await loginApi(trainerContext.request, trainer)
    const trainerPage = await trainerContext.newPage()
    await attachAuth(trainerPage, trainerAuth)
    await trainerPage.goto(trainerInvitation)
    await trainerPage.getByRole('button', { name: 'Einladung annehmen' }).click()
    await expect(trainerPage).toHaveURL(new RegExp(`/studios/${studioId}$`))
    await expect(trainerPage.locator('.studio-page-header .pill')).toHaveText('Trainer:in')
    await expect(trainerPage.getByRole('link', { name: 'Einstellungen' })).toHaveCount(0)
    await expect(trainerPage.getByRole('link', { name: 'Mitglieder' }).first()).toBeVisible()
    expect(await trainerPage.evaluate(() => Object.values(localStorage).some((value) => String(value).includes('/invitations/')))).toBe(false)

    const trainerMembers = await trainerContext.request.get(`/api/v1/studios/${studioId}/memberships`, {
      headers: { Authorization: `Bearer ${trainerAuth.token}` },
    })
    expect(trainerMembers.status()).toBe(200)
    const trainerMemberList = (await trainerMembers.json()).memberships
    expect(trainerMemberList.length).toBeGreaterThanOrEqual(2)
    expect(trainerMemberList.every((entry) => entry.status === 'active')).toBe(true)
    expect(JSON.stringify(trainerMemberList)).not.toContain('@example.test')

    const memberPage = await memberContext.newPage()
    await memberPage.goto(memberInvitation)
    await expect(memberPage).toHaveURL(/\/login\?redirect=/)
    await memberPage.getByRole('link', { name: 'Registrieren' }).click()
    await expect(memberPage).toHaveURL(/\/register\?redirect=/)
    await memberPage.getByLabel('Benutzername').fill(member.username)
    await memberPage.getByLabel('E-Mail').fill(member.email)
    await memberPage.getByLabel('Passwort').fill(member.password)
    await memberPage.getByRole('button', { name: 'Registrieren' }).click()
    await expect(memberPage).toHaveURL(/\/login\?redirect=/, { timeout: 5_000 })
    await memberPage.getByLabel('E-Mail').fill(member.email)
    await memberPage.getByLabel('Passwort').fill(member.password)
    await memberPage.getByRole('button', { name: 'Login' }).click()
    await expect(memberPage).toHaveURL(/\/invitations\/[A-Za-z0-9_-]{43}$/)
    await memberPage.getByRole('button', { name: 'Einladung annehmen' }).click()
    await expect(memberPage).toHaveURL(new RegExp(`/studios/${studioId}$`))
    await expect(memberPage.locator('.studio-page-header .pill')).toHaveText('Mitglied')
    await expect(memberPage.getByRole('link', { name: 'Einstellungen' })).toHaveCount(0)
    await expect(memberPage.getByRole('link', { name: 'Mitglieder' })).toHaveCount(0)
    await memberPage.goBack()
    expect(memberPage.url()).not.toContain('/invitations/')
    await memberPage.goto(`/studios/${studioId}`)
    const memberAuth = await loginApi(memberContext.request, member)
    const memberMembers = await memberContext.request.get(`/api/v1/studios/${studioId}/memberships`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    })
    expect(memberMembers.status()).toBe(403)

    const foreignStudioResponse = await request.post('/api/v1/studios', {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
      data: {
        name: `Foreign ${owner.username}`,
        slug: `foreign-${owner.username}`,
        defaultLocale: 'de',
        defaultTimezone: 'Europe/Zurich',
        defaultWeightUnit: 'kg',
      },
    })
    expect(foreignStudioResponse.status()).toBe(201)
    const foreignStudio = (await foreignStudioResponse.json()).studio
    const foreignRead = await trainerContext.request.get(`/api/v1/studios/${foreignStudio.id}`, {
      headers: { Authorization: `Bearer ${trainerAuth.token}` },
    })
    expect(foreignRead.status()).toBe(404)

    const membershipsResponse = await request.get(`/api/v1/studios/${studioId}/memberships`, {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
    })
    expect(membershipsResponse.status()).toBe(200)
    const memberships = (await membershipsResponse.json()).memberships
    const trainerMembership = memberships.find((entry) => entry.user?.email === trainer.email)
    expect(trainerMembership).toBeTruthy()
    const suspendResponse = await request.patch(
      `/api/v1/studios/${studioId}/memberships/${trainerMembership.id}`,
      {
        headers: { Authorization: `Bearer ${ownerAuth.token}` },
        data: { status: 'suspended' },
      }
    )
    expect(suspendResponse.status()).toBe(200)

    await trainerPage.reload()
    await expect(trainerPage).toHaveURL(/\/studios$/)
    await expect(trainerPage.getByLabel('Aktiver Bereich').first()).toHaveValue('')
    await expect(trainerPage.getByRole('heading', { name: 'Persönlicher Bereich' })).toBeVisible()
  } finally {
    await trainerContext.close()
    await memberContext.close()
  }

  await page.goto('/workouts')
  await expect(page.getByLabel('Aktiver Bereich').first()).toHaveValue('')
  await expect(page.getByRole('heading', { name: personalTitle })).toBeVisible()
  const retained = await request.get('/api/workouts', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })
  expect((await retained.json()).some((workout) => workout.title === personalTitle)).toBe(true)
})
