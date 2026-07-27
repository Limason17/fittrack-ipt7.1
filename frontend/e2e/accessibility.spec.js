import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { attachAuth, authenticate, loginApi, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })
const accessibilityUser = userFixture('a11y')

async function authenticateExisting(page, request) {
  const auth = await loginApi(request, accessibilityUser)
  await attachAuth(page, auth)
}

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact)
  )
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

// A toast's enter transition only animates opacity/transform (ToastHost.vue),
// but axe's color-contrast check measures the actually-composited pixel
// color, so scanning while a toast is still mid-fade-in can observe a
// transiently blended, non-representative color rather than the toast's real
// steady-state one (which is a compliant ~8:1 - verified separately). Vue
// removes the `*-enter-active` class itself the instant the transition
// genuinely finishes, so polling for that class to be gone is a real,
// event-backed signal - not a blind wait - and resolves immediately if no
// toast is present at all.
async function waitForToastsToSettle(page) {
  await expect(page.locator('.toast-enter-active')).toHaveCount(0, { timeout: 2000 })
}

test('Kernseiten haben keine schweren oder kritischen Axe-Verstöße', async ({ page, request }) => {
  // Stage 3D: this test does 17 back-to-back hard reloads, each with its own
  // silent-refresh bootstrap and a full axe-core analysis. Refresh now does a
  // real MySQL round trip for its shared rate-limit bucket (Section 5), which
  // adds a few hundred ms per call; across 17 iterations that legitimately
  // pushes total runtime past the default 45s test timeout, so this needs
  // realistic headroom rather than a different wait heuristic.
  test.setTimeout(180_000)
  await page.goto('/login')
  await expectNoSeriousAxeViolations(page)
  await page.goto('/register')
  await expectNoSeriousAxeViolations(page)

  const auth = await authenticate(page, request, accessibilityUser)
  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: `Axe ${accessibilityUser.username}`,
      slug: `axe-${accessibilityUser.username}`,
      defaultLocale: 'de',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  const programResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: `Axe Program ${accessibilityUser.username}` },
  })
  expect(programResponse.status()).toBe(201)
  const program = (await programResponse.json()).trainingProgram

  for (const route of [
    '/workouts',
    '/calendar',
    '/progress',
    '/profile',
    '/studios',
    '/studios/new',
    `/studios/${studio.id}`,
    `/studios/${studio.id}/settings`,
    `/studios/${studio.id}/members`,
    `/studios/${studio.id}/invitations`,
    `/studios/${studio.id}/audit`,
    `/studios/${studio.id}/coaching`,
    `/studios/${studio.id}/training-programs`,
    `/studios/${studio.id}/training-programs/${program.id}`,
    `/studios/${studio.id}/assignments`,
    `/studios/${studio.id}/my-training-plan`,
    `/studios/${studio.id}/access-denied`,
    `/invitations/${'a'.repeat(43)}`,
  ]) {
    // The access token is memory-only, so every one of these hard reloads
    // triggers its own silent-refresh bootstrap. The default 'load' wait
    // resolves before that bootstrap's own fetch necessarily completes,
    // which - across this many back-to-back reloads - can race the
    // previous reload's still-in-flight refresh (single-use rotation, see
    // services/sessionService.js) and spuriously invalidate the session, so
    // this loop must not start the next reload until the current one has
    // actually gone network-idle.
    await page.goto(route, { waitUntil: 'networkidle' })
    await expect(page).not.toHaveURL(/\/login/)
    await expectNoSeriousAxeViolations(page)
  }
})

test('Skip-Link, Seitentitel, Routenfokus und 404 sind tastaturtauglich', async ({ page }) => {
  await page.goto('/login')
  await expect(page).toHaveTitle('Login | FitTrack')
  await expect(page.locator('#main-content')).toBeFocused()
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1')
    document.body.focus()
    document.body.removeAttribute('tabindex')
  })
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Zum Inhalt springen' })
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()

  await page.goto('/nicht-vorhanden')
  await expect(page).toHaveTitle('Seite nicht gefunden | FitTrack')
  await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible()
  await expect(page.locator('#main-content')).toBeFocused()
})

