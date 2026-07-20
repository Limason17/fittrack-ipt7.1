import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  const wrapper = mount(StudioInvitationsView, { global: { plugins: [router] }, attachTo: document.body })
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

  afterEach(() => {
    document.body.innerHTML = ''
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

  it('asks for confirmation before revoking a pending invitation', async () => {
    api.listInvitations.mockResolvedValue({
      invitations: [{ id: 'invitation-pending', email: 'pending@example.test', role: 'member', status: 'pending', expiresAt: '2026-08-01T00:00:00.000Z' }],
      pagination: { total: 1 },
    })
    const wrapper = await mountView('owner')
    await wrapper.get('.btn-danger').trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain('Einladung widerrufen?')
    expect(dialog.textContent).toContain('pending@example.test')
    expect(api.revokeInvitation).not.toHaveBeenCalled()

    const confirmButton = [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('Widerrufen'))
    api.revokeInvitation.mockResolvedValue({})
    confirmButton.click()
    await flushPromises()

    expect(api.revokeInvitation).toHaveBeenCalledWith('studio-a', 'invitation-pending')
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

  it('confirms a production e-mail send without showing any preview link or token', async () => {
    api.createInvitation.mockResolvedValue({
      invitation: { id: 'invitation-sent', email: 'trainer@example.test', role: 'trainer', status: 'pending' },
      delivery: { delivered: true },
    })
    const wrapper = await mountView('owner')
    await wrapper.get('#invitation-email').setValue('trainer@example.test')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('versendet')
    expect(wrapper.find('.studio-delivery').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('token')
    expect(wrapper.text()).not.toMatch(/invitations\/[A-Za-z0-9_-]{20,}/)
    wrapper.unmount()
  })

  it('shows a safe, understandable error and keeps the e-mail address when delivery fails, without logging out', async () => {
    api.createInvitation.mockRejectedValue(Object.assign(new Error('Bad Gateway'), { status: 502, code: 'INVITATION_DELIVERY_FAILED' }))
    const wrapper = await mountView('owner')
    await wrapper.get('#invitation-email').setValue('retry-me@example.test')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text().length).toBeGreaterThan(0)
    expect(alert.text()).not.toMatch(/smtp|ECONNREFUSED|EAUTH|stack/i)
    expect(wrapper.get('#invitation-email').element.value).toBe('retry-me@example.test')
    expect(wrapper.find('.studio-delivery').exists()).toBe(false)
    expect(authToken.value).toBe('token')
    wrapper.unmount()
  })

  it('shows the same safe error and preserves the form when the provider is unavailable (503)', async () => {
    api.createInvitation.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { status: 503, code: 'INVITATION_DELIVERY_UNAVAILABLE' }))
    const wrapper = await mountView('owner')
    await wrapper.get('#invitation-email').setValue('unavailable@example.test')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text().length).toBeGreaterThan(0)
    expect(wrapper.get('#invitation-email').element.value).toBe('unavailable@example.test')
    expect(authToken.value).toBe('token')
    wrapper.unmount()
  })

  it('still lists existing invitations correctly alongside the new delivery contract', async () => {
    api.listInvitations.mockResolvedValue({
      invitations: [{ id: 'invitation-x', email: 'existing@example.test', role: 'member', status: 'pending', expiresAt: '2026-08-01T00:00:00.000Z' }],
      pagination: { total: 1 },
    })
    const wrapper = await mountView('owner')
    expect(wrapper.text()).toContain('existing@example.test')
    wrapper.unmount()
  })
})
