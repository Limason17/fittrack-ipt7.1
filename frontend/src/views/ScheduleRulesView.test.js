import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const trainingApi = vi.hoisted(() => ({
  getProgramAssignment: vi.fn(),
  listProgramVersions: vi.fn(),
  getProgramVersion: vi.fn(),
  listScheduleRules: vi.fn(),
  createScheduleRule: vi.fn(),
  updateScheduleRule: vi.fn(),
}))
vi.mock('../utils/studioTrainingApi', () => trainingApi)

const toast = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock('../utils/toast', () => toast)

import ScheduleRulesView from './ScheduleRulesView.vue'
import { authToken, authUser } from '../utils/auth'
import { locale } from '../utils/i18n'
import { addAndSelectStudio, clearStudioContext } from '../utils/studioContext'

function studio(role) {
  return {
    id: 'studio-a',
    name: 'Studio A',
    slug: 'studio-a',
    status: 'active',
    membership: { id: `actor-${role}`, role, status: 'active' },
  }
}

const assignment = {
  id: 'assignment-1',
  status: 'active',
  program: { id: 'program-1', name: 'Beginner Strength', description: null },
  programVersion: { versionNumber: 2, status: 'published' },
  member: { membershipId: 'member-1', displayName: 'Member One' },
  startsOn: '2026-01-01',
  endsOn: null,
  assignedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
}

const versions = {
  programVersions: [
    { id: 'version-1', versionNumber: 1, status: 'retired' },
    { id: 'version-2', versionNumber: 2, status: 'published' },
  ],
}

const versionDetail = {
  programVersion: {
    id: 'version-2',
    versionNumber: 2,
    status: 'published',
    days: [
      { id: 'day-1', position: 1, name: 'Push Day', instructions: null, exercises: [{ id: 'ex-1' }, { id: 'ex-2' }] },
      { id: 'day-2', position: 2, name: 'Pull Day', instructions: null, exercises: [] },
    ],
  },
}

