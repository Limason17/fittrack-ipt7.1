<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import Modal from '../components/ui/Modal.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { formatDate, t, weekdayNames } from '../utils/i18n'
import { scheduleRuleStatusTone } from '../utils/studioBadges'
import {
  createScheduleRule,
  getProgramAssignment,
  getProgramVersion,
  listProgramVersions,
  listScheduleRules,
  updateScheduleRule,
} from '../utils/studioTrainingApi'
import {
  formatScheduleRuleSummary,
  rollForwardToWeekday,
  sortScheduleRules,
  upcomingScheduleRuleOccurrences,
  weekdayLongName,
} from '../utils/scheduleRuleFormat'
import { resolveBrowserTimezone, todayInTimezone, compareDateOnly } from '../utils/calendarDate'
import { calendarErrorMessage } from '../utils/calendarErrors'
import { TRAINING_MANAGEMENT_ROLES, activeStudio, refreshSelectedStudio } from '../utils/studioContext'
import { toastError, toastSuccess } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const studioId = computed(() => String(route.params.studioId || ''))
const assignmentId = computed(() => String(route.params.assignmentId || ''))
const today = todayInTimezone(resolveBrowserTimezone())

const assignment = ref(null)
const programDays = ref([])
const rules = ref([])
const isLoading = ref(true)
const loadError = ref('')
const notFound = ref(false)

let generation = 0

async function reconcileStudioAccess(expectedGeneration, expectedStudioId) {
  const selected = await refreshSelectedStudio(expectedStudioId).catch(() => null)
  if (expectedGeneration !== generation || expectedStudioId !== studioId.value || selected?.ignored) return false
  if (!selected) {
    await router.replace({ name: 'studios' })
    return false
  }
  if (!TRAINING_MANAGEMENT_ROLES.includes(selected.membership?.role)) {
    await router.replace({ name: 'studio-access-denied', params: { studioId: selected.id } })
    return false
  }
  return true
}

const programDayPositionById = computed(() => new Map(programDays.value.map((day) => [day.id, day.position])))
const sortedRules = computed(() => sortScheduleRules(rules.value, programDayPositionById.value))

async function loadProgramDays(currentAssignment) {
  const versionsResult = await listProgramVersions(studioId.value, currentAssignment.program.id, { page: 1, limit: 100 })
  const match = (versionsResult.programVersions || []).find(
    (version) => version.versionNumber === currentAssignment.programVersion.versionNumber
  )
  if (!match) {
    programDays.value = []
    return
  }
  const versionResult = await getProgramVersion(studioId.value, currentAssignment.program.id, match.id)
  programDays.value = versionResult.programVersion?.days || []
}

async function load() {
  const current = ++generation
  const currentStudioId = studioId.value
  const currentAssignmentId = assignmentId.value
  isLoading.value = true
  loadError.value = ''
  notFound.value = false
  assignment.value = null
  programDays.value = []
  rules.value = []
  try {
    const assignmentResult = await getProgramAssignment(currentStudioId, currentAssignmentId)
    if (current !== generation || currentStudioId !== studioId.value) return
    assignment.value = assignmentResult.programAssignment
    const [, rulesResult] = await Promise.all([
      loadProgramDays(assignment.value),
      listScheduleRules(currentStudioId, currentAssignmentId),
    ])
    if (current !== generation || currentStudioId !== studioId.value) return
    rules.value = rulesResult.scheduleRules || []
  } catch (error) {
    if (current !== generation || currentStudioId !== studioId.value) return
    if (error.status === 404) {
      notFound.value = true
    } else if ([403].includes(error.status)) {
      if (!await reconcileStudioAccess(current, currentStudioId)) return
      loadError.value = t('studios.schedule.permissionDenied')
    } else {
      loadError.value = t('studios.schedule.loadError')
    }
  } finally {
    if (current === generation) isLoading.value = false
  }
}

watch([studioId, assignmentId], load, { immediate: true })

