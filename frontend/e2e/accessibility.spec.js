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
    `/studios/${studio.id}/access-denied`,
    `/invitations/${'a'.repeat(43)}`,
  ]) {
    await page.goto(route)
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
  await page.goto('/workouts')
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
      await page.goto(route)
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
