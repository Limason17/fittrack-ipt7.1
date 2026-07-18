import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'

export const E2E_PASSWORD = 'stage0b-browser-password-32-chars'

export function userFixture(id) {
  const runId = randomUUID().replaceAll('-', '').slice(0, 12)
  return {
    username: `stage0b-${id}-${runId}`,
    email: `stage0b-${id}-${runId}@example.test`,
    password: E2E_PASSWORD,
  }
}

export async function registerApi(request, user) {
  const response = await request.post('/api/users/register', {
    data: {
      username: user.username,
      email: user.email,
      password: user.password,
      language_preference: 'de',
      weight_unit: 'kg',
      distance_unit: 'km',
    },
  })
  expect(response.status()).toBe(201)
}

export async function loginApi(request, user) {
  const response = await request.post('/api/users/login', {
    data: { email: user.email, password: user.password },
  })
  expect(response.status()).toBe(200)
  return response.json()
}

export async function authenticate(page, request, user) {
  await registerApi(request, user)
  const auth = await loginApi(request, user)
  await attachAuth(page, auth)
  return auth
}

export async function attachAuth(page, auth) {
  await page.addInitScript(({ token, authUser }) => {
    localStorage.setItem('fittrack_token', token)
    localStorage.setItem('fittrack_user', JSON.stringify(authUser))
  }, { token: auth.token, authUser: auth.user })
}

export async function chooseExercise(page, name = 'Bench Press', { keyboard = false } = {}) {
  const dialog = page.getByRole('dialog', { name: 'Übung auswählen' })
  await expect(dialog).toBeVisible()
  const card = dialog.locator('.picker-card').filter({ hasText: name }).first()
  const selection = card.getByRole('button', { name: 'Übung auswählen' })
  if (keyboard) {
    await selection.focus()
    await page.keyboard.press('Enter')
  } else {
    await selection.click()
  }
  await expect(dialog).toBeHidden()
}
