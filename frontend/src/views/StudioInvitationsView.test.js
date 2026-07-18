import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({
  createInvitation: vi.fn(),
  listStudios: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
}))
vi.mock('../utils/studioApi', () => api)

import StudioInvitationsView from './StudioInvitationsView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

function studio(role) {
  return {
    id: 'studio-a',
    name: 'Studio A',
    slug: 'studio-a',
    status: 'active',
    membership: { id: `membership-${role}`, role, status: 'active' },
  }
}

async function mountView(role = 'owner') {
  addAndSelectStudio(studio(role))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
      { path: '/studios/:studioId/settings', name: 'studio-settings', component: { template: '<div />' } },
      { path: '/studios/:studioId/members', name: 'studio-members', component: { template: '<div />' } },
      { path: '/studios/:studioId/invitations', name: 'studio-invitations', component: StudioInvitationsView },
    ],
  })
  await router.push('/studios/studio-a/invitations')
  await router.isReady()
  const wrapper = mount(StudioInvitationsView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('StudioInvitationsView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Owner' }
    locale.value = 'de'
    api.listInvitations.mockReset()
    api.listStudios.mockReset()
    api.createInvitation.mockReset()
    api.revokeInvitation.mockReset()
    api.listInvitations.mockResolvedValue({ invitations: [], pagination: { total: 0 } })
    api.listStudios.mockResolvedValue({ studios: [studio('owner')] })
  })

  it('creates an invitation, displays the one-time delivery link and never persists it', async () => {
    const acceptUrl = 'http://127.0.0.1:4173/invitations/test-token-not-persisted'
    api.createInvitation.mockResolvedValue({
      invitation: { id: 'invitation-a', email: 'trainer@example.test', role: 'trainer', status: 'pending' },
      delivery: { acceptUrl },
    })
    const wrapper = await mountView('owner')
    await wrapper.get('#invitation-email').setValue('Trainer@Example.test')
    await wrapper.get('#invitation-role').setValue('trainer')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.createInvitation).toHaveBeenCalledWith('studio-a', {
      email: 'trainer@example.test',
      role: 'trainer',
    })
    expect(wrapper.get('.studio-delivery').text()).toContain(acceptUrl)
    expect(Object.values(localStorage)).not.toContain(acceptUrl)
    wrapper.unmount()
  })

  it('drops an in-flight invitation result and its bearer link after a studio switch', async () => {
    let resolveInvitation
    api.createInvitation.mockReturnValue(new Promise((resolve) => { resolveInvitation = resolve }))
    const wrapper = await mountView('owner')
    await wrapper.get('#invitation-email').setValue('tenant-a@example.test')
    await wrapper.get('form').trigger('submit')

    await wrapper.vm.$router.push('/studios/studio-b/invitations')
    await flushPromises()
    expect(wrapper.find('.studio-delivery').exists()).toBe(false)

    resolveInvitation({
      invitation: { id: 'invitation-a', email: 'tenant-a@example.test', role: 'trainer', status: 'pending' },
      delivery: { acceptUrl: 'http://127.0.0.1:4173/invitations/tenant-a-secret' },
    })
    await flushPromises()

    expect(api.createInvitation).toHaveBeenCalledWith('studio-a', expect.any(Object))
    expect(wrapper.find('.studio-delivery').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('tenant-a@example.test')
    expect(wrapper.text()).not.toContain('tenant-a-secret')
    wrapper.unmount()
  })

  it('offers admin invitations to owners but only trainer/member to admins', async () => {
    let wrapper = await mountView('owner')
    expect(wrapper.get('#invitation-role').find('option[value="admin"]').exists()).toBe(true)
    wrapper.unmount()

    clearStudioContext()
    wrapper = await mountView('admin')
    expect(wrapper.get('#invitation-role').find('option[value="admin"]').exists()).toBe(false)
    expect(wrapper.get('#invitation-role').find('option[value="trainer"]').exists()).toBe(true)
    expect(wrapper.get('#invitation-role').find('option[value="member"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows a neutral label when a completed invitation email is redacted', async () => {
    api.listInvitations.mockResolvedValue({
      invitations: [{ id: 'invitation-old', email: null, role: 'member', status: 'accepted' }],
      pagination: { total: 1 },
    })
    const wrapper = await mountView('owner')

    expect(wrapper.text()).toContain('E-Mail nach Abschluss redigiert')
    wrapper.unmount()
  })

  it('keeps the authenticated session when invitation creation is forbidden', async () => {
    api.createInvitation.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    const wrapper = await mountView('owner')
    await wrapper.get('#invitation-email').setValue('blocked@example.test')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Rolle')
    expect(authToken.value).toBe('token')
    wrapper.unmount()
  })
})
