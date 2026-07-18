import { expect, test } from '@playwright/test'
import {
  authenticate,
  chooseExercise,
  loginApi,
  registerApi,
  userFixture,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

test('Workout CRUD, kg/lb, Progress-Herkunft, Unveränderlichkeit und 1RM', async ({ page, request }) => {
  const user = userFixture('training')
  await authenticate(page, request, user)
  await page.goto('/workouts')

  await page.getByRole('button', { name: 'Workout erstellen' }).click()
  const workoutForm = page.locator('.workout-form')
  await workoutForm.getByLabel('Titel').fill('Stage 0B Kraft')
  await workoutForm.getByLabel('Datum').fill('2026-07-18')
  await workoutForm.getByLabel('Notizen').fill('Browser-Pilotnachweis')
  const exerciseTrigger = workoutForm.getByRole('button', { name: 'Übung auswählen' })
  await exerciseTrigger.click()
  await chooseExercise(page)
  await workoutForm.getByLabel('Sätze').fill('3')
  await workoutForm.getByLabel('Wdh.').fill('8')
  await workoutForm.getByLabel('Gewicht').fill('50')
  await workoutForm.getByRole('button', { name: 'Workout speichern' }).click()

  let card = page.getByRole('article').filter({ hasText: 'Stage 0B Kraft' })
  await expect(card).toContainText(/50[,.]0 kg/)

  const unitToggle = page.getByRole('button', { name: /Gewichtseinheit:/ })
  await unitToggle.click()
  await expect(unitToggle).toContainText('LB')
  await expect(card).toContainText(/110[,.]2 lb/)
  await unitToggle.click()
  await expect(unitToggle).toContainText('KG')

  await card.getByRole('button', { name: 'Bearbeiten' }).click()
  await workoutForm.getByLabel('Titel').fill('Stage 0B Kraft aktualisiert')
  await workoutForm.getByLabel('Gewicht').fill('60')
  await workoutForm.getByRole('button', { name: 'Änderungen speichern' }).click()
  card = page.getByRole('article').filter({ hasText: 'Stage 0B Kraft aktualisiert' })
  await expect(card).toContainText(/60[,.]0 kg/)

  await page.getByRole('link', { name: 'Fortschritt' }).click()
  await expect(page.getByRole('heading', { name: 'Deine Entwicklung' })).toBeVisible()
  const derivedEntry = page.locator('.entry-card').filter({ hasText: 'Stage 0B Kraft aktualisiert' })
  await expect(derivedEntry).toContainText('Quelle: Stage 0B Kraft aktualisiert')
  await expect(derivedEntry.getByRole('button', { name: 'Löschen' })).toHaveCount(0)

  const progressForm = page.locator('.progress-form')
  const progressTrigger = progressForm.getByRole('button', { name: 'Übung auswählen' })
  await progressTrigger.click()
  await chooseExercise(page)
  await progressForm.getByLabel('Eintragsdatum').fill('2026-07-18')
  await progressForm.getByLabel('Sätze').fill('4')
  await progressForm.getByLabel('Wdh.').fill('6')
  await progressForm.getByLabel('Gewicht').fill('45')
  await progressForm.getByRole('button', { name: 'Eintrag speichern' }).click()

  const manualEntry = page.locator('.entry-card').filter({ hasText: 'Manueller Eintrag' }).first()
  await expect(manualEntry).toContainText('Quelle: Manueller Eintrag')
  const summary = page.locator('.summary-card').filter({ hasText: 'Bench Press' }).first()
  await expect(summary).toContainText('Geschätztes 1RM')
  await expect(summary).toContainText(/76(?:[,.]0)? kg/)

  page.once('dialog', (dialog) => dialog.accept())
  await manualEntry.getByRole('button', { name: 'Löschen' }).click()
  await expect(manualEntry).toBeHidden()

  await page.getByRole('link', { name: 'Workouts' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await card.getByRole('button', { name: 'Löschen' }).click()
  await expect(card).toBeHidden()
})

test('Zwei Browserkontexte sehen nur eigene Daten und fremde IDs bleiben verborgen', async ({ browser }) => {
  const contextA = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const contextB = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const userA = userFixture('isolation-a')
    const userB = userFixture('isolation-b')
    await registerApi(contextA.request, userA)
    await registerApi(contextB.request, userB)
    const authA = await loginApi(contextA.request, userA)
    const authB = await loginApi(contextB.request, userB)

    const exercises = await contextA.request.get('/api/exercises', {
      headers: { Authorization: `Bearer ${authA.token}` },
    })
    const exercise = (await exercises.json()).find((item) => item.category !== 'Cardio')
    const created = await contextA.request.post('/api/workouts', {
      headers: { Authorization: `Bearer ${authA.token}` },
      data: {
        title: 'Nur Benutzer A',
        workout_date: '2026-07-18',
        exercises: [{ exercise_id: exercise.id, sets: 3, reps: 8, weight: 42 }],
      },
    })
    expect(created.status()).toBe(201)
    const workoutId = (await created.json()).workoutId

    const listB = await contextB.request.get('/api/workouts', {
      headers: { Authorization: `Bearer ${authB.token}` },
    })
    expect((await listB.json()).some((item) => item.id === workoutId)).toBe(false)
    const foreignDelete = await contextB.request.delete(`/api/workouts/${workoutId}`, {
      headers: { Authorization: `Bearer ${authB.token}` },
    })
    expect(foreignDelete.status()).toBe(404)

    const invalidSession = await contextB.request.get('/api/workouts', {
      headers: { Authorization: 'Bearer invalid-session-token' },
    })
    expect(invalidSession.status()).toBe(401)
    expect((await invalidSession.json()).error.code).toBe('AUTHENTICATION_REQUIRED')

    await contextA.addInitScript(({ token, user }) => {
      localStorage.setItem('fittrack_token', token)
      localStorage.setItem('fittrack_user', JSON.stringify(user))
    }, { token: authA.token, user: authA.user })
    await contextB.addInitScript(({ token, user }) => {
      localStorage.setItem('fittrack_token', token)
      localStorage.setItem('fittrack_user', JSON.stringify(user))
    }, { token: authB.token, user: authB.user })
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()
    await Promise.all([pageA.goto('/workouts'), pageB.goto('/workouts')])
    await expect(pageA.getByRole('heading', { name: 'Nur Benutzer A' })).toBeVisible()
    await expect(pageB.getByRole('heading', { name: 'Nur Benutzer A' })).toHaveCount(0)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
