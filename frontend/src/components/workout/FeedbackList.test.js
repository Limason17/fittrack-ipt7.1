import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FeedbackList from './FeedbackList.vue'
import { locale } from '../../utils/i18n'

let wrapper

describe('FeedbackList', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('shows the empty state title when there are no entries', () => {
    wrapper = mount(FeedbackList, { props: { entries: [], emptyTitle: 'Noch kein Feedback vorhanden.' } })
    expect(wrapper.text()).toContain('Noch kein Feedback vorhanden.')
  })

  it('renders each entry with coach display name, timestamp and body as plain text', () => {
    wrapper = mount(FeedbackList, {
      props: {
        entries: [
          { id: 'fb-1', coach: { membershipId: 'm-1', displayName: 'Trainer Tom' }, body: 'Great squat depth!', createdAt: '2026-07-01T10:00:00.000Z' },
          { id: 'fb-2', coach: { membershipId: 'm-1', displayName: 'Trainer Tom' }, body: 'Keep it up.', createdAt: '2026-07-02T10:00:00.000Z' },
        ],
        emptyTitle: 'Noch kein Feedback vorhanden.',
      },
    })
    expect(wrapper.findAll('.feedback-entry')).toHaveLength(2)
    expect(wrapper.text()).toContain('Trainer Tom')
    expect(wrapper.text()).toContain('Great squat depth!')
    expect(wrapper.text()).toContain('Keep it up.')
  })

  it('never renders feedback body as HTML, even if it contains markup', () => {
    wrapper = mount(FeedbackList, {
      props: {
        entries: [
          { id: 'fb-1', coach: { membershipId: 'm-1', displayName: 'Trainer Tom' }, body: '<script>alert(1)</script>', createdAt: '2026-07-01T10:00:00.000Z' },
        ],
        emptyTitle: 'Noch kein Feedback vorhanden.',
      },
    })
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('.feedback-entry-body').text()).toBe('<script>alert(1)</script>')
  })
})
