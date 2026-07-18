import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/api', () => ({ apiRequest: vi.fn().mockResolvedValue({}) }))

import ProfileView from './ProfileView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { distanceUnit, weightUnit } from '../utils/units'

let wrapper

describe('ProfileView', () => {
  beforeEach(() => {
    localStorage.clear()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Ada Lovelace', email: 'ada@example.test' }
    locale.value = 'de'
    weightUnit.value = 'kg'
    distanceUnit.value = 'km'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('shows account details on the account tab', () => {
    wrapper = mount(ProfileView)

    expect(wrapper.text()).toContain('Ada Lovelace')
    expect(wrapper.text()).toContain('ada@example.test')
  })

  it('switches to the preferences tab and updates the weight unit', async () => {
    wrapper = mount(ProfileView)
    const preferencesTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === 'Anzeige')
    await preferencesTab.trigger('click')
    await flushPromises()

    const lbButton = wrapper.findAll('button').find((button) => button.text() === 'lb')
    await lbButton.trigger('click')
    await flushPromises()

    expect(weightUnit.value).toBe('lb')
  })
})
