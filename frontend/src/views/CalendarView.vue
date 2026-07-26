<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../components/ui/PageHeader.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import CalendarFilters from '../components/calendar/CalendarFilters.vue'
import CalendarMonthGrid from '../components/calendar/CalendarMonthGrid.vue'
import CalendarAgendaList from '../components/calendar/CalendarAgendaList.vue'
import CalendarEventDetailDialog from '../components/calendar/CalendarEventDetailDialog.vue'
import CalendarCreateDialog from '../components/calendar/CalendarCreateDialog.vue'
import { formatDate, t } from '../utils/i18n'
import { toastError, toastSuccess } from '../utils/toast'
import {
  addMonths,
  buildMonthGrid,
  monthGridRange,
  parseLocalDate,
  resolveBrowserTimezone,
  startOfMonth,
  todayInTimezone,
} from '../utils/calendarDate'
import {
  cancelCalendarEntry,
  completeCalendarEntry,
  createCalendarEntry,
  getCalendarRange,
  rescheduleCalendarEntry,
  resolveLinkedWorkoutRoute,
  skipCalendarEntry,
  startCalendarStudioWorkout,
  updateCalendarEntry,
} from '../utils/calendarApi'
import { calendarErrorMessage, isCalendarConflictError } from '../utils/calendarErrors'

const router = useRouter()

const timezone = ref(resolveBrowserTimezone())
const selectedMonth = ref(startOfMonth(new Date()))
const today = ref(todayInTimezone(timezone.value))

const entries = ref([])
const isLoading = ref(true)
const isRangeLoading = ref(false)
const loadError = ref(false)

const sourceFilter = ref('all')
const statusFilter = ref('all')

const detailEntryId = ref(null)
const pendingConfirm = ref(null) // { type: 'complete' | 'skip' | 'cancel', entry }
const mutationBusy = ref(false)
const createDialogOpen = ref(false)

let requestSequence = 0

const monthLabel = computed(() => formatDate(selectedMonth.value, { month: 'long', year: 'numeric' }))
const monthGridDays = computed(() => buildMonthGrid(selectedMonth.value))

const filteredEntries = computed(() =>
  entries.value.filter((entry) => {
    if (sourceFilter.value !== 'all' && entry.sourceType !== sourceFilter.value) return false
    if (statusFilter.value !== 'all' && entry.displayStatus !== statusFilter.value) return false
    return true
  })
)

const entriesByDate = computed(() => {
  const map = new Map()
  for (const entry of filteredEntries.value) {
    if (!map.has(entry.scheduledDate)) map.set(entry.scheduledDate, [])
    map.get(entry.scheduledDate).push(entry)
  }
  return map
})

const isFilteredEmpty = computed(() => entries.value.length > 0 && filteredEntries.value.length === 0)
const isTrulyEmpty = computed(() => entries.value.length === 0)
const filtersActive = computed(() => sourceFilter.value !== 'all' || statusFilter.value !== 'all')

// detailEntry is derived from the current entries list (never stored as a
// standalone copy) so it always reflects the latest revision/status after
// any refetch - reopening after a mutation shows fresh data automatically.
const detailEntry = computed(() => entries.value.find((entry) => entry.id === detailEntryId.value) || null)

async function loadRange({ showSkeleton = false } = {}) {
  const sequence = ++requestSequence
  if (showSkeleton) isLoading.value = true
  else isRangeLoading.value = true
  loadError.value = false

  try {
    const range = monthGridRange(selectedMonth.value)
    const result = await getCalendarRange({ from: range.from, to: range.to, timezone: timezone.value })
    // A newer request already superseded this one (fast month navigation) -
    // discard this response rather than overwriting more recent data.
    if (sequence !== requestSequence) return
    entries.value = result.entries
  } catch {
    if (sequence !== requestSequence) return
    loadError.value = true
  } finally {
    if (sequence === requestSequence) {
      isLoading.value = false
      isRangeLoading.value = false
    }
  }
}

onMounted(() => {
  today.value = todayInTimezone(timezone.value)
  loadRange({ showSkeleton: true })
})

function changeMonth(delta) {
  selectedMonth.value = addMonths(selectedMonth.value, delta)
  loadRange()
}

function goToday() {
  today.value = todayInTimezone(timezone.value)
  selectedMonth.value = startOfMonth(parseLocalDate(today.value))
  loadRange()
}

function retryLoad() {
  loadRange({ showSkeleton: isTrulyEmpty.value })
}

