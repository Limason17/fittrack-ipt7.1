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

async function registerAndLogin(request, user) {
  await registerApi(request, user)
  return loginApi(request, user)
}

async function inviteAndAccept(request, ownerAuth, studioId, invitee, role) {
  const invitation = await request.post(`/api/v1/studios/${studioId}/invitations`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { email: invitee.email, role },
  })
  expect(invitation.status()).toBe(201)
  const acceptUrl = (await invitation.json()).delivery.acceptUrl
  const token = decodeURIComponent(new URL(acceptUrl).pathname.split('/').pop())
  const inviteeAuth = await loginApi(request, invitee)
  const accepted = await request.post(`/api/v1/invitations/${token}/accept`, {
    headers: { Authorization: `Bearer ${inviteeAuth.token}` },
  })
  expect(accepted.status()).toBe(200)
  return inviteeAuth
}

async function createRelationship(request, ownerAuth, studioId, coachMembershipId, memberMembershipId) {
  const result = await request.post(`/api/v1/studios/${studioId}/coaching-relationships`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { coachMembershipId, memberMembershipId },
  })
  expect(result.status()).toBe(201)
  return (await result.json()).coachingRelationship
}

async function endRelationship(request, ownerAuth, studioId, relationshipId) {
  const result = await request.patch(`/api/v1/studios/${studioId}/coaching-relationships/${relationshipId}`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { status: 'ended' },
  })
  expect(result.status()).toBe(200)
}

async function setupProgram(request, ownerAuth, studioId, dayName, exerciseName) {
  const program = await request.post(`/api/v1/studios/${studioId}/training-programs`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: `Programm ${dayName}` },
  })
  expect(program.status()).toBe(201)
  const programId = (await program.json()).trainingProgram.id
  const version = await request.post(`/api/v1/studios/${studioId}/training-programs/${programId}/versions`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: {},
  })
  expect(version.status()).toBe(201)
  const versionId = (await version.json()).programVersion.id
  const day = await request.post(
    `/api/v1/studios/${studioId}/training-programs/${programId}/versions/${versionId}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: dayName } }
  )
  expect(day.status()).toBe(201)
  const dayId = (await day.json()).programDay.id
  await request.post(
    `/api/v1/studios/${studioId}/training-programs/${programId}/versions/${versionId}/days/${dayId}/exercises`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { exerciseNameSnapshot: exerciseName, targetSets: 1, targetRepsMin: 5, targetRepsMax: 5 } }
  )
  const published = await request.post(
    `/api/v1/studios/${studioId}/training-programs/${programId}/versions/${versionId}/publish`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` } }
  )
  expect(published.status()).toBe(200)
  return { versionId, dayId }
}

async function createAssignment(request, ownerAuth, studioId, versionId, memberMembershipId, relationshipId) {
  const result = await request.post(`/api/v1/studios/${studioId}/program-assignments`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { programVersionId: versionId, memberMembershipId, coachingRelationshipId: relationshipId },
  })
  expect(result.status()).toBe(201)
  return (await result.json()).programAssignment
}

async function startSessionApi(request, studioId, token, assignmentId, dayId, clientStartKey) {
  const result = await request.post(`/api/v1/studios/${studioId}/program-assignments/${assignmentId}/workout-sessions`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { programDayId: dayId, clientStartKey },
  })
  expect(result.status()).toBe(201)
  return (await result.json()).workoutSession
}

