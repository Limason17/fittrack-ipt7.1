import { expect, test } from '@playwright/test'
import { attachAuth, authenticate, loginApi, registerApi, userFixture } from './helpers.js'

test.describe.configure({ mode: 'serial' })

const DE_WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

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

async function registerAndLogin(request, user) {
  await registerApi(request, user)
  return loginApi(request, user)
}

async function inviteAndAccept(request, ownerAuth, studioId, role, user) {
  const invitationResponse = await request.post(`/api/v1/studios/${studioId}/invitations`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { email: user.email, role },
  })
  expect(invitationResponse.status()).toBe(201)
  const acceptUrl = (await invitationResponse.json()).delivery.acceptUrl
  const token = decodeURIComponent(new URL(acceptUrl).pathname.split('/').pop())
  const userAuth = await loginApi(request, user)
  const acceptResponse = await request.post(`/api/v1/invitations/${token}/accept`, {
    headers: { Authorization: `Bearer ${userAuth.token}` },
  })
  expect(acceptResponse.status()).toBe(200)
  return userAuth
}

test('Coach-zu-Member-Ablauf: drei Regeln setzen, bearbeiten, deaktivieren, Member-Kalender und Historie verifizieren', async ({ page, request, browser }) => {
  test.setTimeout(180_000)
  const owner = userFixture('sched-owner')
  const member = userFixture('sched-member')
  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, member)

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { name: `Schedule Studio ${owner.username}`, slug: `sched-${owner.username}`, defaultLocale: 'de', defaultTimezone: 'Europe/Zurich', defaultWeightUnit: 'kg' },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  const memberAuth = await inviteAndAccept(request, ownerAuth, studio.id, 'member', member)

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
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'Zeitplan Programm' },
  })
  expect(programResponse.status()).toBe(201)
  const program = (await programResponse.json()).trainingProgram

  const versionResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs/${program.id}/versions`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: {},
  })
  expect(versionResponse.status()).toBe(201)
  const version = (await versionResponse.json()).programVersion

  const pushDayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'Push Day' } }
  )
  expect(pushDayResponse.status()).toBe(201)
  const pushDay = (await pushDayResponse.json()).programDay
  await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days/${pushDay.id}/exercises`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { exerciseNameSnapshot: 'Bankdrücken', targetSets: 1, targetRepsMin: 5, targetRepsMax: 5 } }
  )

  const pullDayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'Pull Day' } }
  )
  expect(pullDayResponse.status()).toBe(201)
  const pullDay = (await pullDayResponse.json()).programDay
  await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days/${pullDay.id}/exercises`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { exerciseNameSnapshot: 'Klimmzug', targetSets: 1, targetRepsMin: 5, targetRepsMax: 5 } }
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

  const today = new Date()
  const todayStr = isoDateOnly(today)
  const weekdayToday = backendWeekday(today)
  const weekdayB = (weekdayToday + 1) % 7
  const weekdayC = (weekdayToday + 2) % 7

  // ---- 1: Owner opens the schedule view from the assignments list ----
  await page.goto(`/studios/${studio.id}/assignments`)
  await page.getByRole('link', { name: 'Zeitplan' }).click()
  await expect(page).toHaveURL(new RegExp(`/program-assignments/${assignment.id}/schedule$`))
  await expect(page.getByText(member.username)).toBeVisible()
  await expect(page.getByText('Zeitplan Programm')).toBeVisible()
  await expect(page.getByText('Version 1')).toBeVisible()
  await expect(page.getByText(
    'Geplante Trainingstage erscheinen automatisch im persönlichen Kalender des Members. Sie gelten erst nach Abschluss oder ausdrücklicher Bestätigung als abgeschlossen.'
  )).toBeVisible()
  await expect(page.getByText('Für diese Zuweisung sind noch keine Trainingstage terminiert.')).toBeVisible()

  // ---- 2: Create three rules across three distinct weekdays ----
  async function createRule({ dayLabel, weekday, repeatLabel }) {
    // While the rule list is still empty, both the header CTA and the
    // EmptyState's own action-slot button render the identical label -
    // either opens the same create dialog, so `.first()` is unambiguous.
    await page.getByRole('button', { name: 'Trainingstag planen' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const dayValue = await dialog.getByLabel('Trainingstag', { exact: true }).locator('option', { hasText: dayLabel }).getAttribute('value')
    await dialog.getByLabel('Trainingstag', { exact: true }).selectOption(dayValue)
    await dialog.getByLabel('Wochentag', { exact: true }).selectOption({ label: DE_WEEKDAYS[weekday] })
    await dialog.getByLabel('Startdatum', { exact: true }).fill(todayStr)
    if (dayLabel === 'Push Day' && weekday === weekdayToday) {
      await dialog.getByLabel('Enddatum (optional)', { exact: true }).fill(todayStr)
    }
    if (repeatLabel) {
      await dialog.getByLabel('Wiederholung', { exact: true }).selectOption({ label: repeatLabel })
    }
    await dialog.getByRole('button', { name: 'Regel erstellen' }).click()
    // Toasts stack and auto-dismiss after several seconds - across three
    // rapid rule creations, an earlier toast may still be visible, so this
    // asserts on the most recent one rather than assuming there is only one.
    await expect(page.getByText('Die Terminierungsregel wurde erstellt.').last()).toBeVisible()
  }

  await createRule({ dayLabel: 'Push Day', weekday: weekdayToday })
  await createRule({ dayLabel: 'Pull Day', weekday: weekdayB })
  await createRule({ dayLabel: 'Push Day', weekday: weekdayC, repeatLabel: 'Alle 2 Wochen' })

  // Two rules share the "Push Day" program day on different weekdays, so
  // every accessible action name must include the weekday too (see
  // ScheduleRulesView.vue's aria-label) - otherwise "Bearbeiten Push Day"
  // would be ambiguous between them.
  const editPushToday = page.getByRole('button', { name: `Bearbeiten Push Day (${DE_WEEKDAYS[weekdayToday]})` })
  const editPushC = page.getByRole('button', { name: `Bearbeiten Push Day (${DE_WEEKDAYS[weekdayC]})` })
  const editPull = page.getByRole('button', { name: `Bearbeiten Pull Day (${DE_WEEKDAYS[weekdayB]})` })
  await expect(editPushToday).toBeVisible()
  await expect(editPushC).toBeVisible()
  await expect(editPull).toBeVisible()
  await expect(page.getByText('Alle 2 Wochen am')).toBeVisible()

  // ---- 3: Edit the Pull Day rule; the required pre-save warning must show ----
  await editPull.click()
  const editDialog = page.getByRole('dialog')
  await expect(editDialog).toBeVisible()
  await expect(page.getByText(
    'Änderungen betreffen zukünftige geplante Trainings. Bereits abgeschlossene Trainings bleiben unverändert.'
  )).toBeVisible()
  await expect(editDialog.locator('#rule-program-day')).toHaveCount(0)
  await editDialog.getByLabel('Wiederholung', { exact: true }).selectOption({ label: 'Alle 2 Wochen' })
  await editDialog.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Die Änderungen wurden gespeichert.')).toBeVisible()

  // ---- 4: Disable the third rule (Push Day / weekdayC); it stays visible, marked distinctly ----
  const disablePushC = page.getByRole('button', { name: `Deaktivieren Push Day (${DE_WEEKDAYS[weekdayC]})` })
  await disablePushC.click()
  await expect(page.getByRole('dialog').getByText(
    'Diese Regel wird deaktiviert. Bereits abgeschlossene Trainings bleiben erhalten. Zukünftige, noch nicht materialisierte Termine werden nicht mehr aus dieser Regel erzeugt.'
  )).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Regel deaktivieren' }).click()
  await expect(page.getByText('Die Regel wurde deaktiviert.')).toBeVisible()
  await expect(page.locator('.badge-neutral').getByText('Deaktiviert', { exact: true })).toBeVisible()
  await expect(disablePushC).toHaveCount(0)
  // The still-active Push Day rule (weekdayToday) keeps its disable action.
  await expect(page.getByRole('button', { name: `Deaktivieren Push Day (${DE_WEEKDAYS[weekdayToday]})` })).toBeVisible()

  // ---- 5: The member's personal calendar auto-materializes today's Push Day occurrence ----
  const memberContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const memberPage = await memberContext.newPage()
    await attachAuth(memberPage, memberAuth)
    await memberPage.goto('/calendar')

    const pushEvent = memberPage.getByRole('button', { name: /Push Day/ })
    await expect(pushEvent).toBeVisible()
    await expect(pushEvent).toHaveClass(/calendar-event-due-today/)
    await expect(pushEvent).toContainText('Heute fällig')

    // ---- 6: Start and complete the workout from the calendar ----
    await pushEvent.click()
    await memberPage.getByRole('button', { name: 'Training starten' }).click()
    await expect(memberPage).toHaveURL(new RegExp(`/studios/${studio.id}/workout-sessions/[0-9a-f-]+$`))
    const setRow = memberPage.locator('.set-row').first()
    await setRow.getByLabel('Wdh.').fill('5')
    await setRow.getByLabel('Wdh.').blur()
    await setRow.getByRole('button', { name: 'Als erledigt markieren' }).click()
    await memberPage.getByRole('button', { name: 'Übung abschließen' }).click()
    await memberPage.getByRole('button', { name: 'Session abschließen' }).click()
    await memberPage.getByRole('dialog').getByRole('button', { name: 'Session abschließen' }).click()
    await expect(memberPage.getByText('Diese Session ist abgeschlossen und schreibgeschützt.')).toBeVisible()

    await memberPage.goto('/calendar')
    const completedEvent = memberPage.getByRole('button', { name: /Push Day/ })
    await expect(completedEvent).toHaveClass(/calendar-event-success/)

    const personalTab = memberPage.getByRole('tab', { name: 'Persönlich' })
    await personalTab.click()
    await expect(memberPage.getByText('Für diesen Zeitraum sind keine Trainings geplant.').or(
      memberPage.getByText('Keine Ereignisse für die gewählten Filter.')
    )).toBeVisible()

    // ---- 7: History immutability - editing the rule's weekday later does not
    // alter the already-completed historical occurrence ----
    await page.goto(`/studios/${studio.id}/program-assignments/${assignment.id}/schedule`)
    const futureWeekday = (weekdayToday + 3) % 7
    await page.getByRole('button', { name: `Bearbeiten Push Day (${DE_WEEKDAYS[weekdayToday]})` }).click()
    const historyEditDialog = page.getByRole('dialog')
    await expect(historyEditDialog).toBeVisible()
    await historyEditDialog.getByLabel('Wochentag', { exact: true }).selectOption({ label: DE_WEEKDAYS[futureWeekday] })
    await historyEditDialog.getByRole('button', { name: 'Änderungen speichern' }).click()
    await expect(page.getByText('Die Änderungen wurden gespeichert.')).toBeVisible()

    await memberPage.goto('/calendar')
    const stillCompletedEvent = memberPage.getByRole('button', { name: /Push Day/ })
    await expect(stillCompletedEvent).toHaveClass(/calendar-event-success/)
    await expect(stillCompletedEvent).not.toHaveClass(/calendar-event-due-today/)
  } finally {
    await memberContext.close()
  }
})

test('Rollen und Berechtigungen: Trainer nur innerhalb eigener Coaching-Beziehung, Member ohne Verwaltungs-UI', async ({ page, request, browser }) => {
  test.setTimeout(120_000)
  const owner = userFixture('sched-rbac-owner')
  const trainerA = userFixture('sched-rbac-trainer-a')
  const trainerB = userFixture('sched-rbac-trainer-b')
  const member = userFixture('sched-rbac-member')
  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, trainerA)
  await registerApi(request, trainerB)
  await registerApi(request, member)

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { name: `RBAC Studio ${owner.username}`, slug: `sched-rbac-${owner.username}`, defaultLocale: 'de', defaultTimezone: 'Europe/Zurich', defaultWeightUnit: 'kg' },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  const trainerAAuth = await inviteAndAccept(request, ownerAuth, studio.id, 'trainer', trainerA)
  await inviteAndAccept(request, ownerAuth, studio.id, 'trainer', trainerB)
  await inviteAndAccept(request, ownerAuth, studio.id, 'member', member)

  const memberships = (await (await request.get(`/api/v1/studios/${studio.id}/memberships?limit=50`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })).json()).memberships
  const trainerAMembership = memberships.find((m) => m.user.username === trainerA.username)
  const memberMembership = memberships.find((m) => m.user.username === member.username)

  const relationshipResponse = await request.post(`/api/v1/studios/${studio.id}/coaching-relationships`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { coachMembershipId: trainerAMembership.id, memberMembershipId: memberMembership.id },
  })
  expect(relationshipResponse.status()).toBe(201)
  const relationship = (await relationshipResponse.json()).coachingRelationship

  const programResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'RBAC Programm' },
  })
  const program = (await programResponse.json()).trainingProgram
  const versionResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs/${program.id}/versions`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: {},
  })
  const version = (await versionResponse.json()).programVersion
  const dayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'RBAC Day' } }
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

  // ---- Trainer A (own coaching relationship): full access, can create a rule ----
  const trainerAContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const trainerBContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const memberContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const trainerAPage = await trainerAContext.newPage()
    await attachAuth(trainerAPage, trainerAAuth)
    await trainerAPage.goto(scheduleUrl)
    await expect(trainerAPage.getByText(member.username)).toBeVisible()
    await trainerAPage.getByRole('button', { name: 'Trainingstag planen' }).first().click()
    const trainerADialog = trainerAPage.getByRole('dialog')
    await expect(trainerADialog).toBeVisible()
    const rbacDayValue = await trainerADialog.getByLabel('Trainingstag', { exact: true }).locator('option', { hasText: day.name }).getAttribute('value')
    await trainerADialog.getByLabel('Trainingstag', { exact: true }).selectOption(rbacDayValue)
    await trainerADialog.getByLabel('Startdatum', { exact: true }).fill(isoDateOnly(new Date()))
    await trainerADialog.getByRole('button', { name: 'Regel erstellen' }).click()
    await expect(trainerAPage.getByText('Die Terminierungsregel wurde erstellt.')).toBeVisible()

    // ---- Trainer B (no coaching relationship to this member): manipulated-ID
    // direct navigation must show "not found", never the real assignment data ----
    const trainerBAuth = await loginApi(request, trainerB)
    const trainerBPage = await trainerBContext.newPage()
    await attachAuth(trainerBPage, trainerBAuth)
    await trainerBPage.goto(scheduleUrl)
    await expect(trainerBPage.getByText('Diese Zuweisung wurde nicht gefunden.')).toBeVisible()
    await expect(trainerBPage.getByText(member.username)).toHaveCount(0)

    // The trainer-scoped assignments list also never lists this assignment for Trainer B.
    await trainerBPage.goto(`/studios/${studio.id}/assignments`)
    await expect(trainerBPage.getByText(member.username)).toHaveCount(0)

    // ---- Member: no management UI at all, direct navigation redirects to access-denied ----
    const memberAuth = await loginApi(request, member)
    const memberPage = await memberContext.newPage()
    await attachAuth(memberPage, memberAuth)
    await memberPage.goto(scheduleUrl)
    await expect(memberPage).toHaveURL(new RegExp(`/studios/${studio.id}/access-denied$`))
  } finally {
    await trainerAContext.close()
    await trainerBContext.close()
    await memberContext.close()
  }
})
