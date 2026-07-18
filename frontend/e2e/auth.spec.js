import { expect, test } from '@playwright/test'
import { userFixture } from './helpers.js'

test('Registrierung, geschützte Weiterleitung und Login funktionieren im Browser', async ({ page }) => {
  const user = userFixture('auth')

  await page.goto('/workouts')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fworkouts|\/login\?redirect=\/workouts/)

  await page.goto('/register')
  await page.getByLabel('Benutzername').fill(user.username)
  await page.getByLabel('E-Mail').fill(user.email)
  await page.getByLabel('Passwort').fill(user.password)
  await page.getByRole('button', { name: 'Registrieren' }).click()
  await expect(page.getByRole('status')).toContainText('Registrierung erfolgreich')
  await expect(page).toHaveURL(/\/login$/, { timeout: 5_000 })

  await page.goto('/workouts')
  await page.getByLabel('E-Mail').fill(user.email)
  await page.getByLabel('Passwort').fill(user.password)
  await page.getByRole('button', { name: 'Login' }).click()

  await expect(page).toHaveURL(/\/workouts$/)
  await expect(page.getByRole('heading', { name: 'Deine Trainingspläne' })).toBeVisible()
})

test('Fehlerhafte Anmeldung ist angekündigt und verrät keine internen Details', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-Mail').fill('unknown@example.test')
  await page.getByLabel('Passwort').fill('definitely-wrong')
  await page.getByRole('button', { name: 'Login' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Login fehlgeschlagen')
  await expect(alert).not.toContainText(/SELECT|node_modules|stack/i)
})
