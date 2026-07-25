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

async function expectNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(dimensions.documentWidth, label).toBeLessThanOrEqual(dimensions.viewportWidth)
}

// Stage 3C, Section 11: the Stage 3A audit only verified the admin role by
// reading code/permission tables. This walkthrough exercises the exact same
// 20-step admin journey end-to-end through the real UI, as the admin
// account, against the real local backend - not code inspection.
test('Stage 3C Section 11: vollständiger realer Admin-Durchlauf (Owner->Admin->Mitgliederverwaltung->Coaching->Programm->Ergebnisse->Audit->Isolation->Mobile)', async ({ page, request, browser }) => {
  test.setTimeout(360_000)

  const owner = userFixture('adminwalk-owner')
  const admin = userFixture('adminwalk-admin')
  const trainer = userFixture('adminwalk-trainer')
  const member = userFixture('adminwalk-member')
  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, admin)
  await registerApi(request, trainer)
  await registerApi(request, member)

  // 1: Owner creates the studio.
  await page.goto('/studios/new')
  await page.getByLabel('Name', { exact: true }).fill(`Admin Walkthrough ${owner.username}`)
  await page.getByLabel('Zeitzone').fill('Europe/Zurich')
  await page.getByRole('button', { name: 'Studio erstellen' }).click()
  await expect(page).toHaveURL(/\/studios\/[0-9a-f-]+$/)
  const studioId = page.url().split('/').at(-1)

  // 2: Owner invites the admin.
  await page.goto(`/studios/${studioId}/invitations`)
  await page.getByLabel('E-Mail-Adresse').fill(admin.email)
  await page.getByLabel('Rolle').selectOption('admin')
  await page.getByRole('button', { name: 'Einladung erstellen' }).click()
  const adminAcceptUrl = await page.locator('.studio-delivery a').getAttribute('href')

  const adminContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  const memberContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    // 3: Admin accepts the invitation.
    const adminAuth = await loginApi(adminContext.request, admin)
    const adminPage = await adminContext.newPage()
    await attachAuth(adminPage, adminAuth)
    await adminPage.goto(adminAcceptUrl)
    await adminPage.getByRole('button', { name: 'Einladung annehmen' }).click()
    await expect(adminPage).toHaveURL(new RegExp(`/studios/${studioId}$`))
    await expect(adminPage.locator('.page-header-badge .badge')).toHaveText('Administration')

    // 4: Admin logs in (already authenticated above) and opens the member list.
    await adminPage.goto(`/studios/${studioId}/members`)
    const membersTable = adminPage.locator('tbody')
    await expect(membersTable.getByText(owner.username, { exact: true })).toBeVisible()
    await expect(membersTable.getByText(admin.username, { exact: true })).toBeVisible()

    // 5: Admin invites a trainer.
    await adminPage.goto(`/studios/${studioId}/invitations`)
    await adminPage.getByLabel('E-Mail-Adresse').fill(trainer.email)
    await adminPage.getByLabel('Rolle').selectOption('trainer')
    await adminPage.getByRole('button', { name: 'Einladung erstellen' }).click()
    const trainerAcceptUrl = await adminPage.locator('.studio-delivery a').getAttribute('href')

    // 6: Admin invites a member.
    await adminPage.goto(`/studios/${studioId}/invitations`)
    await adminPage.getByLabel('E-Mail-Adresse').fill(member.email)
    await adminPage.getByLabel('Rolle').selectOption('member')
    await adminPage.getByRole('button', { name: 'Einladung erstellen' }).click()
    const memberAcceptUrl = await adminPage.locator('.studio-delivery a').getAttribute('href')

    // 7: Admin resends the member invitation before it is accepted.
    const memberRow = adminPage.locator('tbody tr').filter({ hasText: member.email })
    await memberRow.getByRole('button', { name: 'Erneut senden' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Erneut senden' }).click()
    await expect(adminPage.getByText('Die Einladung wurde erneut gesendet.').first()).toBeVisible()
    const resentMemberAcceptUrl = await adminPage.locator('.studio-delivery a').getAttribute('href')
    expect(resentMemberAcceptUrl).not.toBe(memberAcceptUrl)

    // 8: Admin invites and then revokes a throwaway invitation.
    const toRevoke = userFixture('adminwalk-torevoke')
    await adminPage.goto(`/studios/${studioId}/invitations`)
    await adminPage.getByLabel('E-Mail-Adresse').fill(toRevoke.email)
    await adminPage.getByLabel('Rolle').selectOption('member')
    await adminPage.getByRole('button', { name: 'Einladung erstellen' }).click()
    const toRevokeRow = adminPage.locator('tbody tr').filter({ hasText: toRevoke.email })
    await toRevokeRow.getByRole('button', { name: 'Widerrufen' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Widerrufen' }).click()
    await expect(adminPage.getByText('Die Einladung wurde widerrufen.')).toBeVisible()

    // Trainer and member accept via API - their own acceptance UI flow is
    // already covered end-to-end elsewhere (studios.spec.js,
    // invitationResend.spec.js); this walkthrough's focus is the admin's
    // own journey.
    const trainerAuth = await loginApi(request, trainer)
    await request.post(`/api/v1/invitations/${new URL(trainerAcceptUrl).pathname.split('/').pop()}/accept`, {
      headers: { Authorization: `Bearer ${trainerAuth.token}` },
    })
    const memberAuth = await loginApi(memberContext.request, member)
    const acceptResponse = await memberContext.request.post(
      `/api/v1/invitations/${new URL(resentMemberAcceptUrl).pathname.split('/').pop()}/accept`,
      { headers: { Authorization: `Bearer ${memberAuth.token}` } }
    )
    expect(acceptResponse.status()).toBe(200)

    const memberships = (await (await request.get(`/api/v1/studios/${studioId}/memberships?limit=50`, {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
    })).json()).memberships
    const memberMembershipId = memberships.find((m) => m.user.username === member.username).id

    // 9/10: Admin creates a coaching relationship with themselves as coach,
    // so the later results/feedback steps are legitimately reachable for admin
    // (the read-eligibility check requires the viewer's own active relationship).
    await adminPage.goto(`/studios/${studioId}/coaching`)
    await adminPage.getByLabel('Trainer:in').selectOption({ label: `${admin.username} · Administration` })
    await adminPage.getByLabel('Mitglied').selectOption({ label: member.username })
    await adminPage.getByRole('button', { name: 'Beziehung erstellen' }).click()
    await expect(adminPage.locator('.table tbody tr').filter({ hasText: member.username })).toBeVisible()

    // 11/12/13: Admin creates a program, a draft version, a day and an exercise (editing the draft).
    await adminPage.goto(`/studios/${studioId}/training-programs`)
    await adminPage.getByRole('button', { name: 'Programm erstellen' }).click()
    await adminPage.getByLabel('Name', { exact: true }).fill('Admin Grundprogramm')
    await adminPage.getByRole('button', { name: 'Programm erstellen' }).click()
    await adminPage.getByRole('link', { name: /Admin Grundprogramm/ }).click()
    await expect(adminPage).toHaveURL(/\/training-programs\/[0-9a-f-]+$/)

    await adminPage.getByRole('button', { name: 'Neue Entwurfsversion erstellen' }).click()
    await expect(adminPage.getByText('Version 1')).toBeVisible()
    await adminPage.getByLabel('Name des Trainingstags').fill('Tag 1: Ganzkörper')
    await adminPage.getByRole('button', { name: 'Trainingstag hinzufügen' }).click()
    await adminPage.getByRole('button', { name: 'Übung hinzufügen' }).click()
    await adminPage.getByLabel('Name der Übung').fill('Kreuzheben')
    // A single target set keeps the member's later API-driven completion in
    // this walkthrough simple (only one set to mark completed) - matching
    // the same convention already used by coachFeedback.spec.js's fixture.
    await adminPage.getByLabel('Ziel-Sätze').fill('1')
    await adminPage.getByLabel('Wdh. min.').fill('5')
    await adminPage.getByLabel('Wdh. max.').fill('5')
    await adminPage.getByRole('button', { name: 'Übung hinzufügen' }).click()
    await expect(adminPage.getByText('Kreuzheben')).toBeVisible()

    // 14: Admin publishes the version.
    await adminPage.getByRole('button', { name: 'Version veröffentlichen' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Version veröffentlichen' }).click()
    await expect(adminPage.getByText('Diese Version ist veröffentlicht und daher unveränderlich.')).toBeVisible()

    // 15: Admin assigns the version to the member through their own relationship.
    await adminPage.goto(`/studios/${studioId}/assignments`)
    await adminPage.getByRole('button', { name: 'Zuweisung erstellen' }).click()
    await adminPage.getByLabel('Mitglied wählen').selectOption({ label: member.username })
    await adminPage.getByLabel('Programm wählen').selectOption({ label: 'Admin Grundprogramm' })
    await adminPage.getByLabel('Version wählen').selectOption({ label: 'Version 1' })
    await adminPage.getByLabel('Coaching-Beziehung wählen').selectOption({ label: admin.username })
    await adminPage.getByRole('button', { name: 'Zuweisung erstellen' }).click()
    await expect(adminPage.getByText(member.username)).toBeVisible()

    // The member completes their assigned workout via API (their own UI flow
    // is covered by workoutSessions.spec.js) so admin has a real result to view.
    const ownAssignmentsResponse = await memberContext.request.get(`/api/v1/studios/${studioId}/program-assignments/me`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    })
    const ownAssignment = (await ownAssignmentsResponse.json()).programAssignments[0]
    const assignmentDetailResponse = await memberContext.request.get(
      `/api/v1/studios/${studioId}/program-assignments/me/${ownAssignment.id}`,
      { headers: { Authorization: `Bearer ${memberAuth.token}` } }
    )
    const assignment = ownAssignment
    const day = (await assignmentDetailResponse.json()).programAssignment.days[0]
    const startedSession = await (await memberContext.request.post(
      `/api/v1/studios/${studioId}/program-assignments/${assignment.id}/workout-sessions`,
      { headers: { Authorization: `Bearer ${memberAuth.token}` }, data: { programDayId: day.id, clientStartKey: 'admin-walkthrough-key' } }
    )).json()
    const session = startedSession.workoutSession
    const exercise = session.exercises[0]
    const set = exercise.sets[0]
    const setUpdate = await memberContext.request.patch(
      `/api/v1/studios/${studioId}/workout-sessions/${session.id}/exercises/${exercise.id}/sets/${set.id}`,
      { headers: { Authorization: `Bearer ${memberAuth.token}` }, data: { status: 'completed', actualReps: 5, expectedRevision: set.revision } }
    )
    expect(setUpdate.status()).toBe(200)
    const exerciseUpdate = await memberContext.request.patch(
      `/api/v1/studios/${studioId}/workout-sessions/${session.id}/exercises/${exercise.id}`,
      { headers: { Authorization: `Bearer ${memberAuth.token}` }, data: { status: 'completed', expectedRevision: exercise.revision } }
    )
    expect(exerciseUpdate.status()).toBe(200)
    const completedResponse = await memberContext.request.post(
      `/api/v1/studios/${studioId}/workout-sessions/${session.id}/complete`,
      { headers: { Authorization: `Bearer ${memberAuth.token}` } }
    )
    const completedSession = (await completedResponse.json()).workoutSession

    // 16: Admin views the result.
    await adminPage.goto(`/studios/${studioId}/coach-results`)
    await expect(adminPage.getByText(member.username)).toBeVisible()
    await adminPage.getByRole('button', { name: 'Trainingseinheiten ansehen' }).click()
    await adminPage.getByRole('link', { name: 'Details ansehen' }).click()
    await expect(adminPage).toHaveURL(new RegExp(`/studios/${studioId}/coach-results/${memberMembershipId}/sessions/${completedSession.id}$`))
    await expect(adminPage.getByText('Kreuzheben')).toBeVisible()

    // 17: Admin creates feedback.
    await adminPage.getByLabel('Feedback verfassen').fill('Guter erster Durchgang, Technik sauber.')
    await adminPage.getByRole('button', { name: 'Feedback senden' }).click()
    await expect(adminPage.getByText('Guter erster Durchgang, Technik sauber.')).toBeVisible()

    // 18: Audit log shows understandable, translated events - not raw codes.
    await adminPage.goto(`/studios/${studioId}/audit`)
    for (const label of [
      'Einladung erstellt',
      'Einladung erneut gesendet',
      'Einladung widerrufen',
      'Einladung angenommen',
      'Coaching-Beziehung erstellt',
      'Trainingsprogramm erstellt',
      'Programmversion erstellt',
      'Programmversion veröffentlicht',
      'Programm zugewiesen',
      'Workout gestartet',
      'Workout abgeschlossen',
      'Coach-Feedback hinzugefügt',
    ]) {
      await expect(adminPage.getByText(label).first()).toBeVisible()
    }
    await expect(adminPage.getByText(/^(invitation|training_program|workout_session|workout_feedback|coaching_relationship)\./)).toHaveCount(0)

    // 19: Owner-specific functions are not available to the admin - the slug
    // field is visibly disabled with an explanatory hint in the UI, and
    // rejected server-side regardless (changing it requires the owner-only
    // permission).
    await adminPage.goto(`/studios/${studioId}/settings`)
    await expect(adminPage.getByLabel('Kurzname')).toBeDisabled()
    await expect(adminPage.getByText('Nur Eigentümer:innen können diese Mitgliedschaft verwalten.')).toBeVisible()
    const slugAttempt = await adminPage.request.patch(`/api/v1/studios/${studioId}`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
      data: { slug: `admin-should-not-be-able-to-set-${admin.username}` },
    })
    expect(slugAttempt.status()).toBe(403)
    expect((await slugAttempt.json()).error.code).toBe('INSUFFICIENT_STUDIO_ROLE')

    // 20: A second, unrelated studio remains fully isolated from this admin.
    const foreignOwner = userFixture('adminwalk-foreignowner')
    const foreignOwnerAuth = await loginApi(request, await (async () => {
      await registerApi(request, foreignOwner)
      return foreignOwner
    })())
    const foreignStudioResponse = await request.post('/api/v1/studios', {
      headers: { Authorization: `Bearer ${foreignOwnerAuth.token}` },
      data: {
        name: 'Foreign Walkthrough Studio', slug: `foreign-walk-${foreignOwner.username}`,
        defaultLocale: 'de', defaultTimezone: 'Europe/Zurich', defaultWeightUnit: 'kg',
      },
    })
    const foreignStudio = (await foreignStudioResponse.json()).studio
    const foreignRead = await adminContext.request.get(`/api/v1/studios/${foreignStudio.id}`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    })
    expect(foreignRead.status()).toBe(404)
    expect((await foreignRead.json()).error.code).toBe('STUDIO_NOT_FOUND')

    // A fresh pending invitation so the keyboard-navigation check below has
    // a guaranteed "Erneut senden" button - every invitation created earlier
    // in this walkthrough is by now accepted or revoked.
    const keyboardCheckInvitee = userFixture('adminwalk-kbcheck')
    await adminPage.goto(`/studios/${studioId}/invitations`)
    await adminPage.getByLabel('E-Mail-Adresse').fill(keyboardCheckInvitee.email)
    await adminPage.getByLabel('Rolle').selectOption('member')
    await adminPage.getByRole('button', { name: 'Einladung erstellen' }).click()
    await expect(adminPage.locator('.studio-delivery a')).toBeVisible()

    // Mobile smoke: the admin's core management pages at 390px, no
    // horizontal overflow, no serious/critical axe violations.
    await adminPage.setViewportSize({ width: 390, height: 844 })
    for (const [route, label] of [
      [`/studios/${studioId}/members`, 'members@390px'],
      [`/studios/${studioId}/invitations`, 'invitations@390px'],
      [`/studios/${studioId}/audit`, 'audit@390px'],
      [`/studios/${studioId}/coaching`, 'coaching@390px'],
    ]) {
      await adminPage.goto(route)
      await expectNoHorizontalOverflow(adminPage, label)
      await expectNoSeriousAxeViolations(adminPage)
    }

    // The resend/revoke actions remain reachable via keyboard.
    await adminPage.goto(`/studios/${studioId}/invitations`)
    const resendButton = adminPage.getByRole('button', { name: 'Erneut senden' }).first()
    await expect(resendButton).toBeVisible()
    await resendButton.focus()
    await expect(resendButton).toBeFocused()
    await adminPage.keyboard.press('Enter')
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage.keyboard.press('Escape')
    await expect(adminPage.getByRole('dialog')).toHaveCount(0)
  } finally {
    await adminContext.close()
    await memberContext.close()
  }
})
