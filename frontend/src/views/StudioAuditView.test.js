import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({ listAuditEvents: vi.fn(), listStudios: vi.fn() }))
vi.mock('../utils/studioApi', () => api)

import StudioAuditView from './StudioAuditView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

let wrapper

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
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
      { path: '/studios/:studioId/access-denied', name: 'studio-access-denied', component: { template: '<div />' } },
      { path: '/studios/:studioId/audit', name: 'studio-audit', component: StudioAuditView },
    ],
  })
  await router.push('/studios/studio-a/audit')
  await router.isReady()
  wrapper = mount(StudioAuditView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('StudioAuditView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Owner' }
    locale.value = 'de'
    api.listAuditEvents.mockReset()
    api.listStudios.mockReset()
    api.listStudios.mockResolvedValue({ studios: [studio('owner')] })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('renders audit events with a readable label, actor and target', async () => {
    api.listAuditEvents.mockResolvedValue({
      auditEvents: [
        {
          id: 'event-1',
          eventType: 'membership.role_changed',
          targetType: 'membership',
          targetId: 'membership-x',
          actor: { username: 'Owner' },
          createdAt: '2026-07-18T10:00:00.000Z',
        },
      ],
      pagination: { total: 1, page: 1, totalPages: 1 },
    })
    await mountView('owner')

    expect(wrapper.text()).toContain('Rolle geändert')
    expect(wrapper.text()).toContain('Owner')
  })

  it('shows an empty state when there are no audit events', async () => {
    api.listAuditEvents.mockResolvedValue({ auditEvents: [], pagination: { total: 0, page: 1, totalPages: 0 } })
    await mountView('owner')

    expect(wrapper.text()).toContain('Noch keine Audit-Ereignisse vorhanden.')
  })

  it('shows a permission-denied message for a forbidden audit request', async () => {
    api.listAuditEvents.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    await mountView('owner')

    expect(wrapper.get('[role="alert"]').text()).toContain('Rolle')
  })
})
