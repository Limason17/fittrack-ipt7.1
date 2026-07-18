import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({
  listMemberships: vi.fn(),
  updateMembership: vi.fn(),
}))
vi.mock('../utils/studioApi', () => api)

import StudioMembersView from './StudioMembersView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

const memberships = [
  {
    id: 'membership-owner',
    role: 'owner',
    status: 'active',
    user: { username: 'Studio Owner', email: 'owner@example.test' },
  },
  {
    id: 'membership-trainer',
    role: 'trainer',
    status: 'active',
    user: { username: 'Studio Trainer', email: 'trainer@example.test' },
  },
  {
    id: 'membership-left',
    role: 'member',
    status: 'left',
    user: null,
    email: null,
  },
]

function studio(role) {
  return {
    id: 'studio-a',
    name: 'Studio A',
    slug: 'studio-a',
    status: 'active',
    membership: { id: `actor-${role}`, role, status: 'active' },
  }
}

async function mountView(actorRole) {
  addAndSelectStudio(studio(actorRole))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
      { path: '/studios/:studioId/settings', name: 'studio-settings', component: { template: '<div />' } },
      { path: '/studios/:studioId/members', name: 'studio-members', component: StudioMembersView },
      { path: '/studios/:studioId/invitations', name: 'studio-invitations', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/members')
  await router.isReady()
  const wrapper = mount(StudioMembersView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('StudioMembersView role controls', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Actor' }
    locale.value = 'de'
    api.listMemberships.mockReset()
    api.updateMembership.mockReset()
    api.listMemberships.mockResolvedValue({ memberships, pagination: { total: 3 } })
  })

  it('allows owners to assign all roles and explicitly mark a membership left', async () => {
    const wrapper = await mountView('owner')
    const trainerRow = wrapper.findAll('.studio-list-row')[1]
    const roleValues = trainerRow.findAll('select')[0].findAll('option').map((option) => option.element.value)
    const statusValues = trainerRow.findAll('select')[1].findAll('option').map((option) => option.element.value)

    expect(roleValues).toEqual(['owner', 'admin', 'trainer', 'member'])
    expect(statusValues).toEqual(['active', 'suspended', 'left'])
    wrapper.unmount()
  })

  it('prevents admins from editing owner/admin targets or assigning elevated roles', async () => {
    const wrapper = await mountView('admin')
    const [ownerRow, trainerRow] = wrapper.findAll('.studio-list-row')

    expect(ownerRow.findAll('select').every((select) => select.element.disabled)).toBe(true)
    expect(ownerRow.get('button').element.disabled).toBe(true)
    expect(trainerRow.findAll('select')[0].findAll('option').map((option) => option.element.value))
      .toEqual(['trainer', 'member'])
    expect(trainerRow.findAll('select')[0].element.disabled).toBe(false)
    wrapper.unmount()
  })

  it('renders left memberships without retained identity assumptions', async () => {
    const wrapper = await mountView('owner')

    expect(wrapper.text()).toContain('Ehemaliges Mitglied')
    expect(wrapper.text()).toContain('Identität aus Datenschutzgründen nicht mehr verfügbar')
    wrapper.unmount()
  })

  it('ignores an in-flight membership response after switching studios', async () => {
    let resolveUpdate
    api.updateMembership.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    api.listMemberships
      .mockResolvedValueOnce({ memberships, pagination: { total: 3 } })
      .mockResolvedValueOnce({
        memberships: [{
          id: 'membership-b',
          role: 'member',
          status: 'active',
          user: { username: 'Tenant B Member', email: 'tenant-b@example.test' },
        }],
        pagination: { total: 1 },
      })
    const wrapper = await mountView('owner')
    await wrapper.findAll('.studio-list-row')[1].get('button').trigger('click')

    await wrapper.vm.$router.push('/studios/studio-b/members')
    await flushPromises()
    expect(wrapper.text()).toContain('tenant-b@example.test')

    resolveUpdate({
      membership: {
        id: 'membership-trainer',
        role: 'member',
        status: 'active',
        user: { username: 'Tenant A Result', email: 'tenant-a@example.test' },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('tenant-b@example.test')
    expect(wrapper.text()).not.toContain('tenant-a@example.test')
    wrapper.unmount()
  })
})
