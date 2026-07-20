import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FeedbackForm from './FeedbackForm.vue'
import { locale } from '../../utils/i18n'

let wrapper

function mountForm(props = {}) {
  wrapper = mount(FeedbackForm, { props })
  return wrapper
}

describe('FeedbackForm', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('disables submit for empty input and does not emit', async () => {
    mountForm()
    const button = wrapper.get('button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('disables submit for whitespace-only input', async () => {
    mountForm()
    await wrapper.get('textarea').setValue('    ')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('emits submit with the trimmed body for valid input', async () => {
    mountForm()
    await wrapper.get('textarea').setValue('  Great effort today!  ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([['Great effort today!']])
  })

  it('shows a live character count', async () => {
    mountForm({ maxLength: 2000 })
    await wrapper.get('textarea').setValue('Hello')
    expect(wrapper.text()).toContain('5 / 2000')
  })

  it('disables the textarea and submit button while submitting, providing multi-click protection', async () => {
    mountForm({ isSubmitting: true })
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('shows a passed-in error message without clearing the drafted text', async () => {
    mountForm({ errorMessage: 'Network error, please retry.' })
    await wrapper.get('textarea').setValue('My feedback text')
    await wrapper.setProps({ errorMessage: 'Network error, please retry.' })
    expect(wrapper.text()).toContain('Network error, please retry.')
    expect(wrapper.get('textarea').element.value).toBe('My feedback text')
  })

  it('clears the textarea only when the exposed clear() method is called', async () => {
    mountForm()
    await wrapper.get('textarea').setValue('Some feedback')
    expect(wrapper.get('textarea').element.value).toBe('Some feedback')
    wrapper.vm.clear()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('textarea').element.value).toBe('')
  })

  it('exposes the backend limit via the maxlength attribute and blocks submit if it is exceeded anyway', async () => {
    mountForm({ maxLength: 10 })
    expect(wrapper.get('textarea').attributes('maxlength')).toBe('10')

    // setValue writes the DOM value directly and bypasses the browser's own maxlength
    // enforcement (which only applies to real typing), so canSubmit must reject it itself.
    await wrapper.get('textarea').setValue('12345678901234')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })
})
