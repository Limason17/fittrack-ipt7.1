import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import AppHeader from './AppHeader.vue'
import { authToken, authUser, logout } from '../../utils/auth'
import { locale } from '../../utils/i18n'

let wrapper

async function mountHeader() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/register', name: 'register', component: { template: '<div />' } },
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return { wrapper: mount(AppHeader, { global: { plugins: [router] }, attachTo: document.body }), router }
}

describe('AppHeader', () => {
  beforeEach(() => {
    localStorage.clear()
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    logout()
  })

  it('shows login and register actions for guests', async () => {
    authToken.value = null
    authUser.value = null
    ;({ wrapper } = await mountHeader())
    await flushPromises()

    expect(wrapper.text()).toContain('Login')
    expect(wrapper.text()).toContain('Registrieren')
  })

  it('shows an account menu with the signed-in user and a working logout', async () => {
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Ada Lovelace', email: 'ada@example.test' }
    const mounted = await mountHeader()
    wrapper = mounted.wrapper
    await flushPromises()

    await wrapper.get('.app-header-avatar').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('Ada Lovelace')
    expect(document.body.textContent).toContain('ada@example.test')

    const logoutButton = [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent.includes('Logout'))
    logoutButton.click()
    await flushPromises()

    expect(authToken.value).toBeNull()
    expect(mounted.router.currentRoute.value.name).toBe('login')
  })
})
