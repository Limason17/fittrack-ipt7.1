import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import App from './App.vue'
import { authToken, authUser } from './utils/auth'
import { locale } from './utils/i18n'
import { clearStudioContext } from './utils/studioContext'

let wrapper

async function mountApp(initialPath = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
      { path: '/login', name: 'login', component: { template: '<div>Login</div>' } },
    ],
  })
  await router.push(initialPath)
  await router.isReady()
  const mounted = mount(App, { global: { plugins: [router] } })
  await flushPromises()
  return mounted
}

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('renders no footer landmark and no legacy disclaimer text while logged in', async () => {
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Test User' }
    wrapper = await mountApp('/')

    expect(wrapper.find('footer').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Haftungsausschluss')
    expect(wrapper.text()).not.toContain('bbzwinf.ch')
  })

  it('renders no footer landmark and no legacy disclaimer text while logged out', async () => {
    authToken.value = ''
    authUser.value = null
    wrapper = await mountApp('/login')

    expect(wrapper.find('footer').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Haftungsausschluss')
    expect(wrapper.text()).not.toContain('bbzwinf.ch')
  })

  it('main content fills the shell without a trailing footer gap', async () => {
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Test User' }
    wrapper = await mountApp('/')

    const shell = wrapper.find('.app-shell')
    expect(shell.exists()).toBe(true)
    expect(shell.find('footer').exists()).toBe(false)
  })
})
