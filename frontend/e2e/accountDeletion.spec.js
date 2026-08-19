import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { authenticate, loginApi, registerApi, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

async function createStudio(request, auth, name) {
  const response = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
      defaultLocale: 'de',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'kg',
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()).studio
}

// Invites a second user as 'admin' (only 'admin'/'trainer'/'member' are
// directly invitable - see backend/domain/studioDomain.js's INVITATION_ROLES),
// has them accept, then promotes their membership to 'owner' via the
// membership PATCH endpoint (STUDIO_ROLES does allow 'owner' there). This is
// the only way to reach a second owner through the real API contract, no
// direct DB seeding available from the browser side.
async function addSecondOwner(request, ownerAuth, studio, secondUser) {
  const inviteResponse = await request.post(`/api/v1/studios/${studio.id}/invitations`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { email: secondUser.email, role: 'admin' },
  })
  expect(inviteResponse.status()).toBe(201)
  const invite = await inviteResponse.json()
  const token = invite.delivery.acceptUrl.split('/invitations/')[1]

  await registerApi(request, secondUser)
  const secondAuth = await loginApi(request, secondUser)
  const acceptResponse = await request.post(`/api/v1/invitations/${token}/accept`, {
    headers: { Authorization: `Bearer ${secondAuth.token}` },
  })
  expect(acceptResponse.status()).toBe(200)
  const membership = (await acceptResponse.json()).membership

  const roleChangeResponse = await request.patch(
    `/api/v1/studios/${studio.id}/memberships/${membership.id}`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { role: 'owner' } }
  )
  expect(roleChangeResponse.status()).toBe(200)
  return secondAuth
}

test('Normaler User mit Studiohistorie: erstellen, Vorschau, falsches Passwort, Löschung, Redirect, alte Session/Login unbrauchbar, Historie bleibt erhalten', async ({ page, request }) => {
  test.setTimeout(60_000)
  const user = userFixture('del-normal')
  const auth = await authenticate(page, request, user)
  const studio = await createStudio(request, auth, `Del Normal Studio ${user.username}`)
  const secondOwner = userFixture('del-normal-owner2')
  const secondOwnerAuth = await addSecondOwner(request, auth, studio, secondOwner)

  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Sicherheit' }).click()
  await expectNoSeriousAxeViolations(page)

  await page.getByRole('button', { name: 'Konto löschen' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Konto löschen' })).toBeVisible()
  // Two active owners - no sole-owner blocker, full impact preview instead.
  await expect(dialog.getByText('Löschung aktuell nicht möglich')).toHaveCount(0)
  await expect(dialog.getByText('Kann erhalten bleiben')).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  await dialog.getByRole('button', { name: 'Weiter' }).click()
  await expect(dialog.getByRole('heading', { name: 'Konto endgültig löschen' })).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  // The wrong-password/wrong-phrase error mapping itself (field-level error,
  // dialog stays open, password cleared) is already covered deterministically
  // at the component-unit level (AccountDeletionDangerZone.test.js, tests
  // 19-20) without spending any of the shared account.deleteRequest rate
  // budget. Deliberately not repeated here - see the STAGE_5C2 doc's "Bekannte
  // Einschränkungen" for why this endpoint's rate-limit key is currently
  // effectively shared across every not-yet-authenticated caller rather than
  // truly per-user, which makes each additional real POST to this endpoint
  // in the same serial E2E run a scarce, worth-conserving resource.
  await dialog.getByLabel('Aktuelles Passwort').fill(user.password)
  await dialog.getByLabel('Bestätigungsphrase').fill(user.username)
  await dialog.getByRole('button', { name: 'Konto endgültig löschen' }).click()

  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 })
  await expect(page.getByText('Dein Konto wurde gelöscht.')).toBeVisible()

  // The old access token is dead.
  const meResponse = await request.get('/api/users/me', { headers: { Authorization: `Bearer ${auth.token}` } })
  expect(meResponse.status()).toBe(401)

  // Silent refresh cannot resurrect the deleted account: the deletion
  // response already cleared the session cookies server-side
  // (accountRouter.js), so a fresh navigation to a protected route has
  // nothing left to silently restore a session from and bounces straight
  // back to /login - exercising the app's real ensureAuthBootstrap() path,
  // not a hand-rolled request.
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/login/)

  // The old e-mail/password combination no longer authenticates at all.
  const oldLogin = await request.post('/api/users/login', { data: { email: user.email, password: user.password } })
  expect(oldLogin.status()).toBe(401)

  // Historical membership is preserved (anonymized), not erased, for the
  // remaining owner - Section 11's "Mitgliedschaften: -> left".
  const membershipsResponse = await request.get(`/api/v1/studios/${studio.id}/memberships`, {
    headers: { Authorization: `Bearer ${secondOwnerAuth.token}` },
  })
  expect(membershipsResponse.status()).toBe(200)
  const memberships = (await membershipsResponse.json()).memberships
  expect(memberships.some((membership) => membership.status === 'left')).toBe(true)
})

