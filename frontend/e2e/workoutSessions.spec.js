import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  attachAuth,
  authenticate,
  formatDateOnlyDeCH,
  loginApi,
  registerApi,
  todayInTimezone,
  userFixture,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

async function expectNoSeriousAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

test('Member-Workout-Ausführung: Session starten, Sätze protokollieren, abschließen, abbrechen, Historie und Fremdzugriff', async ({ page, request, browser }) => {
  test.setTimeout(240_000)

  const owner = userFixture('wsession-owner')
  const trainer = userFixture('wsession-trainer')
  const member = userFixture('wsession-member')
  const foreignMember = userFixture('wsession-foreign')

  const ownerAuth = await authenticate(page, request, owner)
  await registerApi(request, trainer)
  await registerApi(request, member)
  await registerApi(request, foreignMember)

  // ---- Fixture setup via API (studio, invitations, program, coaching, assignment). This is
  // pure boilerplate ahead of the feature under test, not the feature itself, so it is built
  // directly through the API - the same convention accessibility.spec.js already uses. ----

  const studioResponse = await request.post('/api/v1/studios', {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: {
      name: `Workout Session Studio ${owner.username}`,
      slug: `wsession-${owner.username}`,
      defaultLocale: 'de',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'kg',
    },
  })
  expect(studioResponse.status()).toBe(201)
  const studio = (await studioResponse.json()).studio

  async function inviteAndAcceptApi(role, user) {
    const invitationResponse = await request.post(`/api/v1/studios/${studio.id}/invitations`, {
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

  const memberAuth = await inviteAndAcceptApi('member', member)
  await inviteAndAcceptApi('trainer', trainer)
  await inviteAndAcceptApi('member', foreignMember)

  const membershipsResponse = await request.get(`/api/v1/studios/${studio.id}/memberships?limit=50`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
  })
  expect(membershipsResponse.status()).toBe(200)
  const memberships = (await membershipsResponse.json()).memberships
  const trainerMembership = memberships.find((m) => m.user.username === trainer.username)
  const memberMembership = memberships.find((m) => m.user.username === member.username)

  const relationshipResponse = await request.post(`/api/v1/studios/${studio.id}/coaching-relationships`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { coachMembershipId: trainerMembership.id, memberMembershipId: memberMembership.id },
  })
  expect(relationshipResponse.status()).toBe(201)
  const relationship = (await relationshipResponse.json()).coachingRelationship

  const programResponse = await request.post(`/api/v1/studios/${studio.id}/training-programs`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { name: 'Ganzkörper Grundlagen' },
  })
  expect(programResponse.status()).toBe(201)
  const program = (await programResponse.json()).trainingProgram

  const versionResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: {} }
  )
  expect(versionResponse.status()).toBe(201)
  const version = (await versionResponse.json()).programVersion

  const dayResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: 'Tag 1: Ganzkörper' } }
  )
  expect(dayResponse.status()).toBe(201)
  const day = (await dayResponse.json()).programDay

  const exerciseResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days/${day.id}/exercises`,
    {
      headers: { Authorization: `Bearer ${ownerAuth.token}` },
      data: { exerciseNameSnapshot: 'Kniebeuge', targetSets: 2, targetRepsMin: 6, targetRepsMax: 8, targetWeight: 40 },
    }
  )
  expect(exerciseResponse.status()).toBe(201)

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

  // ---- 1: Member opens the plan and sees the assignment with a start action. ----
  await attachAuth(page, memberAuth)
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await expect(page.getByText('Ganzkörper Grundlagen')).toBeVisible()
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByText('Kniebeuge')).toBeVisible()

  // ---- 2: Starting the day navigates to a fresh, mutable session with the planned snapshot and prefilled (empty) sets. ----
  await page.getByRole('button', { name: 'Training starten' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${studio.id}/workout-sessions/[0-9a-f-]+$`))
  const sessionAUrl = page.url()
  await expect(page.getByRole('heading', { name: 'Tag 1: Ganzkörper' })).toBeVisible()
  await expect(page.getByText('Läuft')).toBeVisible()
  await expect(page.getByText('Kniebeuge')).toBeVisible()
  await expect(page.getByText('2 × 6–8 Wdh.')).toBeVisible()
  await expect(page.getByText('40 kg')).toBeVisible()
  const setRows = page.locator('.set-row')
  await expect(setRows).toHaveCount(2)
  await expect(setRows.nth(0).getByLabel('Wdh.')).toHaveValue('')

  // ---- 3: A second "start" attempt for the exact same day converges on the same in-progress
  // session instead of creating a duplicate - the deterministic, user-facing side of the
  // idempotent-start guarantee (the finer-grained dedup-key/race mechanics are covered by
  // workoutSessionState.test.js at the unit level). ----
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByRole('button', { name: 'Fortsetzen' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Training starten' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Fortsetzen' }).click()
  await expect(page).toHaveURL(sessionAUrl)

  // ---- 4: Trying to complete an incomplete session is rejected, without silent auto-completion,
  // and the open exercise is highlighted for the member to act on. ----
  await page.getByRole('button', { name: 'Session abschließen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Session abschließen' }).click()
  await expect(page.getByText('Die Session ist noch nicht vollständig')).toBeVisible()
  await expect(page.locator('.exercise-panel')).toHaveClass(/exercise-panel-highlighted/)

  // ---- 5: Logging results for the planned sets (save-on-blur), then adding and completing an extra set. ----
  await setRows.nth(0).getByLabel('Wdh.').fill('8')
  await setRows.nth(0).getByLabel('Wdh.').blur()
  await expect(setRows.nth(0).getByLabel('Wdh.')).toHaveValue('8')
  await setRows.nth(0).getByLabel('Gewicht (kg)').fill('42.5')
  await setRows.nth(0).getByLabel('Gewicht (kg)').blur()
  await setRows.nth(0).getByRole('button', { name: 'Als erledigt markieren' }).click()
  await expect(setRows.nth(0).getByText('Abgeschlossen')).toBeVisible()

  await setRows.nth(1).getByLabel('Wdh.').fill('7')
  await setRows.nth(1).getByLabel('Wdh.').blur()
  await setRows.nth(1).getByLabel('Gewicht (kg)').fill('42.5')
  await setRows.nth(1).getByLabel('Gewicht (kg)').blur()
  await setRows.nth(1).getByRole('button', { name: 'Als erledigt markieren' }).click()

  await page.getByRole('button', { name: 'Satz hinzufügen' }).click()
  await expect(setRows).toHaveCount(3)
  await setRows.nth(2).getByLabel('Wdh.').fill('6')
  await setRows.nth(2).getByLabel('Wdh.').blur()
  await setRows.nth(2).getByRole('button', { name: 'Als erledigt markieren' }).click()

  await page.getByRole('button', { name: 'Übung abschließen' }).click()
  await expect(page.locator('.exercise-panel-status .badge')).toHaveText('Abgeschlossen')

  // ---- 6: Full completion succeeds, and the session becomes read-only (completed status,
  // completion time, no mutation controls left). ----
  await page.getByRole('button', { name: 'Session abschließen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Session abschließen' }).click()
  await expect(page.getByText('Diese Session ist abgeschlossen und schreibgeschützt.')).toBeVisible()
  await expect(page.locator('.page-header-badge .badge')).toHaveText('Abgeschlossen')
  await expect(page.getByRole('button', { name: 'Satz hinzufügen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Session abschließen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Session abbrechen' })).toHaveCount(0)
  await expect(setRows.nth(0).getByLabel('Wdh.')).toBeDisabled()

  // ---- 7: The completed session shows up in the history, opened from there read-only with the saved values. ----
  await page.getByRole('button', { name: 'Zu meinen Trainings' }).click()
  await expect(page).toHaveURL(`/studios/${studio.id}/workout-sessions`)
  const completedRow = page.locator('tbody tr').filter({ hasText: 'Ganzkörper Grundlagen' }).first()
  await expect(completedRow.getByText('Abgeschlossen')).toBeVisible()
  await completedRow.getByRole('link', { name: 'Details ansehen' }).click()
  await expect(page).toHaveURL(sessionAUrl)
  await expect(page.locator('.set-row').first().getByLabel('Wdh.')).toHaveValue('8')

  // ---- 8: A second session can be started for the same day once the first is terminal. ----
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByRole('button', { name: 'Training starten' })).toBeVisible()
  await page.getByRole('button', { name: 'Training starten' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${studio.id}/workout-sessions/[0-9a-f-]+$`))
  const sessionBUrl = page.url()
  expect(sessionBUrl).not.toBe(sessionAUrl)

  // ---- 9: A concurrent 409 conflict on the same set (two tabs of the same member, both on the
  // still-in-progress session B) is surfaced understandably, never silently overwritten, and
  // resolved via an explicit reload - all before session B is aborted below.
  //
  // Stage 3B2: this is genuinely "two tabs of the same browser session", not
  // two independent devices - so it is modeled as two pages inside `page`'s
  // OWN browser context, not two separate contexts with independently
  // re-injected credentials. A real browser's tabs share one cookie jar;
  // opening tabB via page.context().newPage() gives it that same, always-
  // current jar for free. The earlier version of this test instead created
  // two brand-new contexts and re-attached a `memberAuth` object captured at
  // login (long before this point) - but every one of `page`'s own hard
  // reloads since then (steps 1, 3, 8 above) had already rotated the actual
  // refresh cookie via its own bootstrap, so `memberAuth.cookies` no longer
  // matched what the server considered active. Injecting that stale cookie
  // into two fresh contexts made the very first bootstrap in either of them
  // look like a replay of an already-rotated token - AUTH_REFRESH_REUSE_DETECTED,
  // an artifact of the fixture, not a real product bug (see
  // docs/STAGE_3B2_SESSION_HARDENING.md's "multi-tab" section for the
  // distinction and for the real same-context-concurrent-refresh behavior,
  // which is covered separately in authSession.spec.js).
  const tabA = page
  const tabB = await page.context().newPage()
  try {
    await tabB.goto(sessionBUrl, { waitUntil: 'networkidle' })

    const tabASet = tabA.locator('.set-row').nth(1)
    await tabASet.getByLabel('Wdh.').fill('9')
    await tabASet.getByLabel('Wdh.').blur()
    await expect(tabASet.getByText('Gespeichert')).toBeVisible()

    const tabBSet = tabB.locator('.set-row').nth(1)
    await tabBSet.getByLabel('Wdh.').fill('3')
    await tabBSet.getByLabel('Wdh.').blur()
    await expect(tabBSet.getByText('Konflikt')).toBeVisible()
    await expect(tabB.getByText('Diese Daten wurden inzwischen durch eine andere Anfrage verändert.')).toBeVisible()
    await expect(tabBSet.getByLabel('Wdh.')).toHaveValue('3')

    await tabB.getByRole('button', { name: 'Aktuellen Stand laden' }).first().click()
    await expect(tabB.locator('.set-row').nth(1).getByLabel('Wdh.')).toHaveValue('9')
  } finally {
    await tabB.close()
  }

  // ---- 10: Aborting session B keeps already-saved values while making the session read-only. ----
  const sessionBSets = page.locator('.set-row')
  await sessionBSets.nth(0).getByLabel('Wdh.').fill('5')
  await sessionBSets.nth(0).getByLabel('Wdh.').blur()
  await expect(sessionBSets.nth(0).getByLabel('Wdh.')).toHaveValue('5')

  await page.getByRole('button', { name: 'Session abbrechen' }).click()
  await expect(page.getByRole('dialog')).toContainText('schreibgeschützt')
  await page.getByRole('dialog').getByRole('button', { name: 'Session abbrechen' }).click()
  await expect(page.getByText('Diese Session wurde abgebrochen und ist schreibgeschützt.')).toBeVisible()
  await expect(page.locator('.page-header-badge .badge')).toHaveText('Abgebrochen')
  await expect(sessionBSets.nth(0).getByLabel('Wdh.')).toHaveValue('5')
  await expect(sessionBSets.nth(0).getByLabel('Wdh.')).toBeDisabled()

  // ---- 11: A foreign member of the same studio cannot open the session at all (404, no
  // existence disclosure), and their own logged-in session is not affected. ----
  const foreignContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const foreignAuth = await loginApi(foreignContext.request, foreignMember)
    const foreignPage = await foreignContext.newPage()
    await attachAuth(foreignPage, foreignAuth)
    await foreignPage.goto(sessionAUrl)
    await expect(foreignPage.getByText('Diese Trainingseinheit wurde nicht gefunden.')).toBeVisible()
    await foreignPage.goto(`/studios/${studio.id}/my-training-plan`)
    await expect(foreignPage.getByText('Dir ist aktuell kein Trainingsprogramm zugewiesen.')).toBeVisible()
  } finally {
    await foreignContext.close()
  }

  // ---- 12: The personal workout area remains fully unaffected. ----
  await page.goto('/workouts')
  await expect(page.getByRole('button', { name: 'Workout erstellen' })).toBeVisible()

  // ---- 13: Axe smoke on the three new member views. ----
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await expectNoSeriousAxeViolations(page)
  await page.goto(sessionAUrl)
  await expectNoSeriousAxeViolations(page)
  await page.goto(`/studios/${studio.id}/workout-sessions`)
  await expectNoSeriousAxeViolations(page)
})

// ---- Reliability fixes: deterministic resume detection, server-side history
// status filter, and calendar-date (not timestamp) startsOn/endsOn. ----

async function registerAndLogin(request, user) {
  await registerApi(request, user)
  return loginApi(request, user)
}

async function setupStudioWithAssignment(request, { idPrefix, dayName = 'Tag 1', startsOn, endsOn } = {}) {
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
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { name: dayName } }
  )
  expect(dayResponse.status()).toBe(201)
  const day = (await dayResponse.json()).programDay

  await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/days/${day.id}/exercises`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: { exerciseNameSnapshot: 'Kniebeuge', targetSets: 2, targetRepsMin: 6, targetRepsMax: 8 } }
  )

  const publishResponse = await request.post(
    `/api/v1/studios/${studio.id}/training-programs/${program.id}/versions/${version.id}/publish`,
    { headers: { Authorization: `Bearer ${ownerAuth.token}` } }
  )
  expect(publishResponse.status()).toBe(200)

  const assignmentData = { programVersionId: version.id, memberMembershipId: memberMembership.id, coachingRelationshipId: relationship.id }
  if (startsOn !== undefined) assignmentData.startsOn = startsOn
  if (endsOn !== undefined) assignmentData.endsOn = endsOn
  const assignmentResponse = await request.post(`/api/v1/studios/${studio.id}/program-assignments`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` }, data: assignmentData,
  })
  expect(assignmentResponse.status()).toBe(201)
  const assignment = (await assignmentResponse.json()).programAssignment

  return { owner, member, ownerAuth, memberAuth, studio, day, assignment }
}

async function startSessionApi(request, studioId, token, assignmentId, { programDayId, clientStartKey }) {
  const result = await request.post(`/api/v1/studios/${studioId}/program-assignments/${assignmentId}/workout-sessions`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { programDayId, clientStartKey },
  })
  expect(result.status()).toBe(201)
  return (await result.json()).workoutSession
}

async function abortSessionApi(request, studioId, token, sessionId) {
  const result = await request.post(`/api/v1/studios/${studioId}/workout-sessions/${sessionId}/abort`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(result.status()).toBe(200)
}

test('Fortsetzen wird über den exakten Filter erkannt, auch wenn die Session nicht auf der ersten ungefilterten History-Seite liegt; ein fremdes Mitglied sieht sie nicht', async ({ page, request, browser }) => {
  test.setTimeout(120_000)
  const { ownerAuth, memberAuth, studio, day, assignment } = await setupStudioWithAssignment(request, { idPrefix: 'resume' })

  // 1: Start the session we want to find, then push it off the first (page-size
  // 20) unfiltered history page with 20 more recent terminal sessions on the
  // same assignment+day - proving the resume check cannot be a history scan.
  const target = await startSessionApi(request, studio.id, memberAuth.token, assignment.id, {
    programDayId: day.id, clientStartKey: 'target',
  })
  for (let i = 0; i < 20; i += 1) {
    const pushSession = await startSessionApi(request, studio.id, memberAuth.token, assignment.id, {
      programDayId: day.id, clientStartKey: `push-${i}`,
    })
    await abortSessionApi(request, studio.id, memberAuth.token, pushSession.id)
  }

  await attachAuth(page, memberAuth)
  await page.goto(`/studios/${studio.id}/my-training-plan`)
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByRole('button', { name: 'Fortsetzen' })).toBeVisible()
  await page.getByRole('button', { name: 'Fortsetzen' }).click()
  await expect(page).toHaveURL(new RegExp(`/studios/${studio.id}/workout-sessions/${target.id}$`))

  // 2: A foreign member of the same studio sees neither the assignment nor the session.
  const foreignMember = userFixture('resume-foreign')
  await registerApi(request, foreignMember)
  const foreignInvitation = await request.post(`/api/v1/studios/${studio.id}/invitations`, {
    headers: { Authorization: `Bearer ${ownerAuth.token}` },
    data: { email: foreignMember.email, role: 'member' },
  })
  expect(foreignInvitation.status()).toBe(201)
  const foreignAcceptUrl = (await foreignInvitation.json()).delivery.acceptUrl
  const foreignToken = decodeURIComponent(new URL(foreignAcceptUrl).pathname.split('/').pop())
  const foreignAuth = await loginApi(request, foreignMember)
  await request.post(`/api/v1/invitations/${foreignToken}/accept`, {
    headers: { Authorization: `Bearer ${foreignAuth.token}` },
  })
  const foreignContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'de-CH' })
  try {
    const foreignPage = await foreignContext.newPage()
    await attachAuth(foreignPage, foreignAuth)
    await foreignPage.goto(`/studios/${studio.id}/my-training-plan`)
    await expect(foreignPage.getByText('Dir ist aktuell kein Trainingsprogramm zugewiesen.')).toBeVisible()
    await foreignPage.goto(`/studios/${studio.id}/workout-sessions/${target.id}`)
    await expect(foreignPage.getByText('Diese Trainingseinheit wurde nicht gefunden.')).toBeVisible()
  } finally {
    await foreignContext.close()
  }

  // 3: Personal workouts remain fully unaffected.
  await page.goto('/workouts')
  await expect(page.getByRole('button', { name: 'Workout erstellen' })).toBeVisible()
})

test('Der History-Statusfilter fragt serverseitig gefiltert ab, und Grenzdaten (startsOn/endsOn) werden ohne Zeitzonenverschiebung dargestellt', async ({ page, request }) => {
  test.setTimeout(120_000)
  const { memberAuth, studio, day, assignment } = await setupStudioWithAssignment(request, { idPrefix: 'histfilter' })

  await startSessionApi(request, studio.id, memberAuth.token, assignment.id, {
    programDayId: day.id, clientStartKey: 'running',
  })
  const toAbort = await startSessionApi(request, studio.id, memberAuth.token, assignment.id, {
    programDayId: day.id, clientStartKey: 'to-abort',
  })
  await abortSessionApi(request, studio.id, memberAuth.token, toAbort.id)

  await attachAuth(page, memberAuth)
  await page.goto(`/studios/${studio.id}/workout-sessions`)
  await expect(page.locator('tbody tr')).toHaveCount(2)

  await page.getByRole('tab', { name: 'Abgebrochen' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody tr').first()).toContainText('Abgebrochen')
  await expect(page.locator('tbody tr').first()).not.toContainText('Läuft')

  await page.getByRole('tab', { name: 'Läuft' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody tr').first()).toContainText('Läuft')

  // Boundary date: an assignment starting exactly today must be immediately
  // available (inclusive boundary) and must display "today", never a shifted
  // neighboring calendar day. "Today" here must be the studio's own
  // Europe/Zurich day (todayInTimezone(), matching the backend's
  // todayInTimezone() and startsOn eligibility check) - not the Node
  // test-runner process's own local/UTC day, which disagrees with Zurich
  // for the 1-2 hours around Zurich local midnight and would otherwise
  // send a startsOn that is one day ahead of the studio's actual today,
  // making the assignment wrongly appear not-yet-startable.
  const today = todayInTimezone()
  const boundarySetup = await setupStudioWithAssignment(request, { idPrefix: 'boundary', startsOn: today })

  await attachAuth(page, boundarySetup.memberAuth)
  await page.goto(`/studios/${boundarySetup.studio.id}/my-training-plan`)
  const expectedLabel = formatDateOnlyDeCH(today)
  await expect(page.getByText(expectedLabel)).toBeVisible()
  await page.getByRole('button', { name: 'Details anzeigen' }).click()
  await expect(page.getByRole('button', { name: 'Training starten' })).toBeVisible()
})