test('Übungsauswahl bindet Fokus, schließt mit Escape und gibt Fokus zurück', async ({ page, request }) => {
  await authenticateExisting(page, request)
  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Workout erstellen' }).click()
  const trigger = page.locator('.workout-form').getByRole('button', { name: 'Übung auswählen' })
  await trigger.focus()
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: 'Übung auswählen' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Übung suchen')).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('Mobile Navigation meldet Zustand und schließt per Escape', async ({ page, request }) => {
  await authenticateExisting(page, request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workouts', { waitUntil: 'networkidle' })
  const menu = page.locator('.app-header-burger')
  await expect(menu).toHaveAccessibleName('Menü öffnen')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(menu).toHaveAccessibleName('Menü schließen')
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()
})

test('Pilot-Viewports haben auf Kernseiten keinen horizontalen Overflow', async ({ page, request }) => {
  await authenticateExisting(page, request)
  const viewports = [
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
  ]

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const route of ['/workouts', '/calendar', '/progress']) {
      // See the networkidle comment on the axe-scan loop above - same
      // rapid-fire-reload/bootstrap-refresh race applies to this loop.
      await page.goto(route, { waitUntil: 'networkidle' })
      await expect(page).not.toHaveURL(/\/login/)
      const dimensions = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
      }))
      expect(dimensions.documentWidth, `${route} at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.viewportWidth)
      expect(dimensions.bodyWidth, `${route} at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.viewportWidth)
    }
  }
})