function resetFilters() {
  sourceFilter.value = 'all'
  statusFilter.value = 'all'
}

function openDetail(entry) {
  detailEntryId.value = entry.id
}

function closeDetail() {
  detailEntryId.value = null
}

function openCreateDialog() {
  createDialogOpen.value = true
}

// Every mutation shares the same outcome handling: conflicts reload data and
// show the dedicated stale-data message (Section 19), any other failure
// shows a mapped, non-technical error, and busy state prevents a double
// submit for the duration of exactly one in-flight request.
async function runMutation(action) {
  mutationBusy.value = true
  try {
    const result = await action()
    return { ok: true, result }
  } catch (error) {
    if (isCalendarConflictError(error)) {
      toastError(t('calendar.conflict.message'))
      await loadRange()
      return { ok: false, conflict: true }
    }
    toastError(calendarErrorMessage(error))
    return { ok: false, conflict: false }
  } finally {
    mutationBusy.value = false
  }
}

async function handleCreateSubmit(payload) {
  const outcome = await runMutation(() => createCalendarEntry({ ...payload, timezone: timezone.value }))
  if (outcome.ok) {
    createDialogOpen.value = false
    toastSuccess(t('calendar.create.success'))
    await loadRange()
  }
}

async function handleEditSubmit(title) {
  const entry = detailEntry.value
  if (!entry) return
  const outcome = await runMutation(() =>
    updateCalendarEntry(entry.id, { title, expectedRevision: entry.revision })
  )
  if (outcome.ok) {
    closeDetail()
    toastSuccess(t('calendar.edit.success'))
    await loadRange()
  }
}

async function handleRescheduleSubmit(newDate) {
  const entry = detailEntry.value
  if (!entry) return
  const outcome = await runMutation(() =>
    rescheduleCalendarEntry(entry.id, { scheduledDate: newDate, expectedRevision: entry.revision, timezone: timezone.value })
  )
  if (outcome.ok) {
    closeDetail()
    toastSuccess(t('calendar.reschedule.success'))
    await loadRange()
  }
}

function requestConfirm(type) {
  const entry = detailEntry.value
  if (!entry) return
  pendingConfirm.value = { type, entry }
}

const CONFIRM_ACTIONS = {
  complete: (entry) => completeCalendarEntry(entry.id, { expectedRevision: entry.revision }),
  skip: (entry) => skipCalendarEntry(entry.id, { expectedRevision: entry.revision }),
  cancel: (entry) => cancelCalendarEntry(entry.id, { expectedRevision: entry.revision }),
}
const CONFIRM_SUCCESS_KEYS = {
  complete: 'calendar.confirmComplete.success',
  skip: 'calendar.confirmSkip.success',
  cancel: 'calendar.confirmCancel.success',
}

async function confirmPending() {
  if (!pendingConfirm.value) return
  const { type, entry } = pendingConfirm.value
  const outcome = await runMutation(() => CONFIRM_ACTIONS[type](entry))
  pendingConfirm.value = null
  if (outcome.ok) {
    closeDetail()
    toastSuccess(t(CONFIRM_SUCCESS_KEYS[type]))
    await loadRange()
  }
}

function cancelPendingConfirm() {
  pendingConfirm.value = null
}

async function handleStart() {
  const entry = detailEntry.value
  if (!entry || !entry.assignmentId || !entry.studio?.id || !entry.programDay?.id) return
  mutationBusy.value = true
  try {
    const clientStartKey = `calendar-${entry.id}-${Date.now()}`
    const result = await startCalendarStudioWorkout(entry.studio.id, entry.assignmentId, {
      programDayId: entry.programDay.id,
      clientStartKey,
    })
    closeDetail()
    router.push({
      name: 'studio-workout-session-detail',
      params: { studioId: entry.studio.id, sessionId: result.workoutSession.id },
    })
  } catch (error) {
    toastError(calendarErrorMessage(error))
  } finally {
    mutationBusy.value = false
  }
}

function handleViewWorkout() {
  const entry = detailEntry.value
  if (!entry) return
  const route = resolveLinkedWorkoutRoute(entry)
  closeDetail()
  if (route) router.push(route)
}

const confirmDialogProps = computed(() => {
  const type = pendingConfirm.value?.type
  const entry = pendingConfirm.value?.entry
  if (!type || !entry) return null
  const dateLabel = formatDate(entry.scheduledDate, { day: '2-digit', month: 'long', year: 'numeric' })
  return {
    title: t(`calendar.confirm${type[0].toUpperCase()}${type.slice(1)}.title`),
    description: t(`calendar.confirm${type[0].toUpperCase()}${type.slice(1)}.description`, { title: entry.title, date: dateLabel }),
    confirmLabel: t(`calendar.confirm${type[0].toUpperCase()}${type.slice(1)}.confirm`),
    tone: type === 'complete' ? 'primary' : 'danger',
  }
})
</script>

