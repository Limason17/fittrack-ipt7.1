import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import StudioSwitcher from './StudioSwitcher.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import {
  activeStudioId,
  addAndSelectStudio,
  clearStudioContext,
  selectStudio,
} from '../utils/studioContext'

const studio = {
  id: 'studio-a',
  name: 'Studio A',
  slug: 'studio-a',
  status: 'active',
  membership: { id: 'membership-a', role: 'owner', status: 'active' },
}

async function mountedSwitcher() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount({
    components: { StudioSwitcher },
    template: '<StudioSwitcher /><StudioSwitcher compact />',
  }, { global: { plugins: [router] } })
  return { router, wrapper }
}

describe('StudioSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'test-token'
    authUser.value = { id: 1, username: 'Owner' }
    locale.value = 'de'
    addAndSelectStudio(studio)
    selectStudio(null)
  })

  it('renders personal plus authorized studios with unique labels', async () => {
    const { wrapper } = await mountedSwitcher()
    const selects = wrapper.findAll('select')

    expect(selects).toHaveLength(2)
    expect(selects[0].element.id).not.toBe(selects[1].element.id)
    expect(selects[0].findAll('option').map((option) => option.text())).toEqual([
      'Persönlicher Bereich',
      'Studio A — Eigentümer:in',
    ])
    expect(selects[0].element.value).toBe('')
  })

  it('switches explicitly and returns to personal context', async () => {
    const { router, wrapper } = await mountedSwitcher()
    const select = wrapper.find('select')

    await select.setValue('studio-a')
    await flushPromises()
    expect(activeStudioId.value).toBe('studio-a')
    expect(router.currentRoute.value.name).toBe('studio-dashboard')

    await select.setValue('')
    await flushPromises()
    expect(activeStudioId.value).toBeNull()
    expect(router.currentRoute.value.name).toBe('home')
  })
})