async function refreshRules() {
  const current = generation
  const currentStudioId = studioId.value
  const currentAssignmentId = assignmentId.value
  try {
    const result = await listScheduleRules(currentStudioId, currentAssignmentId)
    if (current !== generation || currentStudioId !== studioId.value) return
    rules.value = result.scheduleRules || []
  } catch {
    if (current === generation) toastError(t('studios.schedule.rules.loadError'))
  }
}

const programDayOptions = computed(() => [...programDays.value]
  .sort((a, b) => a.position - b.position)
  .map((day) => ({
    id: day.id,
    label: Array.isArray(day.exercises) && day.exercises.length
      ? t('studios.schedule.form.programDayOptionWithExercises', { position: day.position, name: day.name, count: day.exercises.length })
      : t('studios.schedule.form.programDayOption', { position: day.position, name: day.name }),
  })))

const weekdayOptions = computed(() => weekdayNames('long').map((name, index) => ({ value: index, label: name })))

const REPEAT_INTERVALS = { weekly: 1, every2: 2, every3: 3, every4: 4 }

function blankForm() {
  return {
    programDayId: '',
    weekday: 0,
    startDate: today,
    repeat: 'weekly',
    customInterval: 2,
    endDate: '',
  }
}

const formMode = ref(null) // null | 'create' | 'edit'
const editingRuleId = ref(null)
const form = ref(blankForm())
const formError = ref('')
const isSavingForm = ref(false)
const focusRuleId = ref(null)

const formWeekInterval = computed(() => (
  form.value.repeat === 'custom' ? Number(form.value.customInterval) : REPEAT_INTERVALS[form.value.repeat]
))

const formPreviewDates = computed(() => {
  if (!form.value.startDate || !Number.isInteger(form.value.weekday)) return []
  const interval = formWeekInterval.value
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) return []
  const anchorDate = rollForwardToWeekday(form.value.startDate, form.value.weekday)
  const rule = {
    weekday: form.value.weekday,
    weekInterval: interval,
    anchorDate,
    activeFrom: form.value.startDate,
    activeUntil: form.value.endDate || null,
  }
  return upcomingScheduleRuleOccurrences(rule, today)
})

function openCreateForm() {
  form.value = blankForm()
  if (programDayOptions.value.length === 1) form.value.programDayId = programDayOptions.value[0].id
  formError.value = ''
  formMode.value = 'create'
}

function openEditForm(rule) {
  const preset = Object.entries(REPEAT_INTERVALS).find(([, interval]) => interval === rule.weekInterval)
  form.value = {
    programDayId: rule.programDay.id,
    weekday: rule.weekday,
    startDate: rule.activeFrom,
    repeat: preset ? preset[0] : 'custom',
    customInterval: preset ? 2 : rule.weekInterval,
    endDate: rule.activeUntil || '',
  }
  editingRuleId.value = rule.id
  formError.value = ''
  formMode.value = 'edit'
}

function closeForm() {
  formMode.value = null
  editingRuleId.value = null
  formError.value = ''
}

async function focusRuleRow(ruleId) {
  focusRuleId.value = ruleId
  await nextTick()
  document.querySelector(`[data-rule-row="${ruleId}"] button`)?.focus()
}

