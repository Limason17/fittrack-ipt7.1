import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({
  getStudio: vi.fn(),
  updateStudio: vi.fn(),
}))
vi.mock('../utils/studioApi', () => api)

import StudioSettingsView from './StudioSettingsView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

function studio(id, name) {
  return {
    id,
    name,
    slug: id,
    status: 'active',
    defaultLocale: 'de',
    defaultTimezone: 'Europe/Zurich',
    defaultWeightUnit: 'kg',
    membership: { id: `membership-${id}`, role: 'owner', status: 'active' },
  }
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
      { path: '/studios/:studioId/settings', name: 'studio-settings', component: StudioSettingsView },
      { path: '/studios/:studioId/members', name: 'studio-members', component: { template: '<div />' } },
      { path: '/studios/:studioId/invitations', name: 'studio-invitations', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/settings')
  await router.isReady()
  const wrapper = mount(StudioSettingsView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('StudioSettingsView tenant transitions', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Owner' }
    locale.value = 'de'
    addAndSelectStudio(studio('studio-a', 'Tenant A'))
    api.getStudio.mockReset()
    api.updateStudio.mockReset()
    api.getStudio.mockImplementation(async (id) => ({
      studio: id === 'studio-a' ? studio('studio-a', 'Tenant A') : studio('studio-b', 'Tenant B'),
    }))
  })

  it('does not render a stale save response under a new studio route', async () => {
    let resolveUpdate
    api.updateStudio.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    const wrapper = await mountView()
    await wrapper.get('#settings-name').setValue('Tenant A edited')
    await wrapper.get('form').trigger('submit')

    await wrapper.vm.$router.push('/studios/studio-b/settings')
    await flushPromises()
    expect(wrapper.get('#settings-name').element.value).toBe('Tenant B')

    resolveUpdate({ studio: studio('studio-a', 'Tenant A stale response') })
    await flushPromises()

    expect(wrapper.get('#settings-name').element.value).toBe('Tenant B')
    expect(wrapper.text()).not.toContain('Tenant A stale response')
    wrapper.unmount()
  })
})