function rule(overrides = {}) {
  return {
    id: 'rule-1',
    assignmentId: 'assignment-1',
    programDay: { id: 'day-1', name: 'Push Day' },
    weekday: 0,
    weekInterval: 1,
    anchorDate: '2026-08-10',
    activeFrom: '2026-08-10',
    activeUntil: null,
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

let wrapper

function dialogRoot() {
  return document.querySelector('[role="dialog"]')
}

function dialogButton(label) {
  const root = dialogRoot()
  if (!root) return undefined
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === label)
}

// Modal.vue renders via <Teleport to="body">, so its content is never part
// of `wrapper`'s own component tree and `wrapper.find()` cannot see it (see
// the identical convention in CalendarView.test.js) - dialog form fields are
// set directly on the DOM element instead.
function setDialogField(selector, value, eventType = 'input') {
  const field = dialogRoot().querySelector(selector)
  field.value = value
  field.dispatchEvent(new Event(eventType))
}

function submitDialogForm() {
  dialogRoot().querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
}

async function mountView(actorRole = 'owner') {
  addAndSelectStudio(studio(actorRole))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/studios/:studioId/program-assignments/:assignmentId/schedule',
        name: 'studio-assignment-schedule',
        component: ScheduleRulesView,
      },
      { path: '/studios/:studioId/assignments', name: 'studio-program-assignments', component: { template: '<div />' } },
      { path: '/studios', name: 'studios', component: { template: '<div />' } },
      { path: '/studios/:studioId/access-denied', name: 'studio-access-denied', component: { template: '<div />' } },
    ],
  })
  await router.push('/studios/studio-a/program-assignments/assignment-1/schedule')
  await router.isReady()
  wrapper = mount(ScheduleRulesView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('ScheduleRulesView', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStudioContext()
    authToken.value = 'token'
    authUser.value = { id: 1, username: 'Actor' }
    locale.value = 'de'
    Object.values(trainingApi).forEach((fn) => fn.mockReset())
    toast.toastSuccess.mockReset()
    toast.toastError.mockReset()
    trainingApi.getProgramAssignment.mockResolvedValue({ programAssignment: assignment })
    trainingApi.listProgramVersions.mockResolvedValue(versions)
    trainingApi.getProgramVersion.mockResolvedValue(versionDetail)
    trainingApi.listScheduleRules.mockResolvedValue({ scheduleRules: [rule()] })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('loads the assignment header with member, program, version and the required hint text', async () => {
    await mountView()
    expect(wrapper.text()).toContain('Member One')
    expect(wrapper.text()).toContain('Beginner Strength')
    expect(wrapper.text()).toContain('Version 2')
    expect(wrapper.text()).toContain(
      'Geplante Trainingstage erscheinen automatisch im persönlichen Kalender des Members. Sie gelten erst nach Abschluss oder ausdrücklicher Bestätigung als abgeschlossen.'
    )
  })

  it('resolves the program day dropdown via the assigned published version only, never the retired one', async () => {
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    expect(trainingApi.getProgramVersion).toHaveBeenCalledWith('studio-a', 'program-1', 'version-2')
  })

  it('shows the empty state with a call to action when there are no rules yet', async () => {
    trainingApi.listScheduleRules.mockResolvedValue({ scheduleRules: [] })
    await mountView()
    expect(wrapper.text()).toContain('Für diese Zuweisung sind noch keine Trainingstage terminiert.')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Trainingstag planen')).toBe(true)
  })

  it('renders a human-readable summary instead of raw technical fields', async () => {
    await mountView()
    expect(wrapper.text()).toContain('Jede Woche am Montag, ab 10.08.2026')
    expect(wrapper.text()).not.toContain('anchorDate')
  })

  it('sorts active rules before disabled rules, then by weekday', async () => {
    trainingApi.listScheduleRules.mockResolvedValue({
      scheduleRules: [
        rule({ id: 'rule-disabled', status: 'disabled', weekday: 0 }),
        rule({ id: 'rule-wed', weekday: 2 }),
        rule({ id: 'rule-mon', weekday: 0 }),
      ],
    })
    await mountView()
    const rows = wrapper.findAll('tbody tr').map((row) => row.attributes('data-rule-row'))
    expect(rows).toEqual(['rule-mon', 'rule-wed', 'rule-disabled'])
  })

  it('marks a disabled rule distinctly and offers no reactivation action', async () => {
    trainingApi.listScheduleRules.mockResolvedValue({ scheduleRules: [rule({ status: 'disabled' })] })
    await mountView()
    expect(wrapper.text()).toContain('Deaktiviert')
    const row = wrapper.find('[data-rule-row="rule-1"]')
    expect(row.findAll('button').some((b) => b.text() === 'Deaktivieren')).toBe(false)
    expect(row.findAll('button').some((b) => b.text() === 'Bearbeiten')).toBe(true)
  })

  it('creates a rule with a consistent anchorDate rolled forward to the chosen weekday', async () => {
    trainingApi.createScheduleRule.mockResolvedValue({ scheduleRule: rule({ id: 'rule-new' }) })
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()

    setDialogField('#rule-program-day', 'day-2', 'change')
    setDialogField('#rule-weekday', '2', 'change') // Wednesday
    setDialogField('#rule-start', '2026-08-10') // a Monday
    submitDialogForm()
    await flushPromises()

    expect(trainingApi.createScheduleRule).toHaveBeenCalledWith('studio-a', 'assignment-1', {
      programDayId: 'day-2',
      weekday: 2,
      weekInterval: 1,
      anchorDate: '2026-08-12',
      activeFrom: '2026-08-10',
    })
    expect(toast.toastSuccess).toHaveBeenCalled()
  })

  it('shows a live occurrence preview in the create form, clearly labeled', async () => {
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    setDialogField('#rule-start', '2026-08-10')
    await flushPromises()
    expect(dialogRoot().textContent).toContain('Nächste Termine (Vorschau)')
  })

  it('opens the edit form pre-filled and never offers changing the program day', async () => {
    await mountView()
    await wrapper.get('[data-rule-row="rule-1"] button').trigger('click')
    await flushPromises()
    expect(dialogRoot().querySelector('#rule-program-day')).toBeNull()
    expect(dialogRoot().querySelector('#rule-weekday').value).toBe('0')
    expect(dialogRoot().querySelector('#rule-start').value).toBe('2026-08-10')
  })

  it('shows the required pre-save warning before editing a rule', async () => {
    await mountView()
    await wrapper.get('[data-rule-row="rule-1"] button').trigger('click')
    await flushPromises()
    expect(dialogRoot().textContent).toContain(
      'Änderungen betreffen zukünftige geplante Trainings. Bereits abgeschlossene Trainings bleiben unverändert.'
    )
  })

  it('submits an edit using only PATCH-supported fields, with a consistent anchorDate', async () => {
    trainingApi.updateScheduleRule.mockResolvedValue({ scheduleRule: rule({ weekday: 3 }) })
    await mountView()
    await wrapper.get('[data-rule-row="rule-1"] button').trigger('click')
    await flushPromises()
    setDialogField('#rule-weekday', '3', 'change') // Thursday
    submitDialogForm()
    await flushPromises()

    expect(trainingApi.updateScheduleRule).toHaveBeenCalledWith('studio-a', 'assignment-1', 'rule-1', {
      weekday: 3,
      weekInterval: 1,
      anchorDate: '2026-08-13',
      activeFrom: '2026-08-10',
      activeUntil: null,
    })
  })

  it('disables a rule only after confirmation, with the exact required warning text', async () => {
    trainingApi.updateScheduleRule.mockResolvedValue({ scheduleRule: rule({ status: 'disabled' }) })
    await mountView()

    const disableButton = wrapper.findAll('[data-rule-row="rule-1"] button').find((b) => b.text() === 'Deaktivieren')
    await disableButton.trigger('click')
    await flushPromises()
    expect(trainingApi.updateScheduleRule).not.toHaveBeenCalled()
    expect(dialogRoot().textContent).toContain(
      'Diese Regel wird deaktiviert. Bereits abgeschlossene Trainings bleiben erhalten. Zukünftige, noch nicht materialisierte Termine werden nicht mehr aus dieser Regel erzeugt.'
    )

    dialogButton('Regel deaktivieren').click()
    await flushPromises()
    expect(trainingApi.updateScheduleRule).toHaveBeenCalledWith('studio-a', 'assignment-1', 'rule-1', { status: 'disabled' })
  })

  it('never alters historical completed occurrences locally - a rule edit only reloads the rule list', async () => {
    trainingApi.updateScheduleRule.mockResolvedValue({ scheduleRule: rule({ weekday: 1 }) })
    await mountView()
    trainingApi.listScheduleRules.mockClear()
    await wrapper.get('[data-rule-row="rule-1"] button').trigger('click')
    await flushPromises()
    submitDialogForm()
    await flushPromises()
    expect(trainingApi.listScheduleRules).toHaveBeenCalledTimes(1)
  })

  it('on a 409 conflict, reloads rules and shows a conflict message without a false success', async () => {
    const conflictError = Object.assign(new Error('conflict'), {
      status: 409,
      data: { error: { code: 'CALENDAR_SCHEDULE_RULE_CONFLICT' } },
    })
    trainingApi.createScheduleRule.mockRejectedValue(conflictError)
    await mountView()
    trainingApi.listScheduleRules.mockClear()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    setDialogField('#rule-program-day', 'day-2', 'change')
    setDialogField('#rule-start', '2026-08-10')
    submitDialogForm()
    await flushPromises()

    expect(toast.toastSuccess).not.toHaveBeenCalled()
    expect(dialogRoot()).not.toBeNull()
    expect(dialogRoot().textContent).toContain('Für diesen Trainingstag existiert bereits eine aktive Terminierungsregel.')
    expect(trainingApi.listScheduleRules).toHaveBeenCalledTimes(1)
  })

  it('maps CALENDAR_ASSIGNMENT_INACTIVE and generic validation errors to translated messages', async () => {
    const inactiveError = Object.assign(new Error('inactive'), {
      status: 409,
      data: { error: { code: 'CALENDAR_ASSIGNMENT_INACTIVE' } },
    })
    trainingApi.createScheduleRule.mockRejectedValue(inactiveError)
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    setDialogField('#rule-program-day', 'day-2', 'change')
    setDialogField('#rule-start', '2026-08-10')
    submitDialogForm()
    await flushPromises()
    expect(dialogRoot().textContent).toContain('Diese Programmzuweisung ist nicht aktiv.')
  })

  it('blocks double-submit while a create request is in flight', async () => {
    let resolveCreate
    trainingApi.createScheduleRule.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve }))
    await mountView()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    setDialogField('#rule-program-day', 'day-2', 'change')
    setDialogField('#rule-start', '2026-08-10')
    const submitButton = dialogButton('Regel erstellen')
    submitButton.click()
    await flushPromises()
    expect(submitButton.disabled).toBe(true)
    submitButton.click()
    await flushPromises()
    expect(trainingApi.createScheduleRule).toHaveBeenCalledTimes(1)
    resolveCreate({ scheduleRule: rule({ id: 'rule-new' }) })
    await flushPromises()
  })

  it('shows a not-found state for an assignment the actor cannot access (e.g. a trainer outside their coaching relationship)', async () => {
    trainingApi.getProgramAssignment.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    await mountView('trainer')
    expect(wrapper.text()).toContain('Diese Zuweisung wurde nicht gefunden.')
    expect(wrapper.text()).not.toContain('Member One')
  })

  it('issues exactly one rules request and one assignment request on initial load', async () => {
    await mountView()
    expect(trainingApi.getProgramAssignment).toHaveBeenCalledTimes(1)
    expect(trainingApi.listScheduleRules).toHaveBeenCalledTimes(1)
  })

  it('gives edit and disable buttons unique accessible names including the program day', async () => {
    trainingApi.listScheduleRules.mockResolvedValue({
      scheduleRules: [rule({ id: 'rule-1', programDay: { id: 'day-1', name: 'Push Day' } }), rule({ id: 'rule-2', programDay: { id: 'day-2', name: 'Pull Day' }, weekday: 2 })],
    })
    await mountView()
    const editButtons = wrapper.findAll('button').filter((b) => b.text() === 'Bearbeiten')
    const labels = editButtons.map((b) => b.attributes('aria-label'))
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.some((label) => label.includes('Push Day'))).toBe(true)
    expect(labels.some((label) => label.includes('Pull Day'))).toBe(true)
  })
})