async function completeSessionApi(request, studioId, token, session) {
  const exercise = session.exercises[0]
  const set = exercise.sets[0]
  const setUpdate = await request.patch(
    `/api/v1/studios/${studioId}/workout-sessions/${session.id}/exercises/${exercise.id}/sets/${set.id}`,
    { headers: { Authorization: `Bearer ${token}` }, data: { status: 'completed', actualReps: 5, expectedRevision: set.revision } }
  )
  expect(setUpdate.status()).toBe(200)
  const exerciseUpdate = await request.patch(
    `/api/v1/studios/${studioId}/workout-sessions/${session.id}/exercises/${exercise.id}`,
    { headers: { Authorization: `Bearer ${token}` }, data: { status: 'completed', expectedRevision: exercise.revision } }
  )
  expect(exerciseUpdate.status()).toBe(200)
  const completed = await request.post(`/api/v1/studios/${studioId}/workout-sessions/${session.id}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(completed.status()).toBe(200)
  return (await completed.json()).workoutSession
}

async function setUpFixture(request, idPrefix) {
  const owner = userFixture(`${idPrefix}-owner`)
  const trainer1 = userFixture(`${idPrefix}-trainer1`)
  const trainer2 = userFixture(`${idPrefix}-trainer2`)
  const member1 = userFixture(`${idPrefix}-member1`)
  const member2 = userFixture(`${idPrefix}-member2`)
  const ownerAuth = await registerAndLogin(request, owner)
  await registerApi(request, trainer1)
  await registerApi(request, trainer2)
  await registerApi(request, member1)
  await registerApi(request, member2)

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: {
      name: `${idPrefix} Studio`, slug: `${idPrefix}-${owner.username}`,
      defaultLocale: 'de', defaultTimezone: 'Europe/Zurich', defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  const trainer1Auth = await inviteAndAccept(request, ownerAuth, studio.id, trainer1, 'trainer')
  const trainer2Auth = await inviteAndAccept(request, ownerAuth, studio.id, trainer2, 'trainer')
  const member1Auth = await inviteAndAccept(request, ownerAuth, studio.id, member1, 'member')
  const member2Auth = await inviteAndAccept(request, ownerAuth, studio.id, member2, 'member')

  const membershipsResponse = await request.get(`/api/v1/studios/${studio.id}/memberships?limit=50`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })
  const memberships = (await membershipsResponse.json()).memberships
  const membershipId = (username) => memberships.find((m) => m.user.username === username).id

  const rel1 = await createRelationship(request, ownerAuth, studio.id, membershipId(trainer1.username), membershipId(member1.username))
  const relOwner = await createRelationship(request, ownerAuth, studio.id, membershipId(owner.username), membershipId(member2.username))

  const { versionId, dayId } = await setupProgram(request, ownerAuth, studio.id, 'Tag 1: Ganzkörper', 'Kniebeuge')

  const assignment1 = await createAssignment(request, ownerAuth, studio.id, versionId, membershipId(member1.username), rel1.id)
  const assignment2 = await createAssignment(request, ownerAuth, studio.id, versionId, membershipId(member2.username), relOwner.id)

  const runningSession = await startSessionApi(request, studio.id, member1Auth.token, assignment1.id, dayId, 'running-key')
  const startedForCompletion = await startSessionApi(request, studio.id, member1Auth.token, assignment1.id, dayId, 'completed-key')
  const completedSession = await completeSessionApi(request, studio.id, member1Auth.token, startedForCompletion)
  const ownerSessionRaw = await startSessionApi(request, studio.id, member2Auth.token, assignment2.id, dayId, 'owner-rel-key')
  const ownerSession = await completeSessionApi(request, studio.id, member2Auth.token, ownerSessionRaw)

  return {
    owner, trainer1, trainer2, member1, member2,
    ownerAuth, trainer1Auth, trainer2Auth, member1Auth, member2Auth,
    studio, rel1, relOwner,
    member1MembershipId: membershipId(member1.username),
    member2MembershipId: membershipId(member2.username),
    runningSession, completedSession, ownerSession,
  }
}

test('Trainer sieht nur eigenes Mitglied, filtert Sessions, öffnet read-only Detail mit Resultaten und Notizen', async ({ page, request }) => {
  test.setTimeout(120_000)
  const fx = await setUpFixture(request, 'coachflow')

  await attachAuth(page, fx.trainer1Auth)
  await page.goto(`/studios/${fx.studio.id}/coach-results`)
  await expect(page.getByText(fx.member1.username)).toBeVisible()
  await expect(page.getByText(fx.member2.username)).toHaveCount(0)

  await page.getByRole('button', { name: 'Trainingseinheiten ansehen' }).click()
  await expect(page.getByText('Kniebeuge')).toHaveCount(0) // list view shows programs/days, not exercises
  await expect(page.locator('tbody tr')).toHaveCount(2)

  await page.getByRole('tab', { name: 'Abgeschlossen' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody tr').first()).toContainText('Abgeschlossen')

  await page.getByRole('link', { name: 'Details ansehen' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}$`))
  await expect(page.getByText('Kniebeuge')).toBeVisible()
  await expect(page.getByText('5 Wdh.', { exact: true })).toBeVisible()
  await expect(page.getByText('Diese Ansicht ist schreibgeschützt.')).toBeVisible()
  await expect(page.locator('input')).toHaveCount(0)
})

