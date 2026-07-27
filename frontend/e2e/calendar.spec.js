import { expect, test } from '@playwright/test'
import { attachAuth, authenticate, loginApi, registerApi, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })

function isoDateOnly(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// Matches the backend's 0=Monday..6=Sunday convention (trainingCalendarDomain.js).
function backendWeekday(date) {
  return (date.getDay() + 6) % 7
}

// A date N days out may or may not fall within the currently displayed
// ~42-day month grid depending on what day-of-month "today" happens to be
// when the suite runs - rather than guessing a universally-safe offset,
// this navigates forward one month at a time (bounded) until the event is
// actually visible, keeping every scenario correct regardless of the date.
async function findEvent(page, pattern, { maxMonths = 2 } = {}) {
  const locator = page.getByRole('button', { name: pattern })
  for (let attempt = 0; attempt <= maxMonths; attempt += 1) {
    // A short, retried visibility wait (rather than an instantaneous
    // .count()) tolerates the normal async gap between submitting a
    // mutation and the reloaded calendar re-rendering - only treated as
    // "not in this month" once that window genuinely elapses.
    const appeared = await locator.first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)
    if (appeared) return locator
    await page.getByRole('button', { name: 'Nächster Monat' }).click()
  }
  return locator
}

async function registerAndLogin(request, user) {
  await registerApi(request, user)
  return loginApi(request, user)
}

// ---- Studio fixture setup (inline API calls, mirrors workoutSessions.spec.js's
// own convention rather than a shared helper module - see Stage 5A2 analysis). ----
async function setupStudioWithSchedule(request, { idPrefix, weekday, activeFrom }) {
  const owner = userFixture(`${idPrefix}-owner`)
  const member = userFixture(`${idPrefix}-member`)
  const ownerAuth = await registerAndLogin(request, owner)
  await registerApi(request, member)

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: {
      name: `${idPrefix} Studio`, slug: `${idPrefix}-${owner.username}`,
      defaultLocale: 'de', defaultTimezone: 'Europe/Zurich', defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  const invitationResponse = await request.post(`/api/v1/studios/${studio.id}/invitations`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { email: member.email, role: 'member' },
  })
  expect(invitationResponse.status()).toBe(201)
  const acceptUrl = (await invitationResponse.json()).delivery.acceptUrl
  const token = decodeURIComponent(new URL(acceptUrl).pathname.split('/').pop())
  const memberAuth = await loginApi(request, member)
  const acceptResponse = await request.post(`/api/v1/invitations/${token}/accept`, {
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  })
  expect(acceptResponse.status()).toBe(200)

  const membershipsResponse = await request.get(`/api/v1/studios/${studio.id}/memberships?limit=50`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })
  const memberships = (await membershipsResponse.json()).memberships
  const ownerMembership = memberships.find((m) => m.user.username === owner.username)
  const memberMembership = memberships.find((m) => m.user.username === member.username)

  const relationshipResponse = await request.post(`/api/v1/studios/${studio.id}/coaching-relationships`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { coachMembershipId: ownerMembership.id, memberMembershipId: memberMembership.id },
  })
  expect(relationshipResponse.status()).toBe(201)
  const relationship = (await relationshipResponse.json()).coachingRelationship

  const programResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: `${idPrefix} Programm` },
  })
  expect(programResponse.status()).toBe(201)
  const program = (await programResponse.json()).trainingProgram

  const versionResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs/${program.id}/versions`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: {},
  })
  expect(versionResponse.status()).toBe(201)
  const version = (await versionResponse.json()).programVersion

  const dayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'Push Day' } }
  )
  expect(dayResponse.status()).toBe(201)
  const day = (await dayResponse.json()).programDay

  await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days/${day.id}/exercises`,
    {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
      data: { exerciseNameSnapshot: 'Bankdrücken', targetSets: 1, targetRepsMin: 5, targetRepsMax: 5 },
    }
  )

  const publishResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/publish`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` } }
  )
  expect(publishResponse.status()).toBe(200)

  const assignmentResponse = await request.post(`/api/v1/studios/${studio.id}/program-assignments`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { programVersionId: version.id, memberMembershipId: memberMembership.id, coachingRelationshipId: relationship.id },
  })
  expect(assignmentResponse.status()).toBe(201)
  const assignment = (await assignmentResponse.json()).programAssignment

  // activeUntil pinned to the same day as activeFrom so the rule produces
  // exactly one occurrence within any grid range - without it, a plain
  // weekly-recurring rule would also materialize the same weekday one (or
  // more) weeks later within a 42-day month grid, making "the" event
  // ambiguous for assertions that expect a single match.
  const ruleResponse = await request.post(
    `/api/v1/studios/${studio.id}/program-assignments/${assignment.id}/schedule-rules`,
    {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
      data: { programDayId: day.id, weekday, anchorDate: activeFrom, activeFrom, activeUntil: activeFrom },
    }
  )
  expect(ruleResponse.status()).toBe(201)

  return { owner, member, ownerAuth, memberAuth, studio, program, day, assignment }
}

