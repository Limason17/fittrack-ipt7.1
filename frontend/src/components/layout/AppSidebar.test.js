import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import AppSidebar from './AppSidebar.vue'
import { authToken, authUser } from '../../utils/auth'
import { locale } from '../../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../../utils/studioContext'

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

async function mountSidebar() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/workouts', name: 'workouts', component: { template: '<div />' } },
      { path: '/exercises', name: 'exercises', component: { template: '<div />' } },
      { path: '/progress', name: 'progress', component: { template: '<div />' } },
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
      { path: '/studios/:studioId/settings', name: 'studio-settings', component: { template: '<div />' } },
      { path: '/studios/:studioId/members', name: 'studio-members', component: { template: '<div />' } },
      { path: '/studios/:studioId/invitations', name: 'studio-invitations', component: { template: '<div />' } },
      { path: '/studios/:studioId/audit', name: 'studio-audit', component: { template: '<div />' } },
      { path: '/studios/:studioId/coaching', name: 'studio-coaching', component: { template: '<div />' } },
      {
        path: '/studios/:studioId/training-programs',
        name: 'studio-training-programs',
        component: { template: '<div />' },
      },
      {
        path: '/studios/:studioId/assignments',
        name: 'studio-program-assignments',
        component: { template: '<div />' },
      },
      {
        path: '/studios/:studioId/my-training-plan',
        name: 'studio-my-training-plan',
        component: { template: '<div />' },
      },
    ],
  })
  await router.push('/')
  await router.isReady()
  return mount(AppSidebar, { props: { open: false }, global: { plugins: [router] } })
}

describe('AppSidebar role-dependent navigation', () => {
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

  it('always shows the personal navigation group', async () => {
    wrapper = await mountSidebar()
    await flushPromises()

    expect(wrapper.text()).toContain('Übersicht')
    expect(wrapper.text()).toContain('Workouts')
    expect(wrapper.text()).toContain('Übungen')
    expect(wrapper.text()).toContain('Fortschritt')
    expect(wrapper.text()).toContain('Profil')
  })

  it('hides the studio navigation group when no studio is active', async () => {
    wrapper = await mountSidebar()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Mitglieder')
    expect(wrapper.text()).not.toContain('Audit')
  })

  it.each(['owner', 'admin'])('shows full management navigation to %s users', async (role) => {
    addAndSelectStudio(studio(role))
    wrapper = await mountSidebar()
    await flushPromises()

    expect(wrapper.text()).toContain('Einstellungen')
    expect(wrapper.text()).toContain('Mitglieder')
    expect(wrapper.text()).toContain('Einladungen')
    expect(wrapper.text()).toContain('Audit')
    expect(wrapper.text()).toContain('Coaching')
    expect(wrapper.text()).toContain('Trainingsprogramme')
    expect(wrapper.text()).toContain('Zuweisungen')
    expect(wrapper.text()).not.toContain('Mein Trainingsplan')
  })

  it('shows the training management group but not studio administration to trainers', async () => {
    addAndSelectStudio(studio('trainer'))
    wrapper = await mountSidebar()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Einstellungen')
    expect(wrapper.text()).not.toContain('Einladungen')
    expect(wrapper.text()).not.toContain('Audit')
    expect(wrapper.text()).toContain('Mitglieder')
    expect(wrapper.text()).toContain('Coaching')
    expect(wrapper.text()).toContain('Trainingsprogramme')
    expect(wrapper.text()).toContain('Zuweisungen')
    expect(wrapper.text()).not.toContain('Mein Trainingsplan')
  })

  it('shows only "Mein Trainingsplan" from the training group to members', async () => {
    addAndSelectStudio(studio('member'))
    wrapper = await mountSidebar()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Einstellungen')
    expect(wrapper.text()).not.toContain('Einladungen')
    expect(wrapper.text()).not.toContain('Audit')
    expect(wrapper.text()).not.toContain('Mitglieder')
    expect(wrapper.text()).not.toContain('Coaching')
    expect(wrapper.text()).not.toContain('Trainingsprogramme')
    expect(wrapper.text()).not.toContain('Zuweisungen')
    expect(wrapper.text()).toContain('Mein Trainingsplan')
  })

  it('shows the current studio role as sidebar section info', async () => {
    addAndSelectStudio(studio('owner'))
    wrapper = await mountSidebar()
    await flushPromises()

    expect(wrapper.text()).toContain('Eigentümer:in')
  })
})
