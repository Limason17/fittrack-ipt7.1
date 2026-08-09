import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../../utils/api', () => ({ apiRequest: vi.fn().mockResolvedValue({}) }))

const accountApi = vi.hoisted(() => ({
  getAccountDeletionPreview: vi.fn(),
  requestAccountDeletion: vi.fn(),
}))
vi.mock('../../utils/accountApi', () => accountApi)

import AccountDeletionDangerZone from './AccountDeletionDangerZone.vue'
import { authToken, authUser } from '../../utils/auth'
import { locale } from '../../utils/i18n'
import { toasts } from '../../utils/toast'
import {
  activeStudioId,
  addAndSelectStudio,
  authorizedStudios,
  clearStudioContext,
} from '../../utils/studioContext'

let wrapper

function fullPreview(overrides = {}) {
  return {
    mode: 'anonymize',
    studios: [],
    blockers: [],
    impact: {
      runningWorkoutSessions: 0,
      activeAssignments: 0,
      activeCoachingRelationships: 0,
      activeScheduleRules: 0,
      personalCalendarEntriesToDelete: 0,
      futureStudioCalendarEntries: 0,
    },
    personalDataCounts: { workouts: 0, progressEntries: 0, personalExercises: 0 },
    preservedHistoryCounts: {
      studioWorkoutSessions: 0,
      programAssignments: 0,
      coachFeedbackReceived: 0,
      coachFeedbackAuthored: 0,
    },
    confirmationPhrase: { type: 'username' },
    notices: {
      freeTextRetention: 'Free-text notes and coach feedback are not deleted or altered.',
      backupRetention: 'Encrypted backups may retain your data for the documented retention window.',
    },
    ...overrides,
  }
}

function blockerPreview() {
  return fullPreview({
    blockers: [
      {
        code: 'ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED',
        studios: [{ studioId: 'studio-public-1', studioName: 'Solo Owner Studio' }],
      },
    ],
  })
}

async function mountDangerZone() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ],
  })
  await router.push('/profile')
  await router.isReady()
  const view = mount(AccountDeletionDangerZone, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { view, router }
}

async function openDialog(view) {
  await view.get('.danger-zone-card button.btn-danger').trigger('click')
  await flushPromises()
}

async function goToConfirmStep(view) {
  await openDialog(view)
  await new DOMWrapper(dialogElement()).get('button.btn-primary').trigger('click')
  await flushPromises()
}

function dialogElement() {
  return document.body.querySelector('[role="dialog"]')
}

