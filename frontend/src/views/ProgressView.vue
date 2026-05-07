<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../utils/api'
import { getToken } from '../utils/auth'
import { formatDate, t, translateMuscleGroup } from '../utils/i18n'
import {
  normalizeExercise,
  normalizeProgressEntry,
  normalizeProgressSummary,
} from '../utils/taxonomy'

const entries = ref([])
const summary = ref([])
const exercises = ref([])
const isLoading = ref(true)
const isSaving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

function dateInputValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 10)
}

const form = ref({
  exercise_id: '',
  entry_date: dateInputValue(),
  sets: 3,
  reps: 10,
  weight: '',
})

const maxVolume = computed(() =>
    Math.max(0, ...summary.value.map((item) => Number(item.max_volume) || 0))
)

async function loadData() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const token = getToken()
    const [entryData, summaryData, exerciseData] = await Promise.all([
      apiRequest('/progress', { token }),
      apiRequest('/progress/summary', { token }),
      apiRequest('/exercises', { token }),
    ])

    entries.value = entryData.map(normalizeProgressEntry)
    summary.value = summaryData.map(normalizeProgressSummary)
    exercises.value = exerciseData.map(normalizeExercise)
  } catch (error) {
    errorMessage.value = t('progress.loadError')
  } finally {
    isLoading.value = false
  }
}

function resetForm() {
  form.value = {
    exercise_id: '',
    entry_date: dateInputValue(),
    sets: 3,
    reps: 10,
    weight: '',
  }
}

function validForm() {
  return (
      form.value.exercise_id &&
      form.value.entry_date &&
      Number(form.value.sets) > 0 &&
      Number(form.value.reps) > 0
  )
}

async function saveEntry() {
  errorMessage.value = ''
  successMessage.value = ''

  if (!validForm()) {
    errorMessage.value = t('progress.missingFields')
    return
  }

  isSaving.value = true

  try {
    await apiRequest('/progress', {
      method: 'POST',
      token: getToken(),
      body: {
        exercise_id: Number(form.value.exercise_id),
        entry_date: form.value.entry_date,
        sets: Number(form.value.sets),
        reps: Number(form.value.reps),
        weight: form.value.weight === '' ? null : Number(form.value.weight),
      },
    })

    successMessage.value = t('progress.saved')
    resetForm()
    await loadData()
  } catch (error) {
    errorMessage.value = t('progress.saveError')
  } finally {
    isSaving.value = false
  }
}

async function deleteEntry(entry) {
  if (!confirm(t('progress.confirmDelete'))) {
    return
  }

  errorMessage.value = ''
  successMessage.value = ''

  try {
    await apiRequest(`/progress/${entry.id}`, {
      method: 'DELETE',
      token: getToken(),
    })

    successMessage.value = t('progress.deleted')
    await loadData()
  } catch (error) {
    errorMessage.value = t('progress.deleteError')
  }
}

function formatWeight(weight) {
  if (weight === null || weight === undefined || weight === '') {
    return '-'
  }

  return `${Number(weight).toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'de-CH', {
    maximumFractionDigits: 2,
  })} ${t('common.kg')}`
}

