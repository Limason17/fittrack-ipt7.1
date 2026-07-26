import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../utils/api', () => api)

import RegisterView from './RegisterView.vue'
import { locale } from '../utils/i18n'

let wrapper

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/register', name: 'register', component: RegisterView },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ],
  })
  await router.push('/register')
  await router.isReady()
  const view = mount(RegisterView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return view
}

describe('RegisterView', () => {
  beforeEach(() => {
    locale.value = 'de'
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
    error.retryAfterSeconds = 15
    api.apiRequest.mockRejectedValue(error)
    wrapper = await mountView()

    await wrapper.get('#username').setValue('newuser')
    await wrapper.get('#email').setValue('newuser@example.test')
    await wrapper.get('#password').setValue('a-strong-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Zu viele Versuche')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/15s/)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('RATE_LIMIT_EXCEEDED')
  })

  it('a plain server error still shows the generic register-failed message, unaffected by the new 429 branch', async () => {
    const error = new Error('conflict')
    error.status = 409
    error.data = { error: { code: 'CONFLICT' } }
    api.apiRequest.mockRejectedValue(error)
    wrapper = await mountView()

    await wrapper.get('#username').setValue('newuser')
    await wrapper.get('#email').setValue('newuser@example.test')
    await wrapper.get('#password').setValue('a-strong-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Registrierung fehlgeschlagen')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })
})