test('Feedback ist bei laufender Session nicht möglich, wird auf abgeschlossener Session erstellt, Mehrfachklick erzeugt keinen Doppeleintrag, Member sieht und kann nicht antworten', async ({ page, request }) => {
  test.setTimeout(120_000)
  const fx = await setUpFixture(request, 'coachfeedback')

  await attachAuth(page, fx.trainer1Auth)
  await page.goto(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.runningSession.id}`)
  await expect(page.getByText('Läuft')).toBeVisible()
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.getByText('Feedback ist möglich, sobald diese Session abgeschlossen oder abgebrochen wurde.')).toBeVisible()

  await page.goto(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}`)
  await page.getByLabel('Feedback verfassen').fill('Starke Ausführung heute, sauberes Tempo.')

  // Two synchronous clicks in the same tick simulate a double-click before Vue can
  // disable the button; the composable's own isSubmitting guard plus the backend's
  // idempotency key must still prevent a duplicate entry.
  await page.evaluate(() => {
    const button = document.querySelector('form.feedback-form button[type="submit"]')
    button.click()
    button.click()
  })
  await expect(page.getByText('Starke Ausführung heute, sauberes Tempo.')).toBeVisible()
  await expect(page.locator('.feedback-entry')).toHaveCount(1)

  await attachAuth(page, fx.member1Auth)
  await page.goto(`/studios/${fx.studio.id}/workout-sessions/${fx.completedSession.id}`)
  await expect(page.getByText('Feedback deines Trainers')).toBeVisible()
  await expect(page.getByText('Starke Ausführung heute, sauberes Tempo.')).toBeVisible()
  await expect(page.getByRole('button', { name: /antworten/i })).toHaveCount(0)
  await expect(page.locator('.feedback-section textarea')).toHaveCount(0)
})

test('Trainer B und Owner ohne eigene Beziehung sehen die Session nicht; Owner mit eigener Beziehung sieht seine eigene Session', async ({ page, request, browser }) => {
  test.setTimeout(120_000)
  const fx = await setUpFixture(request, 'coachaccess')

  const trainer2Context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const trainer2Page = await trainer2Context.newPage()
    await attachAuth(trainer2Page, fx.trainer2Auth)
    // Two hard navigations for the same identity, back-to-back: each
    // triggers its own silent-refresh bootstrap (the access token is
    // memory-only - see utils/auth.js), and the second must not start until
    // the first's single-use refresh rotation has actually completed, or it
    // races that rotation (see accessibility.spec.js's identical note).
    await trainer2Page.goto(`/studios/${fx.studio.id}/coach-results`, { waitUntil: 'networkidle' })
    await expect(trainer2Page.getByText(fx.member1.username)).toHaveCount(0)
    await trainer2Page.goto(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}`)
    await expect(trainer2Page.getByText('nicht verfügbar')).toBeVisible()
  } finally {
    await trainer2Context.close()
  }

  await attachAuth(page, fx.ownerAuth)
  await page.goto(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}`)
  await expect(page.getByText('nicht verfügbar')).toBeVisible()

  await page.goto(`/studios/${fx.studio.id}/coach-results`)
  await expect(page.getByText(fx.member2.username)).toBeVisible()
  await page.getByRole('button', { name: 'Trainingseinheiten ansehen' }).click()
  await page.getByRole('link', { name: 'Details ansehen' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${fx.studio.id}/coach-results/${fx.member2MembershipId}/sessions/${fx.ownerSession.id}$`))
  await expect(page.getByText('Kniebeuge')).toBeVisible()
})

test('Beziehungsende entzieht dem Coach sofort den Zugriff; das Mitglied behält sein Feedback dauerhaft', async ({ page, request }) => {
  test.setTimeout(120_000)
  const fx = await setUpFixture(request, 'coachrelend')

  await attachAuth(page, fx.trainer1Auth)
  await page.goto(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}`)
  await page.getByLabel('Feedback verfassen').fill('Bleibt für dich sichtbar.')
  await page.getByRole('button', { name: 'Feedback senden' }).click()
  await expect(page.getByText('Bleibt für dich sichtbar.')).toBeVisible()

  await endRelationship(request, fx.ownerAuth, fx.studio.id, fx.rel1.id)

  await page.reload()
  await expect(page.getByText('nicht verfügbar')).toBeVisible()

  await attachAuth(page, fx.member1Auth)
  await page.goto(`/studios/${fx.studio.id}/workout-sessions/${fx.completedSession.id}`)
  await expect(page.getByText('Bleibt für dich sichtbar.')).toBeVisible()
})

