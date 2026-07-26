import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../../utils/i18n'
import CalendarFilters from './CalendarFilters.vue'

describe('CalendarFilters', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  it('renders source tabs and a status select with the current values', () => {
    const wrapper = mount(CalendarFilters, { props: { source: 'personal', status: 'PLANNED' } })
    const activeTab = wrapper.findAll('[role="tab"]').find((tab) => tab.attributes('aria-selected') === 'true')
    expect(activeTab.text()).toBe('Persönlich')
    expect(wrapper.find('select').element.value).toBe('PLANNED')
  })

  it('emits update:source when a different source tab is clicked', async () => {
    const wrapper = mount(CalendarFilters, { props: { source: 'all', status: 'all' } })
    const studioTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === 'Studio')
    await studioTab.trigger('click')
    expect(wrapper.emitted('update:source')).toEqual([['studio']])
  })

  it('emits update:status when the status select changes', async () => {
    const wrapper = mount(CalendarFilters, { props: { source: 'all', status: 'all' } })
    const select = wrapper.find('select')
    await select.setValue('COMPLETED')
    expect(wrapper.emitted('update:status')).toEqual([['COMPLETED']])
  })

  function resetButton(wrapper) {
    return wrapper.findAll('button[type="button"]').find((button) => !button.attributes('role'))
  }

  it('the reset button is disabled exactly when both filters are already at their default', async () => {
    const wrapper = mount(CalendarFilters, { props: { source: 'all', status: 'all' } })
    expect(resetButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.setProps({ source: 'personal', status: 'all' })
    expect(resetButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('emits reset when the reset button is clicked', async () => {
    const wrapper = mount(CalendarFilters, { props: { source: 'studio', status: 'all' } })
    await resetButton(wrapper).trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)
  })

  it('lists every known display status as a status option', () => {
    const wrapper = mount(CalendarFilters, { props: { source: 'all', status: 'all' } })
    const options = wrapper.findAll('option').map((option) => option.element.value)
    expect(options).toEqual(
      expect.arrayContaining(['PLANNED', 'DUE_TODAY', 'OVERDUE', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED'])
    )
  })
})