test('Alleiniger Owner: Blocker sichtbar, keine Löschbestätigung möglich, Konto bleibt vollständig aktiv', async ({ page, request }) => {
  const user = userFixture('del-sole-owner')
  const auth = await authenticate(page, request, user)
  const studio = await createStudio(request, auth, `Sole Owner Studio ${user.username}`)

  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Sicherheit' }).click()
  await page.getByRole('button', { name: 'Konto löschen' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Löschung aktuell nicht möglich')).toBeVisible()
  await expect(dialog.getByText(studio.name)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Weiter' })).toHaveCount(0)
  await expect(dialog.getByLabel('Aktuelles Passwort')).toHaveCount(0)
  await expectNoSeriousAxeViolations(page)

  await dialog.getByRole('button', { name: 'Verstanden' }).click()
  await expect(dialog).toBeHidden()

  // The account remains fully active and functional afterward.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Profil & Einstellungen' })).toBeVisible()
  const meResponse = await request.get('/api/users/me', { headers: { Authorization: `Bearer ${auth.token}` } })
  expect(meResponse.status()).toBe(200)
})

test('Hard Delete: User ohne Studiohistorie, Login danach unmöglich, persönliche Übung wird nie global, E-Mail wiederverwendbar', async ({ page, request }) => {
  test.setTimeout(60_000)
  const user = userFixture('del-hard')
  const auth = await authenticate(page, request, user)

  // A personal exercise, to prove it never leaks into the global library
  // after a hard delete (Stage 5C1 merge-gate finding #1).
  const uniqueExerciseName = `Del Hard Exercise ${user.username}`
  const exerciseResponse = await request.post('/api/exercises', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: uniqueExerciseName, category: 'Brust', muscle_group: 'Brustmitte' },
  })
  expect(exerciseResponse.status()).toBe(201)

  await page.goto('/profile')
  await page.getByRole('tab', { name: 'Sicherheit' }).click()
  await page.getByRole('button', { name: 'Konto löschen' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Löschung aktuell nicht möglich')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Weiter' }).click()
  await dialog.getByLabel('Aktuelles Passwort').fill(user.password)
  await dialog.getByLabel('Bestätigungsphrase').fill(user.username)
  await dialog.getByRole('button', { name: 'Konto endgültig löschen' }).click()

  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 })
  await expect(page.getByText('Dein Konto wurde gelöscht.')).toBeVisible()

  const oldLogin = await request.post('/api/users/login', { data: { email: user.email, password: user.password } })
  expect(oldLogin.status()).toBe(401)

  // The personal exercise never leaked into the global library, seen by a
  // completely unrelated second user.
  const otherUser = userFixture('del-hard-other')
  const otherAuth = await authenticate(page, request, otherUser)
  const exercisesResponse = await request.get('/api/exercises', {
    headers: { Authorization: `Bearer ${otherAuth.token}` },
  })
  expect(exercisesResponse.status()).toBe(200)
  const exercises = await exercisesResponse.json()
  expect(exercises.some((exercise) => exercise.name === uniqueExerciseName)).toBe(false)

  // The original e-mail address can immediately be reused for a brand-new
  // registration - the hard-deleted row leaves no trailing unique-key row.
  const reRegisterResponse = await request.post('/api/users/register', {
    data: {
      username: `${user.username}-reused`,
      email: user.email,
      password: user.password,
      language_preference: 'de',
      weight_unit: 'kg',
      distance_unit: 'km',
    },
  })
  expect(reRegisterResponse.status()).toBe(201)
})
