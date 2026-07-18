import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import Navbar from './Navbar.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

let wrapper

function studio(role) {
  return {
    id: `studio-${role}`,
    name: `Studio ${role}`,
    slug: `studio-${role}`,
    status: 'active',
    membership: { id: `membership-${role}`, role, status: 'active' },
  }
}

async function mountNavbar() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/register', name: 'register', component: { template: '<div />' } },
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
      { path: '/studios/:studioId/settings', name: 'studio-settings', component: { template: '<div />' } },
      { path: '/studios/:studioId/members', name: 'studio-members', component: { template: '<div />' } },
      { path: '/studios/:studioId/invitations', name: 'studio-invitations', component: { template: '<div />' } },
      { path: '/exercises', component: { template: '<div />' } },
      { path: '/workouts', component: { template: '<div />' } },
      { path: '/progress', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return mount(Navbar, { global: { plugins: [router] } })
}

describe('role-dependent studio navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Test User' }
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it.each(['owner', 'admin'])('shows management navigation to %s users', async (role) => {
    addAndSelectStudio(studio(role))
    wrapper = await mountNavbar()
    await flushPromises()

    expect(wrapper.text()).toContain('Studio verwalten')
    expect(wrapper.text()).toContain('Mitglieder')
    expect(wrapper.text()).toContain('Einladungen')
  })

  it.each(['trainer', 'member'])('hides management navigation from %s users', async (role) => {
    addAndSelectStudio(studio(role))
    wrapper = await mountNavbar()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Studio verwalten')
    expect(wrapper.text()).not.toContain('Einladungen')
    expect(wrapper.text()).toContain('Studios')
    if (role === 'trainer') {
      expect(wrapper.text()).toContain('Mitglieder')
    } else {
      expect(wrapper.text()).not.toContain('Mitglieder')
    }
  })
})
