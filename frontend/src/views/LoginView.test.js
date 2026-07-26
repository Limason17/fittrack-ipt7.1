import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../utils/api', () => api)

vi.mock('../utils/studioContext', () => ({
  hydrateStudioContext: vi.fn().mockResolvedValue(undefined),
}))

import LoginView from './LoginView.vue'
import { authToken, clearAuthState } from '../utils/auth'
import { locale } from '../utils/i18n'

let wrapper

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/register', name: 'register', component: { template: '<div />' } },
      { path: '/', name: 'home', component: { template: '<div />' } },
    ],
  })
  await router.push('/login')
  await router.isReady()
  const view = mount(LoginView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return view
}

describe('LoginView', () => {
  beforeEach(() => {
    localStorage.clear()
    locale.value = 'de'
    clearAuthState()
    api.apiRequest.mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('Stage 3D: a 429 response shows the rate-limit message, a Retry-After countdown, and disables the submit button', async () => {
    const error = new Error('too many requests')
    error.status = 429
    error.data = { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.' } }
    error.retryAfterSeconds = 20
    api.apiRequest.mockRejectedValue(error)
    wrapper = await mountView()

    await wrapper.get('#email').setValue('someone@example.test')
    await wrapper.get('#password').setValue('irrelevant-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Zu viele Versuche')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/20s/)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    // No raw backend error code ever reaches the DOM.
    expect(wrapper.text()).not.toContain('RATE_LIMIT_EXCEEDED')
    expect(authToken.value).toBe(null)
  })

  it('a plain 401 still shows the generic login-failed message, unaffected by the new 429 branch', async () => {
    const error = new Error('unauthorized')
    error.status = 401
    error.data = { error: { code: 'AUTHENTICATION_REQUIRED' } }
    api.apiRequest.mockRejectedValue(error)
    wrapper = await mountView()

    await wrapper.get('#email').setValue('someone@example.test')
    await wrapper.get('#password').setValue('wrong-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Login fehlgeschlagen')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it('does not automatically retry the request once the countdown would elapse - no aggressive auto-retry', async () => {
    const error = new Error('too many requests')
    error.status = 429
    error.data = { error: { code: 'RATE_LIMIT_EXCEEDED' } }
    error.retryAfterSeconds = 1
    api.apiRequest.mockRejectedValue(error)
    wrapper = await mountView()

    await wrapper.get('#email').setValue('someone@example.test')
    await wrapper.get('#password').setValue('irrelevant-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.apiRequest).toHaveBeenCalledTimes(1)
  })
})