<template>
  <section class="section">
    <div class="page-container">
      <PageHeader :eyebrow="t('calendar.eyebrow')" :title="t('calendar.title')" :subtitle="t('calendar.subtitle')">
        <template #actions>
          <button class="btn btn-primary" type="button" @click="openCreateDialog">
            {{ t('calendar.addWorkout') }}
          </button>
        </template>
      </PageHeader>

      <CalendarFilters
        v-model:source="sourceFilter"
        v-model:status="statusFilter"
        @reset="resetFilters"
      />

      <div v-if="isLoading" class="card calendar-skeleton" aria-live="polite" aria-busy="true">
        <div class="skeleton skeleton-text" style="height: 2.5rem;"></div>
        <div class="skeleton skeleton-text" style="height: 12rem;"></div>
      </div>

      <div v-else-if="loadError" class="card">
        <p class="message message-error" role="alert">{{ t('calendar.loadError') }}</p>
        <button type="button" class="btn btn-secondary" @click="retryLoad">{{ t('common.retry') }}</button>
      </div>

      <template v-else>
        <p v-if="isRangeLoading" class="visually-hidden" role="status">{{ t('common.loading') }}</p>

        <!-- The grid/agenda (and their month navigation) always render, even
             for an empty month - an empty July must never trap the user
             without a way to page to a month that does have events. The
             empty/filtered-empty messages are a non-blocking banner above
             the still-fully-functional calendar, not a replacement for it. -->
        <p v-if="isTrulyEmpty" class="calendar-empty-banner">{{ t('calendar.emptyMonth') }}</p>
        <div v-else-if="isFilteredEmpty" class="calendar-empty-banner calendar-empty-banner-filtered">
          <span>{{ t('calendar.emptyFiltered') }}</span>
          <button type="button" class="btn btn-secondary" @click="resetFilters">
            {{ t('calendar.filters.reset') }}
          </button>
        </div>

        <CalendarMonthGrid
          class="calendar-desktop-view"
          :month-date="selectedMonth"
          :entries-by-date="entriesByDate"
          :today="today"
          @open-event="openDetail"
          @change-month="changeMonth"
          @go-today="goToday"
        />
        <CalendarAgendaList
          class="calendar-mobile-view"
          :days="monthGridDays"
          :entries-by-date="entriesByDate"
          :today="today"
          :month-label="monthLabel"
          @open-event="openDetail"
          @change-month="changeMonth"
          @go-today="goToday"
        />
      </template>
    </div>

    <CalendarEventDetailDialog
      :entry="pendingConfirm ? null : detailEntry"
      :busy="mutationBusy"
      @close="closeDetail"
      @request-start="handleStart"
      @request-complete="requestConfirm('complete')"
      @request-skip="requestConfirm('skip')"
      @request-cancel="requestConfirm('cancel')"
      @request-view-workout="handleViewWorkout"
      @submit-edit="handleEditSubmit"
      @submit-reschedule="handleRescheduleSubmit"
    />

    <ConfirmDialog
      v-if="confirmDialogProps"
      :open="Boolean(pendingConfirm)"
      :title="confirmDialogProps.title"
      :description="confirmDialogProps.description"
      :confirm-label="confirmDialogProps.confirmLabel"
      :tone="confirmDialogProps.tone"
      :busy="mutationBusy"
      @confirm="confirmPending"
      @cancel="cancelPendingConfirm"
    />

    <CalendarCreateDialog
      :open="createDialogOpen"
      :default-date="today"
      :today="today"
      :busy="mutationBusy"
      @close="createDialogOpen = false"
      @submit="handleCreateSubmit"
    />
  </section>
</template>

<style scoped>
.page-container {
  display: grid;
  gap: 1.25rem;
}

.calendar-skeleton {
  display: grid;
  gap: 0.75rem;
  padding: 1.25rem;
}

.calendar-empty-banner {
  padding: 0.85rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: var(--text-sm);
}

.calendar-empty-banner-filtered {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.calendar-mobile-view {
  display: none;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 767px) {
  .calendar-desktop-view {
    display: none;
  }

  .calendar-mobile-view {
    display: block;
  }
}
</style>