function volumePercent(item) {
  if (!maxVolume.value) {
    return 0
  }

  return Math.max(6, Math.round((Number(item.max_volume) / maxVolume.value) * 100))
}
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">{{ t('progress.eyebrow') }}</span>
        <h1 class="page-title">{{ t('progress.title') }}</h1>
        <p class="page-subtitle">
          {{ t('progress.subtitle') }}
        </p>
      </div>

      <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
      <p v-if="successMessage" class="message message-success">{{ successMessage }}</p>

      <div class="progress-form card">
        <h2>{{ t('progress.formTitle') }}</h2>

        <div class="progress-form-grid">
          <div class="form-group exercise-select">
            <label class="form-label" for="progressExercise">{{ t('common.exercise') }}</label>
            <select id="progressExercise" v-model="form.exercise_id" class="input">
              <option value="">{{ t('common.noSelection') }}</option>
              <option v-for="exercise in exercises" :key="exercise.id" :value="exercise.id">
                {{ exercise.name }} · {{ translateMuscleGroup(exercise.muscle_group) }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="entryDate">{{ t('progress.entryDate') }}</label>
            <input id="entryDate" v-model="form.entry_date" class="input" type="date" />
          </div>

          <div class="form-group">
            <label class="form-label" for="sets">{{ t('common.sets') }}</label>
            <input id="sets" v-model="form.sets" class="input" type="number" min="1" />
          </div>

          <div class="form-group">
            <label class="form-label" for="reps">{{ t('common.reps') }}</label>
            <input id="reps" v-model="form.reps" class="input" type="number" min="1" />
          </div>

          <div class="form-group">
            <label class="form-label" for="weight">{{ t('common.weight') }}</label>
            <input
                id="weight"
                v-model="form.weight"
                class="input"
                type="number"
                min="0"
                step="0.25"
                :placeholder="t('common.kg')"
            />
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" type="button" :disabled="isSaving" @click="saveEntry">
            {{ isSaving ? t('common.saving') : t('progress.saveEntry') }}
          </button>
        </div>
      </div>

      <div v-if="isLoading" class="empty-state card">
        <p>{{ t('common.loading') }}</p>
      </div>

      <template v-else>
        <section class="summary-section">
          <div class="section-head">
            <h2>{{ t('progress.summaryTitle') }}</h2>
          </div>

          <div v-if="summary.length === 0" class="empty-state card">
            <p>{{ t('progress.noSummary') }}</p>
          </div>

          <div v-else class="summary-grid">
            <article v-for="item in summary" :key="item.exercise_id" class="summary-card card">
              <div class="summary-top">
                <div>
                  <h3>{{ item.exercise_name }}</h3>
                  <span>{{ translateMuscleGroup(item.muscle_group) }}</span>
                </div>
                <span class="pill">{{ item.total_entries }} {{ t('progress.entries') }}</span>
              </div>

              <div class="metric-row">
                <span>{{ t('progress.maxWeight') }}</span>
                <strong>{{ formatWeight(item.max_weight) }}</strong>
              </div>

              <div class="metric-row">
                <span>{{ t('progress.latest') }}</span>
                <strong>{{ formatDate(item.latest_date) }}</strong>
              </div>

              <div class="volume-bar" :aria-label="t('progress.maxVolume')">
                <span :style="{ width: `${volumePercent(item)}%` }"></span>
              </div>
              <small>{{ t('progress.maxVolume') }}: {{ Number(item.max_volume || 0).toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'de-CH') }}</small>
            </article>
          </div>
        </section>

        <section class="entries-section">
          <div class="section-head">
            <h2>{{ t('progress.latestEntries') }}</h2>
          </div>

          <div v-if="entries.length === 0" class="empty-state card">
            <p>{{ t('progress.noEntries') }}</p>
          </div>

          <div v-else class="entries-list">
            <article v-for="entry in entries" :key="entry.id" class="entry-card card">
              <div>
                <span class="entry-date">{{ formatDate(entry.entry_date) }}</span>
                <h3>{{ entry.exercise_name }}</h3>
                <p>
                  {{ entry.sets }} × {{ entry.reps }} · {{ formatWeight(entry.weight) }}
                </p>
                <small>{{ t('progress.source') }}: {{ entry.workout_title || t('progress.manualEntry') }}</small>
              </div>

              <button class="btn btn-danger" type="button" @click="deleteEntry(entry)">
                {{ t('common.delete') }}
              </button>
            </article>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 1.4rem;
}

.message {
  margin-bottom: 1rem;
}

.progress-form {
  padding: 1.2rem;
  margin-bottom: 1.2rem;
}

.progress-form h2,
.section-head h2 {
  font-size: 1.12rem;
  font-weight: 850;
}

.progress-form-grid {
  display: grid;
  grid-template-columns: minmax(240px, 1.5fr) repeat(4, minmax(120px, 1fr));
  gap: 0.85rem;
  margin-top: 1rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.summary-section,
.entries-section {
  margin-top: 1.5rem;
}

.section-head {
  margin-bottom: 0.8rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.summary-card {
  padding: 1rem;
}

.summary-top {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.9rem;
}

.summary-top h3 {
  font-size: 1.05rem;
  font-weight: 850;
}

.summary-top span:not(.pill) {
  color: var(--text-soft);
}

.metric-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--border);
}

.metric-row span {
  color: var(--text-soft);
}

.volume-bar {
  height: 9px;
  margin: 0.75rem 0 0.4rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-soft);
}

.volume-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.summary-card small,
.entry-card small {
  color: var(--text-muted);
  font-weight: 700;
}

.entries-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.entry-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
}

.entry-date {
  color: var(--accent);
  font-size: 0.86rem;
  font-weight: 850;
}

.entry-card h3 {
  font-size: 1.05rem;
  font-weight: 850;
}

.entry-card p {
  color: var(--text-soft);
}

@media (max-width: 1050px) {
  .progress-form-grid,
  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }

  .exercise-select {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .progress-form-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .form-actions {
    justify-content: flex-start;
  }

  .entry-card {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