test('Ein fremdes Studio bleibt vollständig isoliert; persönliche Workouts funktionieren unverändert', async ({ page, request }) => {
  test.setTimeout(120_000)
  const fx = await setUpFixture(request, 'coachisolated')

  const foreignOwner = userFixture('coachisolated-foreignowner')
  const foreignOwnerAuth = await registerAndLogin(request, foreignOwner)
  const foreignTrainer = userFixture('coachisolated-foreigntrainer')
  await registerApi(request, foreignTrainer)
  const foreignStudioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${foreignOwnerAuth.token}` },
    data: {
      name: 'Foreign Studio', slug: `foreign-${foreignOwner.username}`,
      defaultLocale: 'de', defaultTimezone: 'Europe/Zurich', defaultWeightUnit: 'kg',
    },
  })
  const foreignStudio = (await foreignStudioResponse.json()).studio
  const foreignTrainerAuth = await inviteAndAccept(request, foreignOwnerAuth, foreignStudio.id, foreignTrainer, 'trainer')

  await attachAuth(page, foreignTrainerAuth)
  const crossStudioAttempt = await page.request.get(
    `/api/v1/studios/${fx.studio.id}/coached-members/${fx.member1MembershipId}/workout-sessions`,
    { headers: { Authorization: `Bearer ${foreignTrainerAuth.token}` } }
  )
  expect(crossStudioAttempt.status()).toBe(404)

  await page.goto('/workouts')
  await expect(page.getByRole('button', { name: 'Workout erstellen' })).toBeVisible()
})

test('Footer erscheint auf keiner Route und hinterlässt keinen Leerraum oder horizontalen Overflow bei allen Breakpoints', async ({ page, request }) => {
  test.setTimeout(120_000)
  const fx = await setUpFixture(request, 'coachfooter')

  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]
  const routes = [
    '/login',
    '/workouts',
    `/studios/${fx.studio.id}/coach-results`,
    `/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}`,
    `/studios/${fx.studio.id}/workout-sessions/${fx.completedSession.id}`,
  ]

  await attachAuth(page, fx.trainer1Auth)
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const route of routes) {
      // Stage 3B2: waiting for network idle keeps each hard reload's own
      // silent-refresh bootstrap fully settled before the next one starts -
      // see the identical comment in accessibility.spec.js for why this
      // matters across this many back-to-back reloads.
      await page.goto(route, { waitUntil: 'networkidle' })
      await expect(page.locator('footer')).toHaveCount(0)
      const dimensions = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }))
      expect(dimensions.documentWidth, `${route} at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.viewportWidth)
    }
  }
})

test('Axe-Smokes: Coach-Ergebnisübersicht, Coach-Session-Detail, Member-Session mit Feedback, Login, App-Shell', async ({ page, request }) => {
  test.setTimeout(120_000)
  const fx = await setUpFixture(request, 'coachaxe')

  await attachAuth(page, fx.trainer1Auth)
  await page.goto(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}`)
  await page.getByLabel('Feedback verfassen').fill('Axe-Smoke-Feedback.')
  await page.getByRole('button', { name: 'Feedback senden' }).click()
  await expect(page.getByText('Axe-Smoke-Feedback.')).toBeVisible()

  await page.goto(`/studios/${fx.studio.id}/coach-results`)
  await expectNoSeriousAxeViolations(page)

  await page.goto(`/studios/${fx.studio.id}/coach-results/${fx.member1MembershipId}/sessions/${fx.completedSession.id}`)
  await expectNoSeriousAxeViolations(page)

  await attachAuth(page, fx.member1Auth)
  await page.goto(`/studios/${fx.studio.id}/workout-sessions/${fx.completedSession.id}`)
  await expect(page.getByText('Axe-Smoke-Feedback.')).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  await page.goto('/login')
  await expectNoSeriousAxeViolations(page)

  await page.goto('/workouts')
  await expectNoSeriousAxeViolations(page)
})
