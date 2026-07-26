import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../utils/api', () => ({ apiRequest: vi.fn().mockResolvedValue({}) }))

const accountApi = vi.hoisted(() => ({
  changePassword: vi.fn(),
  requestEmailChange: vi.fn(),
  getCurrentEmailChangeRequest: vi.fn(),
  revokeEmailChangeRequest: vi.fn(),
}))
vi.mock('../utils/accountApi', () => accountApi)

import ProfileView from './ProfileView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { distanceUnit, weightUnit } from '../utils/units'

let wrapper

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/profile', name: 'profile', component: ProfileView },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ],
  })
  await router.push('/profile')
  await router.isReady()
  const view = mount(ProfileView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { view, router }
}

async function openSecurityTab(view) {
  const securityTab = view.findAll('[role="tab"]').find((tab) => tab.text() === 'Sicherheit')
  await securityTab.trigger('click')
  await flushPromises()
}

describe('ProfileView', () => {
  beforeEach(() => {
    localStorage.clear()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Ada Lovelace', email: 'ada@example.test' }
    locale.value = 'de'
    weightUnit.value = 'kg'
    distanceUnit.value = 'km'
    accountApi.changePassword.mockReset()
    accountApi.requestEmailChange.mockReset()
    accountApi.getCurrentEmailChangeRequest.mockReset()
    accountApi.revokeEmailChangeRequest.mockReset()
    accountApi.getCurrentEmailChangeRequest.mockResolvedValue({ emailChangeRequest: null })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('shows account details on the account tab', () => {
    wrapper = mount(ProfileView)

    expect(wrapper.text()).toContain('Ada Lovelace')
    expect(wrapper.text()).toContain('ada@example.test')
  })

  it('switches to the preferences tab and updates the weight unit', async () => {
    wrapper = mount(ProfileView)
    const preferencesTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === 'Anzeige')
    await preferencesTab.trigger('click')
    await flushPromises()

    const lbButton = wrapper.findAll('button').find((button) => button.text() === 'lb')
    await lbButton.trigger('click')
    await flushPromises()

    expect(weightUnit.value).toBe('lb')
  })

  it('changes the password, logs the user out, and redirects to login', async () => {
    accountApi.changePassword.mockResolvedValue({ message: 'ok' })
    const { view, router } = await mountView()
    wrapper = view
    await openSecurityTab(wrapper)

    await wrapper.get('#current-password').setValue('old-password')
    await wrapper.get('#new-password').setValue('a-brand-new-password-123')
    await wrapper.get('#new-password-confirmation').setValue('a-brand-new-password-123')
    await wrapper.findAll('form')[0].trigger('submit')
    await flushPromises()

    expect(accountApi.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'a-brand-new-password-123',
      newPasswordConfirmation: 'a-brand-new-password-123',
    })
    expect(authToken.value).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('rejects a mismatched password confirmation locally without calling the API', async () => {
    const { view } = await mountView()
    wrapper = view
    await openSecurityTab(wrapper)

    await wrapper.get('#current-password').setValue('old-password')
    await wrapper.get('#new-password').setValue('a-brand-new-password-123')
    await wrapper.get('#new-password-confirmation').setValue('does-not-match')
    await wrapper.findAll('form')[0].trigger('submit')
    await flushPromises()

    expect(accountApi.changePassword).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('stimmt nicht')
  })

  it('shows a translated error when the current password is wrong', async () => {
    const error = new Error('invalid')
    error.status = 401
    error.data = { error: { code: 'CURRENT_PASSWORD_INVALID' } }
    accountApi.changePassword.mockRejectedValue(error)
    const { view } = await mountView()
    wrapper = view
    await openSecurityTab(wrapper)

    await wrapper.get('#current-password').setValue('wrong-password')
    await wrapper.get('#new-password').setValue('a-brand-new-password-123')
    await wrapper.get('#new-password-confirmation').setValue('a-brand-new-password-123')
    await wrapper.findAll('form')[0].trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('nicht korrekt')
    expect(authToken.value).toBe('token')
  })

  it('Stage 3D: a 429 on password change shows the rate-limit message, a Retry-After countdown, and disables the submit button', async () => {
    const error = new Error('too many requests')
    error.status = 429
    error.data = { error: { code: 'RATE_LIMIT_EXCEEDED' } }
    error.retryAfterSeconds = 30
    accountApi.changePassword.mockRejectedValue(error)
    const { view } = await mountView()
    wrapper = view
    await openSecurityTab(wrapper)

    await wrapper.get('#current-password').setValue('current-password-123')
    await wrapper.get('#new-password').setValue('a-brand-new-password-123')
    await wrapper.get('#new-password-confirmation').setValue('a-brand-new-password-123')
    await wrapper.findAll('form')[0].trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Zu viele Versuche')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/30s/)
    const submitButton = wrapper.findAll('form')[0].find('button[type="submit"]')
    expect(submitButton.attributes('disabled')).toBeDefined()
    // No raw backend error code ever reaches the DOM.
    expect(wrapper.text()).not.toContain('RATE_LIMIT_EXCEEDED')
  })

  it('shows the open e-mail change request instead of the request form when one exists', async () => {
    accountApi.getCurrentEmailChangeRequest.mockResolvedValue({
      emailChangeRequest: {
        id: 'req-1',
        newEmail: 'new@example.test',
        status: 'pending',
        expiresAt: '2026-08-01T12:00:00.000Z',
      },
    })
    const { view } = await mountView()
    wrapper = view
    await openSecurityTab(wrapper)

    expect(wrapper.text()).toContain('new@example.test')
    expect(wrapper.find('#new-email').exists()).toBe(false)
  })

  it('requests an e-mail change, shows the resulting open request and its dev-preview confirm link', async () => {
    const confirmUrl = 'http://127.0.0.1:4173/account/email-change/test-token-not-persisted'
    accountApi.requestEmailChange.mockResolvedValue({
      emailChangeRequest: {
        id: 'req-1',
        newEmail: 'new@example.test',
        status: 'pending',
        expiresAt: '2026-08-01T12:00:00.000Z',
      },
      delivery: { delivered: false, confirmUrl },
    })
    const { view } = await mountView()
    wrapper = view
    await openSecurityTab(wrapper)

    await wrapper.get('#new-email').setValue('new@example.test')
    await wrapper.get('#email-change-password').setValue('current-password')
    await wrapper.findAll('form')[1].trigger('submit')
    await flushPromises()

    expect(accountApi.requestEmailChange).toHaveBeenCalledWith({
      newEmail: 'new@example.test',
      currentPassword: 'current-password',
    })
    expect(wrapper.text()).toContain('new@example.test')
    expect(wrapper.get('.studio-delivery').text()).toContain(confirmUrl)
    expect(Object.values(localStorage)).not.toContain(confirmUrl)
  })

  it('revokes an open e-mail change request after confirmation', async () => {
    accountApi.getCurrentEmailChangeRequest.mockResolvedValue({
      emailChangeRequest: {
        id: 'req-1',
        newEmail: 'new@example.test',
        status: 'pending',
        expiresAt: '2026-08-01T12:00:00.000Z',
      },
    })
    accountApi.revokeEmailChangeRequest.mockResolvedValue({ message: 'ok' })
    const { view } = await mountView()
    wrapper = view
    await openSecurityTab(wrapper)

    await wrapper.get('.profile-open-request button').trigger('click')
    await flushPromises()
    // ConfirmDialog is teleported to <body>, outside wrapper.element's
    // subtree, so it must be reached via a raw DOM query wrapped in a
    // DOMWrapper rather than wrapper.get().
    const dialogConfirmButton = document.body.querySelector('[role="dialog"] .btn-danger')
    await new DOMWrapper(dialogConfirmButton).trigger('click')
    await flushPromises()

    expect(accountApi.revokeEmailChangeRequest).toHaveBeenCalled()
    expect(wrapper.find('#new-email').exists()).toBe(true)
  })
})
