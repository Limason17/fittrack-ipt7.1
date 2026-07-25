import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const api = vi.hoisted(() => ({ acceptInvitation: vi.fn() }))
vi.mock('../utils/studioApi', () => api)

import InvitationAcceptView from './InvitationAcceptView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { clearStudioContext } from '../utils/studioContext'

let wrapper

async function mountView(token = 'a-valid-looking-token') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/studios/:studioId', name: 'studio-dashboard', component: { template: '<div />' } },
      { path: '/invitations/:token', name: 'invitation-accept', component: InvitationAcceptView },
    ],
  })
  await router.push(`/invitations/${token}`)
  await router.isReady()
  wrapper = mount(InvitationAcceptView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('InvitationAcceptView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Member' }
    locale.value = 'de'
    api.acceptInvitation.mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('shows a specific, understandable message for each accept failure code instead of a raw code', async () => {
    const cases = [
      ['INVITATION_INVALID', 'ungültig'],
      ['INVITATION_EXPIRED', 'abgelaufen'],
      ['INVITATION_REVOKED', 'widerrufen'],
      ['INVITATION_ALREADY_USED', 'bereits verwendet'],
    ]
    for (const [code, expectedText] of cases) {
      api.acceptInvitation.mockReset()
      api.acceptInvitation.mockRejectedValue(
        Object.assign(new Error('failed'), { status: 409, data: { error: { code, message: 'failed' } } })
      )
      const view = await mountView(`token-for-${code}`)
      await view.get('button.btn-primary').trigger('click')
      await flushPromises()

      expect(view.get('[role="alert"]').text()).toContain(expectedText)
      expect(view.text()).not.toContain(code)
      view.unmount()
    }
  })

  it('shows the forbidden message for a 403 without leaking the backend code', async () => {
    api.acceptInvitation.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403, data: { error: { code: 'INVITATION_INVALID' } } }))
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('angemeldeten Konto nicht angenommen')
  })

  it('falls back to the generic message for an unmapped error code', async () => {
    api.acceptInvitation.mockRejectedValue(Object.assign(new Error('failed'), { status: 500, data: { error: { code: 'SOME_UNMAPPED_CODE' } } }))
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('ungültig, abgelaufen oder nicht mehr verfügbar')
    expect(wrapper.text()).not.toContain('SOME_UNMAPPED_CODE')
  })

  it('disables the accept button while the request is in flight to prevent double submission', async () => {
    let resolveAccept
    api.acceptInvitation.mockReturnValue(new Promise((resolve) => { resolveAccept = resolve }))
    await mountView()
    const button = wrapper.get('button.btn-primary')
    await button.trigger('click')

    expect(button.attributes('disabled')).toBeDefined()
    expect(api.acceptInvitation).toHaveBeenCalledTimes(1)
    await button.trigger('click')
    expect(api.acceptInvitation).toHaveBeenCalledTimes(1)

    resolveAccept({ studio: { id: 'studio-a' }, membership: { id: 'membership-a', role: 'member', status: 'active' } })
    await flushPromises()
  })
})