test('Stage-1B.2A-Seiten haben bei 1440/1024/768/390 keinen horizontalen Overflow', async ({ page, request }) => {
  const auth = await authenticate(page, request, userFixture('a11y-1b2a'))
  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: 'Responsive Studio',
      slug: `responsive-${auth.user.id}`,
      defaultLocale: 'de',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  const programResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: 'Responsive Program with a fairly long descriptive name' },
  })
  expect(programResponse.status()).toBe(201)
  const program = (await programResponse.json()).trainingProgram
  const versionResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs/${program.id}/versions`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {},
  })
  expect(versionResponse.status()).toBe(201)
  const version = (await versionResponse.json()).programVersion
  const dayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${auth.token}` }, data: { name: 'Day with an unusually long training day name' } }
  )
  expect(dayResponse.status()).toBe(201)
  const day = (await dayResponse.json()).programDay
  await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days/${day.id}/exercises`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { exerciseNameSnapshot: 'An exercise with a rather long descriptive name', targetSets: 4, targetRepsMin: 6, targetRepsMax: 8 },
    }
  )

  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]
  const routes = [
    `/studios/${studio.id}/coaching`,
    `/studios/${studio.id}/training-programs`,
    `/studios/${studio.id}/training-programs/${program.id}`,
    `/studios/${studio.id}/assignments`,
    `/studios/${studio.id}/my-training-plan`,
  ]

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const route of routes) {
      // See the networkidle comment on the axe-scan loop above - same
      // rapid-fire-reload/bootstrap-refresh race applies to this loop.
      await page.goto(route, { waitUntil: 'networkidle' })
      await expect(page).not.toHaveURL(/\/login/)
      const dimensions = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
      }))
      expect(dimensions.documentWidth, `${route} at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.viewportWidth)
      expect(dimensions.bodyWidth, `${route} at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.viewportWidth)
    }
  }
})

test('Stage-5A2-Kalender: Desktop, mobil, gefüllt und alle drei Dialoge haben keine schweren oder kritischen Axe-Verstöße', async ({ page, request }) => {
  test.setTimeout(90_000)
  const user = userFixture('a11y-calendar')
  await authenticate(page, request, user)

  const future = new Date()
  future.setDate(future.getDate() + 4)
  const futureStr = future.toISOString().slice(0, 10)

  await page.goto('/calendar')
  await expectNoSeriousAxeViolations(page) // empty state, desktop

  // ---- Create dialog ----
  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoSeriousAxeViolations(page)
  await page.getByLabel('Titel').fill('Axe Test Training')
  await page.getByLabel('Datum').fill(futureStr)
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Training wurde eingetragen.')).toBeVisible()
  await waitForToastsToSettle(page)

  // ---- Filled calendar, desktop ----
  await expectNoSeriousAxeViolations(page)

  // ---- Event detail dialog ----
  await page.getByRole('button', { name: /Axe Test Training/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  // ---- Confirm dialog (the "skip" confirm variant) ----
  await page.getByRole('button', { name: 'Überspringen' }).click()
  await expect(page.getByRole('dialog').getByText('wird als übersprungen markiert')).toBeVisible()
  await expectNoSeriousAxeViolations(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click()

  // ---- Mobile viewport: filled calendar (agenda view) ----
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoSeriousAxeViolations(page)

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
})

test('Stage-5A3-Zeitplan: leer, Formular, gefüllt, Bearbeiten, Deaktivieren-Dialog und mobil/1440 haben keine schweren oder kritischen Axe-Verstöße', async ({ page, request }) => {
  test.setTimeout(120_000)
  const owner = userFixture('a11y-schedule')
  const ownerAuth = await authenticate(page, request, owner)

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { name: `A11y Schedule ${owner.username}`, slug: `a11y-sched-${owner.username}`, defaultLocale: 'de', defaultTimezone: 'Europe/Zurich', defaultWeightUnit: 'kg' },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  const member = userFixture('a11y-schedule-member')
  const invitationResponse = await request.post(`/api/v1/studios/${studio.id}/invitations`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { email: member.email, role: 'member' },
  })
  const acceptUrl = (await invitationResponse.json()).delivery.acceptUrl
  const token = decodeURIComponent(new URL(acceptUrl).pathname.split('/').pop())
  await request.post('/api/users/register', {
    data: { username: member.username, email: member.email, password: member.password, language_preference: 'de', weight_unit: 'kg', distance_unit: 'km' },
  })
  const memberAuth = await loginApi(request, member)
  await request.post(`/api/v1/invitations/${token}/accept`, { headers: { Authorization: `Bearer ${memberAuth.token}` } })

  const memberships = (await (await request.get(`/api/v1/studios/${studio.id}/memberships?limit=50`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })).json()).memberships
  const ownerMembership = memberships.find((m) => m.user.username === owner.username)
  const memberMembership = memberships.find((m) => m.user.username === member.username)
  const relationshipResponse = await request.post(`/api/v1/studios/${studio.id}/coaching-relationships`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { coachMembershipId: ownerMembership.id, memberMembershipId: memberMembership.id },
  })
  const relationship = (await relationshipResponse.json()).coachingRelationship

  const programResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'A11y Schedule Programm' },
  })
  const program = (await programResponse.json()).trainingProgram
  const versionResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs/${program.id}/versions`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: {},
  })
  const version = (await versionResponse.json()).programVersion
  const dayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'A11y Day' } }
  )
  const day = (await dayResponse.json()).programDay
  await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/publish`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` } }
  )
  const assignmentResponse = await request.post(`/api/v1/studios/${studio.id}/program-assignments`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { programVersionId: version.id, memberMembershipId: memberMembership.id, coachingRelationshipId: relationship.id },
  })
  const assignment = (await assignmentResponse.json()).programAssignment
  const scheduleUrl = `/studios/${studio.id}/program-assignments/${assignment.id}/schedule`

  // ---- 1: Empty state, desktop ----
  await page.goto(scheduleUrl)
  await expect(page.getByText('Für diese Zuweisung sind noch keine Trainingstage terminiert.')).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  // ---- 2: Create dialog ----
  await page.getByRole('button', { name: 'Trainingstag planen' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoSeriousAxeViolations(page)
  const dialog = page.getByRole('dialog')
  const dayValue = await dialog.getByLabel('Trainingstag', { exact: true }).locator('option', { hasText: 'A11y Day' }).getAttribute('value')
  await dialog.getByLabel('Trainingstag', { exact: true }).selectOption(dayValue)
  await dialog.getByLabel('Startdatum', { exact: true }).fill(new Date().toISOString().slice(0, 10))
  await dialog.getByRole('button', { name: 'Regel erstellen' }).click()
  await expect(page.getByText('Die Terminierungsregel wurde erstellt.')).toBeVisible()
  await waitForToastsToSettle(page)

  // ---- 3: Filled rule list, desktop ----
  await expectNoSeriousAxeViolations(page)

  // ---- 4: Edit dialog, with the required pre-save warning ----
  await page.getByRole('button', { name: /Bearbeiten A11y Day/ }).click()
  const editDialog = page.getByRole('dialog')
  await expect(editDialog).toBeVisible()
  await expectNoSeriousAxeViolations(page)
  await editDialog.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(editDialog).toBeHidden()

  // ---- 5: Disable confirm dialog ----
  await page.getByRole('button', { name: /Deaktivieren A11y Day/ }).click()
  const disableDialog = page.getByRole('dialog')
  await expect(disableDialog.getByText('Diese Regel wird deaktiviert')).toBeVisible()
  await expectNoSeriousAxeViolations(page)
  await disableDialog.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(disableDialog).toBeHidden()

  // ---- 6: Mobile viewport, filled list ----
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoSeriousAxeViolations(page)
  const mobileDimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(mobileDimensions.documentWidth).toBeLessThanOrEqual(mobileDimensions.viewportWidth)

  // ---- 7: Desktop 1440 viewport, filled list, long member/program names wrap without overflow ----
  await page.setViewportSize({ width: 1440, height: 900 })
  await expectNoSeriousAxeViolations(page)
  const desktopDimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(desktopDimensions.documentWidth).toBeLessThanOrEqual(desktopDimensions.viewportWidth)
})