describe('AccountDeletionDangerZone', () => {
  beforeEach(() => {
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'ada.lovelace', email: 'ada@example.test' }
    locale.value = 'de'
    clearStudioContext()
    accountApi.getAccountDeletionPreview.mockReset()
    accountApi.requestAccountDeletion.mockReset()
    accountApi.getAccountDeletionPreview.mockResolvedValue({ deletionPreview: fullPreview() })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('1. shows a clearly separated danger zone', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    expect(wrapper.text()).toContain('Gefahrenbereich')
    expect(wrapper.text()).toContain('Konto dauerhaft löschen')
    expect(wrapper.get('.danger-zone-card button.btn-danger').text()).toContain('Konto löschen')
  })

  it('2. the first click only loads the preview, never executes the deletion', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)
    expect(accountApi.getAccountDeletionPreview).toHaveBeenCalledTimes(1)
    expect(accountApi.requestAccountDeletion).not.toHaveBeenCalled()
  })

  it('3. loads the current preview from the backend when opened', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    expect(accountApi.getAccountDeletionPreview).not.toHaveBeenCalled()
    await openDialog(wrapper)
    expect(accountApi.getAccountDeletionPreview).toHaveBeenCalledTimes(1)
  })

  it('4. shows a loading state while the preview request is in flight', async () => {
    let resolvePreview
    accountApi.getAccountDeletionPreview.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve
      })
    )
    const { view } = await mountDangerZone()
    wrapper = view
    await wrapper.get('.danger-zone-card button.btn-danger').trigger('click')
    await flushPromises()

    expect(dialogElement().querySelector('[aria-busy="true"]')).not.toBeNull()

    resolvePreview({ deletionPreview: fullPreview() })
    await flushPromises()
    expect(dialogElement().querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('5. renders non-zero preview counts', async () => {
    accountApi.getAccountDeletionPreview.mockResolvedValue({
      deletionPreview: fullPreview({
        personalDataCounts: { workouts: 4, progressEntries: 12, personalExercises: 2 },
      }),
    })
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)

    const dialogText = new DOMWrapper(dialogElement()).text()
    expect(dialogText).toContain('Persönliche Workouts')
    expect(dialogText).toContain('4')
    expect(dialogText).toContain('Fortschrittseinträge')
    expect(dialogText).toContain('12')
    expect(dialogText).toContain('Persönliche Übungen')
    expect(dialogText).toContain('2')
  })

  it('6. shows a retained-history notice for preserved counts', async () => {
    accountApi.getAccountDeletionPreview.mockResolvedValue({
      deletionPreview: fullPreview({
        preservedHistoryCounts: {
          studioWorkoutSessions: 6,
          programAssignments: 2,
          coachFeedbackReceived: 1,
          coachFeedbackAuthored: 0,
        },
      }),
    })
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)

    const dialogText = new DOMWrapper(dialogElement()).text()
    expect(dialogText).toContain('Kann erhalten bleiben')
    expect(dialogText).toContain('Abgeschlossene Studio-Sessions')
    expect(dialogText).toContain('6')
  })

  it('7. shows the backend free-text retention notice verbatim', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)
    expect(new DOMWrapper(dialogElement()).text()).toContain(
      'Free-text notes and coach feedback are not deleted or altered.'
    )
  })

  it('8. shows the backend backup retention notice verbatim', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)
    expect(new DOMWrapper(dialogElement()).text()).toContain(
      'Encrypted backups may retain your data for the documented retention window.'
    )
  })

  it('9. shows the sole-owner blocker prominently, with only the affected studio name', async () => {
    accountApi.getAccountDeletionPreview.mockResolvedValue({ deletionPreview: blockerPreview() })
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)

    const dialogText = new DOMWrapper(dialogElement()).text()
    expect(dialogText).toContain('Löschung aktuell nicht möglich')
    expect(dialogText).toContain('mindestens ein weiterer aktiver Owner')
    expect(dialogText).toContain('Solo Owner Studio')
    expect(dialogText).not.toContain('studio-public-1')
  })

  it('10. a blocked user never sees a final submit / continue control', async () => {
    accountApi.getAccountDeletionPreview.mockResolvedValue({ deletionPreview: blockerPreview() })
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)

    const dialog = new DOMWrapper(dialogElement())
    expect(dialog.findAll('button').some((button) => button.text().includes('Weiter'))).toBe(false)
    expect(dialog.find('#current-password-error').exists()).toBe(false)
    expect(dialog.findAll('input[type="password"]')).toHaveLength(0)
  })

  it('11. an unblocked user can move into the confirm step', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)

    const dialog = new DOMWrapper(dialogElement())
    expect(dialog.text()).toContain('Konto endgültig löschen')
    expect(dialog.find('input[type="password"]').exists()).toBe(true)
  })

  it('12. submit stays disabled while the password is empty', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())

    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    const submit = dialog.findAll('button[type="submit"]')[0]
    expect(submit.attributes('disabled')).toBeDefined()
  })

  it('13. submit stays disabled while the confirmation phrase is empty', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())

    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    const submit = dialog.findAll('button[type="submit"]')[0]
    expect(submit.attributes('disabled')).toBeDefined()
  })

  it('14. a wrong confirmation phrase disables submit and shows a mismatch hint', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())

    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('not-the-username')

    const submit = dialog.findAll('button[type="submit"]')[0]
    expect(submit.attributes('disabled')).toBeDefined()
    expect(dialog.text()).toContain('stimmt nicht mit deinem Benutzernamen überein')
  })

  it('15. the exact username as phrase enables submit', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())

    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')

    const submit = dialog.findAll('button[type="submit"]')[0]
    expect(submit.attributes('disabled')).toBeUndefined()
  })

  it('16. a double click never sends a second deletion request', async () => {
    let resolveDeletion
    accountApi.requestAccountDeletion.mockReturnValue(
      new Promise((resolve) => {
        resolveDeletion = resolve
      })
    )
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')

    const form = dialog.find('form')
    await form.trigger('submit')
    await form.trigger('submit')
    await flushPromises()

    expect(accountApi.requestAccountDeletion).toHaveBeenCalledTimes(1)
    resolveDeletion({ accountDeletion: { completedAt: '2026-08-09T00:00:00.000Z', studiosAffected: 0 } })
    await flushPromises()
  })

  it('17 & 18. sends currentPassword and confirmationPhrase exactly as entered', async () => {
    accountApi.requestAccountDeletion.mockResolvedValue({
      accountDeletion: { completedAt: '2026-08-09T00:00:00.000Z', studiosAffected: 0 },
    })
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(accountApi.requestAccountDeletion).toHaveBeenCalledWith({
      currentPassword: 'correct-horse-battery-staple',
      confirmationPhrase: 'ada.lovelace',
    })
  })

  it('19. a wrong current password shows a field error and clears the password', async () => {
    const error = new Error('invalid')
    error.status = 401
    error.data = { error: { code: 'CURRENT_PASSWORD_INVALID' } }
    accountApi.requestAccountDeletion.mockRejectedValue(error)
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('wrong-password')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(new DOMWrapper(dialogElement()).text()).toContain('Das aktuelle Passwort ist nicht korrekt.')
    expect(dialog.find('input[type="password"]').element.value).toBe('')
    expect(authToken.value).toBe('token')
  })

  it('20. a backend-reported phrase mismatch shows a clear phrase error, no generic crash', async () => {
    const error = new Error('mismatch')
    error.status = 400
    error.data = { error: { code: 'ACCOUNT_DELETION_PHRASE_MISMATCH' } }
    accountApi.requestAccountDeletion.mockRejectedValue(error)
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(new DOMWrapper(dialogElement()).text()).toContain(
      'Die Bestätigungsphrase stimmt nicht mit deinem Benutzernamen überein.'
    )
  })

  it('21. a 409 owner race falls back to the preview step with a refreshed blocker', async () => {
    const error = new Error('ownership required')
    error.status = 409
    error.data = { error: { code: 'ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED' } }
    accountApi.requestAccountDeletion.mockRejectedValue(error)
    accountApi.getAccountDeletionPreview
      .mockResolvedValueOnce({ deletionPreview: fullPreview() })
      .mockResolvedValueOnce({ deletionPreview: blockerPreview() })
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(accountApi.getAccountDeletionPreview).toHaveBeenCalledTimes(2)
    const dialogText = new DOMWrapper(dialogElement()).text()
    expect(dialogText).toContain('Löschung aktuell nicht möglich')
    expect(dialogText).toContain('Solo Owner Studio')
  })

  it('22. a 429 shows a rate-limit message, a countdown, and disables submit', async () => {
    const error = new Error('too many requests')
    error.status = 429
    error.data = { error: { code: 'RATE_LIMIT_EXCEEDED' } }
    error.retryAfterSeconds = 45
    accountApi.requestAccountDeletion.mockRejectedValue(error)
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    const dialogText = new DOMWrapper(dialogElement()).text()
    expect(dialogText).toContain('Zu viele Versuche')
    expect(dialogText).toMatch(/45s/)
    const submit = dialog.findAll('button[type="submit"]')[0]
    expect(submit.attributes('disabled')).toBeDefined()
  })

  it('23. a 503 shows only the safe generic message, no internal subsystem details', async () => {
    const error = new Error('service unavailable')
    error.status = 503
    error.data = { error: { code: 'DELETION_RECEIPT_RECONCILIATION_REQUIRED' } }
    accountApi.requestAccountDeletion.mockRejectedValue(error)
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    const dialogText = new DOMWrapper(dialogElement()).text()
    expect(dialogText).toContain('momentan aus Sicherheitsgründen nicht verfügbar')
    expect(dialogText).not.toMatch(/HMAC|Receipt|Doctor|Reconciliation|Stacktrace/i)
  })

  it('24 & 25 & 26 & 27. a successful delete clears auth state and studio context, navigates to login, and shows a neutral success toast', async () => {
    addAndSelectStudio({
      id: 'studio-a',
      name: 'Studio A',
      status: 'active',
      membership: { id: 'membership-a', role: 'member', status: 'active' },
    })
    expect(authorizedStudios.value).toHaveLength(1)

    accountApi.requestAccountDeletion.mockResolvedValue({
      accountDeletion: { completedAt: '2026-08-09T00:00:00.000Z', studiosAffected: 1 },
    })
    const { view, router } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(authToken.value).toBeNull()
    expect(authUser.value).toBeNull()
    expect(authorizedStudios.value).toHaveLength(0)
    expect(activeStudioId.value).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(toasts.value.some((toast) => toast.message === 'Dein Konto wurde gelöscht.')).toBe(true)
  })

  it('28. never claims that all data was fully deleted', async () => {
    accountApi.requestAccountDeletion.mockResolvedValue({
      accountDeletion: { completedAt: '2026-08-09T00:00:00.000Z', studiosAffected: 0 },
    })
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('correct-horse-battery-staple')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    const successToast = toasts.value.find((toast) => toast.tone === 'success')
    expect(successToast?.message).not.toMatch(/alle.*Daten.*(vollständig )?gelöscht/i)
  })

  it('29. closing the dialog removes it from the DOM', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await openDialog(wrapper)
    expect(dialogElement()).not.toBeNull()

    await new DOMWrapper(dialogElement()).find('button.btn-secondary').trigger('click')
    await flushPromises()

    expect(dialogElement()).toBeNull()
  })

  it('30. focus returns to the trigger button after closing', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    const trigger = wrapper.get('.danger-zone-card button.btn-danger')
    // A real click focuses the activating element before the dialog opens -
    // jsdom's synthetic trigger('click') does not do this on its own, so it
    // is focused explicitly to reproduce what useModalFocus actually
    // captures as document.activeElement in a real browser.
    trigger.element.focus()
    await trigger.trigger('click')
    await flushPromises()

    await new DOMWrapper(dialogElement()).find('button.btn-secondary').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(trigger.element)
  })

  it('31. the password is cleared from state after closing and reopening the dialog', async () => {
    const { view } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    let dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('a-password-that-must-not-linger')

    await dialog.find('button.btn-secondary').trigger('click')
    await flushPromises()

    await openDialog(wrapper)
    await new DOMWrapper(dialogElement()).get('button.btn-primary').trigger('click')
    await flushPromises()
    dialog = new DOMWrapper(dialogElement())
    expect(dialog.find('input[type="password"]').element.value).toBe('')
  })

  it('32. no sensitive data ever reaches the URL', async () => {
    accountApi.requestAccountDeletion.mockResolvedValue({
      accountDeletion: { completedAt: '2026-08-09T00:00:00.000Z', studiosAffected: 0 },
    })
    const { view, router } = await mountDangerZone()
    wrapper = view
    await goToConfirmStep(wrapper)
    const dialog = new DOMWrapper(dialogElement())
    await dialog.find('input[type="password"]').setValue('a-password-that-must-not-leak')
    await dialog.find('input[type="text"]').setValue('ada.lovelace')
    await dialog.find('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/login')
    expect(router.currentRoute.value.fullPath).not.toContain('a-password-that-must-not-leak')
  })

  it('33. no sensitive data ever reaches the console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrongPasswordError = new Error('invalid')
      wrongPasswordError.status = 401
      wrongPasswordError.data = { error: { code: 'CURRENT_PASSWORD_INVALID' } }
      accountApi.requestAccountDeletion.mockRejectedValueOnce(wrongPasswordError)

      const secret = 'super-secret-password-never-logged'
      const { view } = await mountDangerZone()
      wrapper = view
      await goToConfirmStep(wrapper)
      const dialog = new DOMWrapper(dialogElement())
      await dialog.find('input[type="password"]').setValue(secret)
      await dialog.find('input[type="text"]').setValue('ada.lovelace')
      await dialog.find('form').trigger('submit')
      await flushPromises()

      const allLoggedArgs = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((value) => JSON.stringify(value))
        .join(' ')
      expect(allLoggedArgs).not.toContain(secret)
      expect(allLoggedArgs).not.toContain('ada.lovelace')
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