async function submitForm() {
  formError.value = ''
  if (formMode.value === 'create' && !form.value.programDayId) {
    formError.value = t('studios.schedule.form.programDayRequired')
    return
  }
  if (!form.value.startDate) {
    formError.value = t('studios.schedule.form.startRequired')
    return
  }
  if (form.value.endDate && compareDateOnly(form.value.endDate, form.value.startDate) < 0) {
    formError.value = t('studios.schedule.form.endBeforeStart')
    return
  }
  const interval = formWeekInterval.value
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    formError.value = t('studios.schedule.form.intervalInvalid')
    return
  }
  const anchorDate = rollForwardToWeekday(form.value.startDate, form.value.weekday)
  const currentStudioId = studioId.value
  const currentAssignmentId = assignmentId.value
  isSavingForm.value = true
  try {
    if (formMode.value === 'create') {
      const payload = {
        programDayId: form.value.programDayId,
        weekday: form.value.weekday,
        weekInterval: interval,
        anchorDate,
        activeFrom: form.value.startDate,
        ...(form.value.endDate ? { activeUntil: form.value.endDate } : {}),
      }
      const result = await createScheduleRule(currentStudioId, currentAssignmentId, payload)
      if (currentStudioId !== studioId.value || currentAssignmentId !== assignmentId.value) return
      closeForm()
      await refreshRules()
      toastSuccess(t('studios.schedule.form.createSuccess'))
      await focusRuleRow(result.scheduleRule.id)
    } else {
      const ruleId = editingRuleId.value
      const payload = {
        weekday: form.value.weekday,
        weekInterval: interval,
        anchorDate,
        activeFrom: form.value.startDate,
        activeUntil: form.value.endDate || null,
      }
      await updateScheduleRule(currentStudioId, currentAssignmentId, ruleId, payload)
      if (currentStudioId !== studioId.value || currentAssignmentId !== assignmentId.value) return
      closeForm()
      await refreshRules()
      toastSuccess(t('studios.schedule.form.editSuccess'))
      await focusRuleRow(ruleId)
    }
  } catch (error) {
    if (currentStudioId !== studioId.value || currentAssignmentId !== assignmentId.value) return
    if (error.status === 409) {
      await refreshRules()
    }
    formError.value = calendarErrorMessage(error)
  } finally {
    if (currentStudioId === studioId.value && currentAssignmentId === assignmentId.value) isSavingForm.value = false
  }
}

const pendingDisable = ref(null)
const isDisabling = ref(false)

function requestDisable(rule) {
  pendingDisable.value = rule
}

function cancelDisable() {
  pendingDisable.value = null
}