test('Persönlicher Ablauf: erstellen, verschieben, bestätigen, verknüpftes Workout öffnen', async ({ page, request }) => {
  test.setTimeout(120_000)
  const member = userFixture('cal-personal')
  const auth = await authenticate(page, request, member)
  await page.goto('/calendar')
  await expect(page.getByRole('heading', { name: 'Trainingskalender' })).toBeVisible()

  const future = addDays(new Date(), 5)
  const futureStr = isoDateOnly(future)

  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await page.getByLabel('Titel').fill('Push Day E2E')
  await page.getByLabel('Datum').fill(futureStr)
  await page.getByRole('button', { name: 'Speichern' }).click()

  const eventButton = await findEvent(page, /Push Day E2E/)
  await expect(eventButton).toBeVisible()
  await expect(eventButton).toHaveClass(/calendar-event-info/)

  // ---- Reschedule ----
  await eventButton.click()
  await page.getByRole('button', { name: 'Verschieben' }).click()
  const rescheduled = addDays(future, 2)
  const rescheduledStr = isoDateOnly(rescheduled)
  await page.getByRole('dialog').locator('input[type="date"]').fill(rescheduledStr)
  // handleRescheduleSubmit shows the success toast synchronously and only
  // *then* awaits the calendar refetch (CalendarView.vue) - a perfectly
  // reasonable "optimistic toast, background resync" order, but it means
  // the toast becoming visible is not proof the grid already reflects the
  // new date. The rescheduled date here deliberately lands outside the
  // currently loaded month range (it moves the entry into the next
  // calendar month's grid), so the *correct* eventual state is for this
  // exact button to disappear from the current view entirely. Racing
  // ahead to findEvent() on the toast alone can grab the still-mounted,
  // about-to-be-removed pre-reschedule button, click it, and then lose it
  // mid-click when the real refetch lands - hanging forever, since a bare
  // click() (unlike findEvent()'s own bounded month-navigation retry)
  // never tries the next month. Waiting for the actual refetch response
  // - the real signal the grid is about to update - closes that race
  // without a blind timeout, an extra retry, or a weakened assertion.
  const refetchAfterReschedule = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().includes('/api/v1/training-calendar?') &&
    response.ok()
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Verschieben' }).click()
  await refetchAfterReschedule
  await expect(page.getByText('Training wurde verschoben.')).toBeVisible()

  // ---- Confirm as completed ----
  await (await findEvent(page, /Push Day E2E/)).click()
  await page.getByRole('button', { name: 'Als abgeschlossen bestätigen' }).click()
  await expect(page.getByRole('dialog').getByText('wird als abgeschlossen markiert')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Training wurde als abgeschlossen markiert.')).toBeVisible()

  const completedButton = await findEvent(page, /Push Day E2E/)
  await expect(completedButton).toHaveClass(/calendar-event-success/)

  // ---- Open the linked workout ----
  await completedButton.click()
  await page.getByRole('button', { name: 'Workout öffnen' }).click()
  await expect(page).toHaveURL(/\/workouts$/)
  await expect(page.getByText('Push Day E2E')).toBeVisible()

  void auth
})

test('Heute: Standard abgeschlossen, planAsUpcoming ergibt "Heute fällig"', async ({ page, request }) => {
  const member = userFixture('cal-today')
  await authenticate(page, request, member)
  await page.goto('/calendar')

  const todayStr = isoDateOnly(new Date())

  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await page.getByLabel('Titel').fill('Heute Default')
  await page.getByLabel('Datum').fill(todayStr)
  await page.getByRole('button', { name: 'Speichern' }).click()
  const defaultButton = page.getByRole('button', { name: /Heute Default/ })
  await expect(defaultButton).toHaveClass(/calendar-event-success/)

  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await page.getByLabel('Titel').fill('Heute Geplant')
  await page.getByLabel('Datum').fill(todayStr)
  await page.getByLabel('Als geplantes Training speichern').check()
  await page.getByRole('button', { name: 'Speichern' }).click()
  const upcomingButton = page.getByRole('button', { name: /Heute Geplant/ })
  await expect(upcomingButton).toHaveClass(/calendar-event-due-today/)
  await expect(upcomingButton).toContainText('Heute fällig')
})

test('Vergangenheit: wird als abgeschlossen gespeichert', async ({ page, request }) => {
  const member = userFixture('cal-past')
  await authenticate(page, request, member)
  await page.goto('/calendar')

  const past = addDays(new Date(), -3)
  const pastCrossesMonth = past.getMonth() !== new Date().getMonth()
  const pastStr = isoDateOnly(past)

  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await page.getByLabel('Titel').fill('Vergangenes Training')
  await page.getByLabel('Datum').fill(pastStr)
  await expect(page.getByText('liegt in der Vergangenheit')).toBeVisible()
  await page.getByRole('button', { name: 'Speichern' }).click()

  if (pastCrossesMonth) {
    await page.getByRole('button', { name: 'Vorheriger Monat' }).click()
  }
  const pastButton = page.getByRole('button', { name: /Vergangenes Training/ })
  await expect(pastButton).toHaveClass(/calendar-event-success/)
})

test('Studio-Workout: erscheint im Kalender, wird gestartet, im Ausführungsbildschirm abgeschlossen, kehrt als abgeschlossen zurück, kein doppelter persönlicher Eintrag', async ({ page, request }) => {
  test.setTimeout(180_000)
  const today = new Date()
  const fixture = await setupStudioWithSchedule(request, {
    idPrefix: 'cal-studio', weekday: backendWeekday(today), activeFrom: isoDateOnly(today),
  })

  await attachAuth(page, fixture.memberAuth)
  await page.goto('/calendar')

  const studioEvent = page.getByRole('button', { name: /Push Day/ })
  await expect(studioEvent).toBeVisible()
  await studioEvent.click()
  await expect(page.getByRole('dialog').getByText(fixture.studio.name)).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Push Day' })).toBeVisible()

  await page.getByRole('button', { name: 'Training starten' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${fixture.studio.id}/workout-sessions/[0-9a-f-]+$`))

  // ---- Complete the workout via the existing, unchanged session execution UI ----
  const setRow = page.locator('.set-row').first()
  await setRow.getByLabel('Wdh.').fill('5')
  await setRow.getByLabel('Wdh.').blur()
  await setRow.getByRole('button', { name: 'Als erledigt markieren' }).click()
  await page.getByRole('button', { name: 'Übung abschließen' }).click()
  await page.getByRole('button', { name: 'Session abschließen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Session abschließen' }).click()
  await expect(page.getByText('Diese Session ist abgeschlossen und schreibgeschützt.')).toBeVisible()

  // ---- Return to the calendar: the occurrence is COMPLETED, no manual confirmation needed ----
  await page.goto('/calendar')
  const completedStudioEvent = page.getByRole('button', { name: /Push Day/ })
  await expect(completedStudioEvent).toHaveClass(/calendar-event-success/)

  // ---- No duplicate personal workout entry was created for this studio session ----
  const personalTab = page.getByRole('tab', { name: 'Persönlich' })
  await personalTab.click()
  await expect(page.getByText('Für diesen Zeitraum sind keine Trainings geplant.').or(page.getByText('Keine Ereignisse für die gewählten Filter.'))).toBeVisible()
})

test('Überspringen und Absagen führen zu unterschiedlichen roten Zuständen', async ({ page, request }) => {
  const member = userFixture('cal-skipcancel')
  await authenticate(page, request, member)
  await page.goto('/calendar')

  const dateA = isoDateOnly(addDays(new Date(), 10))
  const dateB = isoDateOnly(addDays(new Date(), 11))

  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await page.getByLabel('Titel').fill('Skip-Test-Training')
  await page.getByLabel('Datum').fill(dateA)
  await page.getByRole('button', { name: 'Speichern' }).click()

  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await page.getByLabel('Titel').fill('Cancel-Test-Training')
  await page.getByLabel('Datum').fill(dateB)
  await page.getByRole('button', { name: 'Speichern' }).click()

  await (await findEvent(page, /Skip-Test-Training/)).click()
  await page.getByRole('button', { name: 'Überspringen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Überspringen' }).click()
  const skipped = await findEvent(page, /Skip-Test-Training/)
  await expect(skipped).toHaveClass(/calendar-event-danger/)
  await expect(skipped).toContainText('Übersprungen')

  await (await findEvent(page, /Cancel-Test-Training/)).click()
  await page.getByRole('button', { name: 'Absagen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Absagen' }).click()
  const cancelled = await findEvent(page, /Cancel-Test-Training/)
  await expect(cancelled).toHaveClass(/calendar-event-danger/)
  await expect(cancelled).toContainText('Abgesagt')

  // Distinct wording despite the shared color family.
  await expect(skipped).not.toHaveText(await cancelled.textContent())
})

test('Overdue: ein vergangenes, unbestätigtes Coach-Event bleibt PLANNED und erscheint als "Noch zu bestätigen"', async ({ page, request }) => {
  test.setTimeout(120_000)
  const overdue = addDays(new Date(), -1)
  const overdueCrossesMonth = overdue.getMonth() !== new Date().getMonth()
  const fixture = await setupStudioWithSchedule(request, {
    idPrefix: 'cal-overdue', weekday: backendWeekday(overdue), activeFrom: isoDateOnly(overdue),
  })

  await attachAuth(page, fixture.memberAuth)
  await page.goto('/calendar')
  if (overdueCrossesMonth) {
    await page.getByRole('button', { name: 'Vorheriger Monat' }).click()
  }

  const overdueEvent = page.getByRole('button', { name: /Push Day/ })
  await expect(overdueEvent).toBeVisible()
  await expect(overdueEvent).toHaveClass(/calendar-event-warning/)
  await expect(overdueEvent).toContainText('Noch zu bestätigen')
  await expect(overdueEvent).not.toContainText('Abgeschlossen')
})

test('Filter: Quelle und Status filtern die sichtbaren Ereignisse client-seitig', async ({ page, request }) => {
  test.setTimeout(120_000)
  const today = new Date()
  const fixture = await setupStudioWithSchedule(request, {
    idPrefix: 'cal-filter', weekday: backendWeekday(today), activeFrom: isoDateOnly(today),
  })
  await attachAuth(page, fixture.memberAuth)
  await page.goto('/calendar')

  await page.getByRole('button', { name: 'Training eintragen' }).click()
  await page.getByLabel('Titel').fill('Eigenes Training')
  await page.getByLabel('Datum').fill(isoDateOnly(addDays(today, 1)))
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(page.getByRole('button', { name: /Push Day/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Eigenes Training/ })).toBeVisible()

  await page.getByRole('tab', { name: 'Persönlich' }).click()
  await expect(page.getByRole('button', { name: /Eigenes Training/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Push Day/ })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Studio' }).click()
  await expect(page.getByRole('button', { name: /Push Day/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Eigenes Training/ })).toHaveCount(0)

  // The studio occurrence is scheduled for today, so its displayStatus is
  // DUE_TODAY (not PLANNED - see deriveDisplayStatus), matching the actual
  // product rule under test rather than an arbitrary assumption.
  await page.getByRole('tab', { name: 'Alle' }).click()
  await page.getByLabel('Status').selectOption('DUE_TODAY')
  await expect(page.getByRole('button', { name: /Push Day/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Eigenes Training/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click()
  await expect(page.getByRole('button', { name: /Push Day/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Eigenes Training/ })).toBeVisible()
})
