import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const accountApi = vi.hoisted(() => ({
  confirmEmailChange: vi.fn(),
}))
vi.mock('../utils/accountApi', () => accountApi)

import EmailChangeConfirmView from './EmailChangeConfirmView.vue'
import { locale } from '../utils/i18n'

let wrapper

async function mountView(token = 'a-valid-looking-token') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/account/email-change/:token', name: 'account-email-change-confirm', component: EmailChangeConfirmView },
    ],
  })
  await router.push(`/account/email-change/${token}`)
  await router.isReady()
  const view = mount(EmailChangeConfirmView, { global: { plugins: [router] } })
  await flushPromises()
  return { view, router }
}

describe('EmailChangeConfirmView', () => {
  beforeEach(() => {
    locale.value = 'de'
    accountApi.confirmEmailChange.mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('requires an explicit click before calling the confirmation endpoint', async () => {
    const { view } = await mountView('token-abc')
    wrapper = view

    expect(accountApi.confirmEmailChange).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('E-Mail-Adresse bestätigen')
  })

  it('confirms with the token from the route and shows the success view', async () => {
    accountApi.confirmEmailChange.mockResolvedValue({ message: 'ok' })
    const { view } = await mountView('token-abc')
    wrapper = view

    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()

    expect(accountApi.confirmEmailChange).toHaveBeenCalledWith('token-abc')
    expect(wrapper.text()).toContain('E-Mail-Adresse bestätigt')
    expect(wrapper.find('a').attributes('href')).toBe('/login')
  })

  it('shows a generic error for an invalid, expired, revoked or replayed token', async () => {
    const error = new Error('invalid')
    error.status = 404
    error.data = { error: { code: 'EMAIL_CHANGE_TOKEN_INVALID' } }
    accountApi.confirmEmailChange.mockRejectedValue(error)
    const { view } = await mountView('token-abc')
    wrapper = view

    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('ungültig')
    expect(wrapper.text()).not.toContain('E-Mail-Adresse bestätigt')
  })
})
