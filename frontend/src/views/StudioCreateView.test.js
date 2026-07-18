import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({ createStudio: vi.fn() }))
vi.mock('../utils/studioApi', () => api)

import StudioCreateView from './StudioCreateView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { activeStudioId, clearStudioContext } from '../utils/studioContext'

const createdStudio = {
  id: 'studio-created',
  name: 'Northside Training',
  slug: 'northside-training',
  status: 'active',
  defaultLocale: 'de',
  defaultTimezone: 'Europe/Zurich',
  defaultWeightUnit: 'kg',
  membership: { id: 'membership-owner', role: 'owner', status: 'active' },
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/new', name: 'studio-create', component: StudioCreateView },
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/new')
  await router.isReady()
  return { router, wrapper: mount(StudioCreateView, { global: { plugins: [router] } }) }
}

describe('StudioCreateView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'owner-token'
    authUser.value = { id: 1, username: 'Owner' }
    locale.value = 'de'
    api.createStudio.mockReset()
    api.createStudio.mockResolvedValue({ studio: createdStudio })
  })

  it('creates a bounded studio payload and selects the returned studio', async () => {
    const { router, wrapper } = await mountView()
    await wrapper.get('#studio-name').setValue('Northside Training')
    await wrapper.get('#studio-slug').setValue('Northside Training!')
    await wrapper.get('#studio-locale').setValue('en')
    await wrapper.get('#studio-timezone').setValue('Europe/Zurich')
    await wrapper.get('#studio-weight-unit').setValue('lb')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.createStudio).toHaveBeenCalledWith({
      name: 'Northside Training',
      slug: 'northside-training',
      defaultLocale: 'en',
      defaultTimezone: 'Europe/Zurich',
      defaultWeightUnit: 'lb',
    })
    expect(activeStudioId.value).toBe('studio-created')
    expect(router.currentRoute.value.params.studioId).toBe('studio-created')
  })
})
