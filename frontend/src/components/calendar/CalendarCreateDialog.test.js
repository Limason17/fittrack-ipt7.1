import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../../utils/i18n'
import CalendarCreateDialog from './CalendarCreateDialog.vue'

const TODAY = '2026-07-26'

// CalendarCreateDialog renders via Modal.vue's <Teleport to="body">, so its
// content lands as a sibling of the mounted component in the real document,
// not inside wrapper.element - queried directly here, matching the existing
// dialogButton() convention in views/WorkoutSessionView.test.js.
function dialogRoot() {
  return document.querySelector('[role="dialog"]')
}

function dialogButton(label) {
  return [...dialogRoot().querySelectorAll('button')].find((button) => button.textContent.includes(label))
}

function dialogText() {
  return dialogRoot()?.textContent || ''
}

async function setValue(element, value) {
  element.value = value
  element.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function setChecked(element, checked) {
  element.checked = checked
  element.dispatchEvent(new Event('change'))
  await flushPromises()
}

async function submitForm() {
  dialogRoot().querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

function titleInput() {
  return dialogRoot().querySelector('input[type="text"]')
}

function dateInput() {
  return dialogRoot().querySelector('input[type="date"]')
}

function notesTextarea() {
  return dialogRoot().querySelector('textarea')
}

function checkbox() {
  return dialogRoot().querySelector('input[type="checkbox"]')
}

let wrapper

function mountDialog(overrides = {}) {
  wrapper = mount(CalendarCreateDialog, {
    attachTo: document.body,
    props: { open: true, defaultDate: TODAY, today: TODAY, busy: false, ...overrides },
  })
  return wrapper
}

describe('CalendarCreateDialog', () => {
  beforeEach(() => {
    locale.value = 'de'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('defaults the date field to defaultDate and shows the "today" hint plus the planAsUpcoming option', () => {
    mountDialog()
    expect(dateInput().value).toBe(TODAY)
    expect(dialogText()).toContain('wird dieses Training standardmäßig als abgeschlossen gespeichert')
    expect(checkbox()).toBeTruthy()
  })

  it('shows the future hint and hides planAsUpcoming for a future date', async () => {
    mountDialog()
    await setValue(dateInput(), '2026-08-15')
    expect(dialogText()).toContain('liegt in der Zukunft und wird als geplant gespeichert')
    expect(checkbox()).toBeFalsy()
  })

  it('shows the past hint and hides planAsUpcoming for a past date', async () => {
    mountDialog()
    await setValue(dateInput(), '2026-01-01')
    expect(dialogText()).toContain('liegt in der Vergangenheit und wird als abgeschlossen gespeichert')
    expect(checkbox()).toBeFalsy()
  })

  it('submits a future entry with planAsUpcoming always false', async () => {
    const wrapper = mountDialog()
    await setValue(titleInput(), 'Push Day')
    await setValue(dateInput(), '2026-08-15')
    await submitForm()
    expect(wrapper.emitted('submit')[0][0]).toEqual({
      scheduledDate: '2026-08-15', title: 'Push Day', notes: null, planAsUpcoming: false,
    })
  })

  it('submits a today entry with the checked planAsUpcoming value', async () => {
    const wrapper = mountDialog()
    await setValue(titleInput(), 'Today Workout')
    await setChecked(checkbox(), true)
    await submitForm()
    expect(wrapper.emitted('submit')[0][0]).toMatchObject({ scheduledDate: TODAY, planAsUpcoming: true })
  })

  it('ignores planAsUpcoming for a past date even if somehow set', async () => {
    const wrapper = mountDialog()
    await setValue(titleInput(), 'Past Workout')
    await setValue(dateInput(), '2026-01-01')
    await submitForm()
    expect(wrapper.emitted('submit')[0][0]).toMatchObject({ planAsUpcoming: false })
  })

  it('rejects an empty title with an inline, translated error and does not emit submit', async () => {
    const wrapper = mountDialog()
    await setValue(dateInput(), '2026-08-15')
    await submitForm()
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(dialogText()).toContain('Bitte gib einen Titel ein.')
  })

  it('rejects a title longer than 160 characters', async () => {
    const wrapper = mountDialog()
    await setValue(titleInput(), 'x'.repeat(161))
    await setValue(dateInput(), '2026-08-15')
    await submitForm()
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(dialogText()).toContain('höchstens 160 Zeichen')
  })

  it('rejects notes longer than 255 characters', async () => {
    const wrapper = mountDialog()
    await setValue(titleInput(), 'Push Day')
    await setValue(dateInput(), '2026-08-15')
    await setValue(notesTextarea(), 'x'.repeat(256))
    await submitForm()
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(dialogText()).toContain('höchstens 255 Zeichen')
  })

  it('trims the title and sends null (not an empty string) when notes are blank', async () => {
    const wrapper = mountDialog()
    await setValue(titleInput(), '  Push Day  ')
    await setValue(dateInput(), '2026-08-15')
    await submitForm()
    expect(wrapper.emitted('submit')[0][0]).toMatchObject({ title: 'Push Day', notes: null })
  })

  it('disables the submit button while busy', () => {
    mountDialog({ busy: true })
    const submit = [...dialogRoot().querySelectorAll('button')].find((button) => button.type === 'submit')
    expect(submit.disabled).toBe(true)
  })

  it('resets its fields every time it is reopened', async () => {
    const wrapper = mountDialog({ open: false })
    await wrapper.setProps({ open: true })
    await setValue(titleInput(), 'Leftover title')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true, defaultDate: TODAY })
    expect(titleInput().value).toBe('')
  })

  it('emits close when cancel is clicked', async () => {
    const wrapper = mountDialog()
    dialogButton('Abbrechen').click()
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
