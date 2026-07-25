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

test('Kernseiten haben keine schweren oder kritischen Axe-Verstöße', async ({ page, request }) => {
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
    // Stage 3B2: the access token is memory-only, so every one of these
    // hard reloads triggers its own silent-refresh bootstrap. The default
    // 'load' wait resolves before that bootstrap's own fetch necessarily
    // completes, which - across this many back-to-back reloads - can race
    // the previous reload's still-in-flight refresh (single-use rotation,
    // see services/sessionService.js) and spuriously invalidate the
    // session. Waiting for network idle keeps each reload's bootstrap fully
    // settled before the next one starts, so this loop exercises real
    // sequential page loads rather than an artificial rapid-fire-reload
    // race no normal user would trigger.
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
    for (const route of ['/workouts', '/progress']) {
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