async function confirmDisable() {
  const rule = pendingDisable.value
  pendingDisable.value = null
  if (!rule) return
  const currentStudioId = studioId.value
  const currentAssignmentId = assignmentId.value
  isDisabling.value = true
  try {
    await updateScheduleRule(currentStudioId, currentAssignmentId, rule.id, { status: 'disabled' })
    if (currentStudioId !== studioId.value || currentAssignmentId !== assignmentId.value) return
    await refreshRules()
    toastSuccess(t('studios.schedule.disable.success'))
    await focusRuleRow(rule.id)
  } catch (error) {
    if (currentStudioId !== studioId.value || currentAssignmentId !== assignmentId.value) return
    if (error.status === 409) await refreshRules()
    toastError(calendarErrorMessage(error))
  } finally {
    if (currentStudioId === studioId.value && currentAssignmentId === assignmentId.value) isDisabling.value = false
  }
}
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader
        :eyebrow="activeStudio?.name"
        :title="t('studios.schedule.title')"
        :subtitle="t('studios.schedule.subtitle')"
      >
        <template #actions>
          <router-link class="btn btn-secondary" :to="{ name: 'studio-program-assignments', params: { studioId } }">
            {{ t('studios.schedule.backToAssignments') }}
          </router-link>
        </template>
      </PageHeader>

      <div v-if="isLoading" class="card" aria-live="polite" aria-busy="true" style="padding: 1.25rem; display: grid; gap: 0.6rem;">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
      </div>

      <EmptyState v-else-if="notFound" :title="t('studios.schedule.notFound')">
        <template #action>
          <router-link class="btn btn-secondary" :to="{ name: 'studio-program-assignments', params: { studioId } }">
            {{ t('studios.schedule.backToAssignments') }}
          </router-link>
        </template>
      </EmptyState>

      <p v-else-if="loadError" class="message message-error" role="alert">{{ loadError }}</p>

      <template v-else-if="assignment">
        <article class="card assignment-header">
          <dl class="assignment-header-grid">
            <div>
              <dt>{{ t('studios.schedule.header.memberLabel') }}</dt>
              <dd>{{ assignment.member?.displayName || '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('studios.schedule.header.programLabel') }}</dt>
              <dd>{{ assignment.program.name }}</dd>
            </div>
            <div>
              <dt>{{ t('studios.schedule.header.versionLabel') }}</dt>
              <dd>{{ t('studios.programBuilder.versionLabel', { number: assignment.programVersion.versionNumber }) }}</dd>
            </div>
            <div>
              <dt>{{ t('studios.schedule.header.statusLabel') }}</dt>
              <dd><Badge :tone="assignment.status === 'active' ? 'success' : 'neutral'">{{ t(`studios.trainingStatuses.${assignment.status}`) }}</Badge></dd>
            </div>
            <div>
              <dt>{{ t('studios.schedule.header.startsLabel') }}</dt>
              <dd>{{ assignment.startsOn ? formatDate(assignment.startsOn) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('studios.schedule.header.endsLabel') }}</dt>
              <dd>{{ assignment.endsOn ? formatDate(assignment.endsOn) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('studios.schedule.header.studioLabel') }}</dt>
              <dd>{{ activeStudio?.name || '—' }}</dd>
            </div>
          </dl>
          <p class="studio-help assignment-header-hint">{{ t('studios.schedule.header.hint') }}</p>
        </article>

        <article class="card">
          <div class="rules-head">
            <h2>{{ t('studios.schedule.rules.title') }}</h2>
            <button class="btn btn-primary" type="button" @click="openCreateForm">
              {{ t('studios.schedule.rules.cta') }}
            </button>
          </div>

          <EmptyState v-if="!sortedRules.length" :title="t('studios.schedule.rules.empty')">
            <template #action>
              <button class="btn btn-primary" type="button" @click="openCreateForm">
                {{ t('studios.schedule.rules.cta') }}
              </button>
            </template>
          </EmptyState>

          <div v-else class="table-wrap table-stack">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('studios.schedule.rules.columnProgramDay') }}</th>
                  <th>{{ t('studios.schedule.rules.columnWeekday') }}</th>
                  <th>{{ t('studios.schedule.rules.columnRepeat') }}</th>
                  <th>{{ t('studios.schedule.rules.columnRange') }}</th>
                  <th>{{ t('studios.schedule.rules.columnStatus') }}</th>
                  <th>{{ t('studios.schedule.rules.columnActions') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rule in sortedRules" :key="rule.id" :data-rule-row="rule.id">
                  <td :data-label="t('studios.schedule.rules.columnProgramDay')">{{ rule.programDay.name }}</td>
                  <td :data-label="t('studios.schedule.rules.columnWeekday')">{{ formatScheduleRuleSummary(rule) }}</td>
                  <td :data-label="t('studios.schedule.rules.columnRepeat')">{{ rule.weekInterval }}</td>
                  <td :data-label="t('studios.schedule.rules.columnRange')">
                    {{ formatDate(rule.activeFrom) }} – {{ rule.activeUntil ? formatDate(rule.activeUntil) : '—' }}
                  </td>
                  <td :data-label="t('studios.schedule.rules.columnStatus')">
                    <Badge :tone="scheduleRuleStatusTone(rule.status)">
                      {{ rule.status === 'active' ? t('studios.schedule.rules.statusActive') : t('studios.schedule.rules.statusDisabled') }}
                    </Badge>
                  </td>
                  <td :data-label="t('studios.schedule.rules.columnActions')">
                    <div class="table-actions">
                      <button
                        class="btn btn-secondary btn-sm"
                        type="button"
                        :aria-label="`${t('studios.schedule.rules.editAction')} ${rule.programDay.name} (${weekdayLongName(rule.weekday)})`"
                        @click="openEditForm(rule)"
                      >
                        {{ t('studios.schedule.rules.editAction') }}
                      </button>
                      <button
                        v-if="rule.status === 'active'"
                        class="btn btn-danger btn-sm"
                        type="button"
                        :aria-label="`${t('studios.schedule.rules.disableAction')} ${rule.programDay.name} (${weekdayLongName(rule.weekday)})`"
                        @click="requestDisable(rule)"
                      >
                        {{ t('studios.schedule.rules.disableAction') }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </template>

      <Modal
        v-if="formMode"
        :open="!!formMode"
        title-id="schedule-rule-form-title"
        @close="closeForm"
      >
        <h2 id="schedule-rule-form-title">
          {{ formMode === 'create' ? t('studios.schedule.form.createTitle') : t('studios.schedule.form.editTitle') }}
        </h2>
        <p v-if="formMode === 'edit'" class="message message-warning" role="note">{{ t('studios.schedule.form.editWarning') }}</p>
        <form class="studio-form-grid" @submit.prevent="submitForm">
          <div v-if="formMode === 'create'" class="form-group">
            <label class="form-label" for="rule-program-day">{{ t('studios.schedule.form.programDayLabel') }}</label>
            <select id="rule-program-day" v-model="form.programDayId" class="select">
              <option value="" disabled>{{ t('studios.schedule.form.programDayPlaceholder') }}</option>
              <option v-for="day in programDayOptions" :key="day.id" :value="day.id">{{ day.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="rule-weekday">{{ t('studios.schedule.form.weekdayLabel') }}</label>
            <select id="rule-weekday" v-model.number="form.weekday" class="select">
              <option v-for="option in weekdayOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="rule-start">{{ t('studios.schedule.form.startLabel') }}</label>
            <input id="rule-start" v-model="form.startDate" class="input" type="date" />
          </div>
          <div class="form-group">
            <label class="form-label" for="rule-end">{{ t('studios.schedule.form.endLabel') }}</label>
            <input id="rule-end" v-model="form.endDate" class="input" type="date" />
          </div>
          <div class="form-group">
            <label class="form-label" for="rule-repeat">{{ t('studios.schedule.form.repeatLabel') }}</label>
            <select id="rule-repeat" v-model="form.repeat" class="select">
              <option value="weekly">{{ t('studios.schedule.form.repeatWeekly') }}</option>
              <option value="every2">{{ t('studios.schedule.form.repeatEvery2') }}</option>
              <option value="every3">{{ t('studios.schedule.form.repeatEvery3') }}</option>
              <option value="every4">{{ t('studios.schedule.form.repeatEvery4') }}</option>
              <option value="custom">{{ t('studios.schedule.form.repeatCustom') }}</option>
            </select>
          </div>
          <div v-if="form.repeat === 'custom'" class="form-group">
            <label class="form-label" for="rule-custom-interval">{{ t('studios.schedule.form.repeatCustomLabel') }}</label>
            <input id="rule-custom-interval" v-model.number="form.customInterval" class="input" type="number" min="1" max="52" />
          </div>

          <div v-if="formPreviewDates.length" class="preview-box">
            <p class="preview-label">{{ t('studios.schedule.preview.label') }}</p>
            <ul class="preview-list">
              <li v-for="date in formPreviewDates" :key="date">{{ formatDate(date) }}</li>
            </ul>
            <p class="studio-help">{{ t('studios.schedule.preview.hint') }}</p>
          </div>
          <p v-else-if="form.startDate" class="studio-help">{{ t('studios.schedule.preview.empty') }}</p>

          <p v-if="formError" class="message message-error" role="alert">{{ formError }}</p>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" @click="closeForm">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="isSavingForm">
              <span v-if="isSavingForm" class="spinner" aria-hidden="true"></span>
              {{ formMode === 'create' ? t('studios.schedule.form.submitCreate') : t('studios.schedule.form.submitEdit') }}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        :open="!!pendingDisable"
        :title="t('studios.schedule.disable.title')"
        :description="t('studios.schedule.disable.description')"
        tone="danger"
        :confirm-label="t('studios.schedule.disable.confirmLabel')"
        :busy="isDisabling"
        @confirm="confirmDisable"
        @cancel="cancelDisable"
      />
    </div>
  </section>
</template>

<style scoped>
.assignment-header-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem 1.5rem;
}

.assignment-header-grid dt {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.assignment-header-grid dd {
  margin: 0.15rem 0 0;
  overflow-wrap: break-word;
  word-break: break-word;
}

.assignment-header-hint {
  margin-top: 1rem;
}

.rules-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.rules-head h2 {
  font-size: 1.1rem;
  font-weight: 850;
}

.preview-box {
  grid-column: 1 / -1;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
}

.preview-label {
  font-weight: 750;
  margin-bottom: 0.35rem;
}

.preview-list {
  margin: 0 0 0.35rem;
  padding-left: 1.1rem;
}

.message-warning {
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  background: var(--warning-soft, rgba(217, 119, 6, 0.12));
  color: var(--text);
  font-size: 0.9rem;
}
</style>
