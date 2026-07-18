<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiRequest } from '../utils/api'
import { getToken } from '../utils/auth'
import { getExerciseImage } from '../utils/exerciseImageMap'
import {
  formatDate,
  locale,
  t,
  translateCategory,
  translateExerciseDescription,
  translateMuscleGroup,
} from '../utils/i18n'
import {
  distanceUnit,
  formatDistanceValue,
  formatSpeedValue,
  formatWeightValue,
  normalizeDistanceValue,
  normalizeWeightValue,
  weightUnit,
} from '../utils/units'
import { convertWeightInputValue, estimateOneRepMax } from '../utils/measurements'
import { useModalFocus } from '../utils/modalFocus'
import {
  normalizeExercise,
  normalizeProgressEntry,
  normalizeProgressSummary,
} from '../utils/taxonomy'

const entries = ref([])
const summary = ref([])
const exercises = ref([])
const isLoading = ref(true)
const isExerciseLoading = ref(true)
const isSaving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const exercisePickerOpen = ref(false)
const exercisePickerRef = ref(null)
const pickerSearch = ref('')
const pickerCategory = ref('')
const pickerMuscleGroup = ref('')

const { handleModalKeydown } = useModalFocus({
  isOpen: exercisePickerOpen,
  dialogRef: exercisePickerRef,
  close: closeExercisePicker,
})

const categoryOptions = [
  'Brust',
  'R\u00fccken',
  'Beine',
  'Schultern',
  'Arme',
  'Core',
  'Cardio',
]

const categoryToMuscleGroups = {
  Brust: ['Brustmitte', 'Obere Brust'],
  R\u00fccken: ['Latissimus', 'Oberer R\u00fccken'],
  Beine: ['Quads', 'Hamstrings', 'Waden'],
  Schultern: ['Vordere Schulter', 'Seitliche Schulter'],
  Arme: ['Bizeps', 'Trizeps'],
  Core: ['Bauch', 'Core'],
  Cardio: ['Ganzk\u00f6rper', 'Beine'],
}

const allMuscleGroups = [...new Set(Object.values(categoryToMuscleGroups).flat())]

function dateInputValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 10)
}

function localeName() {
  return locale.value === 'en' ? 'en-US' : 'de-CH'
}

const form = ref({
  exercise_id: '',
  entry_date: dateInputValue(),
  sets: 3,
  reps: 10,
  weight: '',
  duration_minutes: 30,
  distance_km: '',
  intensity_level: '',
})

const selectedExercise = computed(() =>
    exercises.value.find((exercise) => Number(exercise.id) === Number(form.value.exercise_id))
)

const selectedExerciseIsCardio = computed(() => isCardioExercise(selectedExercise.value))

function historyGroupKey(item) {
  return JSON.stringify([
    Number(item?.exercise_id),
    item?.exercise_name || '',
    item?.category || '',
    item?.muscle_group || '',
    item?.image_url || '',
  ])
}

const availablePickerCategoryOptions = computed(() => {
  if (!pickerMuscleGroup.value) {
    return categoryOptions
  }

  return categoryOptions.filter((category) =>
      categoryToMuscleGroups[category]?.includes(pickerMuscleGroup.value)
  )
})

const availablePickerMuscleGroupOptions = computed(() => {
  if (!pickerCategory.value) {
    return allMuscleGroups
  }

  return categoryToMuscleGroups[pickerCategory.value] || []
})

const filteredPickerExercises = computed(() => {
  const search = pickerSearch.value.trim().toLowerCase()

  return exercises.value.filter((exercise) => {
    const matchesCategory = !pickerCategory.value || exercise.category === pickerCategory.value
    const matchesMuscle =
        !pickerMuscleGroup.value || exercise.muscle_group === pickerMuscleGroup.value
    const exerciseName = searchText(exercise.name)
    const exerciseMuscle = searchText(translateMuscleGroup(exercise.muscle_group))
    const exerciseCategory = searchText(translateCategory(exercise.category))
    const matchesSearch =
        !search ||
        exerciseName.includes(search) ||
        exerciseMuscle.includes(search) ||
        exerciseCategory.includes(search)

    return matchesCategory && matchesMuscle && matchesSearch
  })
})

const progressCharts = computed(() => {
  const groups = new Map()
  const sortedEntries = [...entries.value].sort((firstEntry, secondEntry) => {
    const firstDate = new Date(firstEntry.entry_date).getTime()
    const secondDate = new Date(secondEntry.entry_date).getTime()

    if (firstDate !== secondDate) {
      return firstDate - secondDate
    }

    return Number(firstEntry.id) - Number(secondEntry.id)
  })

  sortedEntries.forEach((entry) => {
    const groupKey = historyGroupKey(entry)
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        history_key: groupKey,
        exercise_id: entry.exercise_id,
        exercise_name: entry.exercise_name,
        category: entry.category,
        muscle_group: entry.muscle_group,
        image_url: entry.image_url,
        entries: [],
      })
    }

    groups.get(groupKey).entries.push(entry)
  })

  return Array.from(groups.values())
      .map((group) => {
        const metricType = chartMetricType(group.entries, isCardioExercise(group))
        const chartPoints = group.entries
            .map((entry) => ({
              id: entry.id,
              date: entry.entry_date,
              value: progressMetricValue(entry, metricType),
            }))
            .filter((point) => Number.isFinite(point.value))

        if (chartPoints.length === 0) {
          return null
        }

        const firstValue = chartPoints[0]?.value || 0
        const latestValue = chartPoints[chartPoints.length - 1]?.value || 0
        const recentPoints = chartPoints.slice(-8)
        const latestDate = chartPoints[chartPoints.length - 1]?.date || ''
        const maxValue = Math.max(1, ...recentPoints.map((point) => point.value))
        const minValue = Math.min(...recentPoints.map((point) => point.value))
        const valueRange = maxValue - minValue

        const linePoints = recentPoints.map((point, index) => {
          const x = recentPoints.length === 1 ? 50 : (index / (recentPoints.length - 1)) * 100
          const y = valueRange === 0 ? 50 : 92 - ((point.value - minValue) / valueRange) * 84

          return {
            ...point,
            x: Number(x.toFixed(2)),
            y: Number(y.toFixed(2)),
          }
        })

        return {
          exercise_id: group.exercise_id,
          exercise_name: group.exercise_name,
          category: group.category,
          muscle_group: group.muscle_group,
          image_url: group.image_url,
          metricType,
          metricLabel: chartMetricLabel(metricType),
          firstValue,
          latestValue,
          latestDate,
          totalEntries: chartPoints.length,
          linePoints: linePoints.map((point) => `${point.x},${point.y}`).join(' '),
          points: linePoints,
        }
      })
      .filter(Boolean)
      .sort((firstGroup, secondGroup) => {
        const firstDate = new Date(firstGroup.latestDate).getTime() || 0
        const secondDate = new Date(secondGroup.latestDate).getTime() || 0

        if (secondDate !== firstDate) {
          return secondDate - firstDate
        }

        return (firstGroup.exercise_name || '').localeCompare(secondGroup.exercise_name || '')
      })
})

async function loadExercises() {
  isExerciseLoading.value = true

  try {
    const exerciseData = await apiRequest('/exercises', { token: getToken() })
    exercises.value = exerciseData.map(normalizeExercise)
  } catch (error) {
    errorMessage.value = t('progress.exerciseLoadError')
  } finally {
    isExerciseLoading.value = false
  }
}

async function loadProgressData() {
  isLoading.value = true

  try {
    const token = getToken()
    const [entryData, summaryData] = await Promise.all([
      apiRequest('/progress', { token }),
      apiRequest('/progress/summary', { token }),
    ])

    entries.value = entryData.map(normalizeProgressEntry)
    summary.value = summaryData.map(normalizeProgressSummary)
  } catch (error) {
    errorMessage.value = t('progress.loadError')
  } finally {
    isLoading.value = false
  }
}

async function loadData() {
  errorMessage.value = ''
  await Promise.all([loadExercises(), loadProgressData()])
}

function resetForm() {
  form.value = {
    exercise_id: '',
    entry_date: dateInputValue(),
    sets: 3,
    reps: 10,
    weight: '',
    duration_minutes: 30,
    distance_km: '',
    intensity_level: '',
  }
}

function openExercisePicker() {
  exercisePickerOpen.value = true

  if (!isExerciseLoading.value && exercises.value.length === 0) {
    loadExercises()
  }
}

function searchText(value) {
  return String(value || '').toLowerCase()
}

function exerciseImageSource(item) {
  const exerciseName = item?.exercise_name || item?.name || ''
  return getExerciseImage(exerciseName) || item?.image_url || null
}

function closeExercisePicker() {
  exercisePickerOpen.value = false
}

function chooseExercise(exercise) {
  form.value.exercise_id = exercise.id

  if (isCardioExercise(exercise)) {
    form.value.duration_minutes = form.value.duration_minutes || 30
  } else {
    form.value.sets = form.value.sets || 3
    form.value.reps = form.value.reps || 10
  }

  closeExercisePicker()
}

function resetPickerFilters() {
  pickerSearch.value = ''
  pickerCategory.value = ''
  pickerMuscleGroup.value = ''
}

function handlePickerCategoryChange() {
  if (
      pickerCategory.value &&
      pickerMuscleGroup.value &&
      !categoryToMuscleGroups[pickerCategory.value]?.includes(pickerMuscleGroup.value)
  ) {
    pickerMuscleGroup.value = ''
  }
}

function handlePickerMuscleGroupChange() {
  if (
      pickerMuscleGroup.value &&
      pickerCategory.value &&
      !categoryToMuscleGroups[pickerCategory.value]?.includes(pickerMuscleGroup.value)
  ) {
    pickerCategory.value = ''
  }
}

function validForm() {
  if (!form.value.exercise_id || !form.value.entry_date) {
    return false
  }

  if (selectedExerciseIsCardio.value) {
    return Number(form.value.duration_minutes) > 0
  }

  return Number(form.value.sets) > 0 && Number(form.value.reps) > 0
}

function entryPayload() {
  if (selectedExerciseIsCardio.value) {
    return {
      exercise_id: Number(form.value.exercise_id),
      entry_date: form.value.entry_date,
      duration_minutes: Number(form.value.duration_minutes),
      distance_km: form.value.distance_km === '' ? null : normalizeDistanceValue(form.value.distance_km),
      intensity_level: form.value.intensity_level === '' ? null : Number(form.value.intensity_level),
    }
  }

  return {
    exercise_id: Number(form.value.exercise_id),
    entry_date: form.value.entry_date,
    sets: Number(form.value.sets),
    reps: Number(form.value.reps),
    weight: form.value.weight === '' ? null : normalizeWeightValue(form.value.weight),
  }
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
      body: entryPayload(),
    })

    successMessage.value = t('progress.saved')
    resetForm()
    await loadProgressData()
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

function isCardioExercise(exercise) {
  return exercise?.category === 'Cardio'
}

function numericValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function hasMetricValue(value) {
  const number = numericValue(value)
  return number !== null && number > 0
}

function formatNumber(value, maximumFractionDigits = 1, minimumFractionDigits = 0) {
  const number = numericValue(value)

  if (number === null) {
    return '-'
  }

  return number.toLocaleString(localeName(), {
    minimumFractionDigits,
    maximumFractionDigits,
  })
}

function formatWeight(weight) {
  if (!hasMetricValue(weight)) {
    return '-'
  }

  const value = formatWeightValue(weight)
  return `${formatNumber(value, 1)} ${weightUnit.value}`
}

function formatDuration(value) {
  if (!hasMetricValue(value)) {
    return '-'
  }

  return `${formatNumber(value, 0)} ${t('common.minutesShort')}`
}

function formatDistance(value) {
  if (!hasMetricValue(value)) {
    return '-'
  }

  return `${formatNumber(formatDistanceValue(value), 2, 2)} ${distanceUnit.value}`
}

function formatLevel(value) {
  if (!hasMetricValue(value)) {
    return '-'
  }

  return `${t('common.level')} ${formatNumber(value, 0)}`
}

function formatSpeed(value) {
  if (!hasMetricValue(value)) {
    return '-'
  }

  return `${formatNumber(formatSpeedValue(value), 2, 2)} ${
      distanceUnit.value === 'mi' ? t('common.mph') : t('common.kmh')
  }`
}

function formatTrainingLoad(value) {
  return formatNumber(value, 1)
}

function totalReps(entry) {
  const sets = numericValue(entry.sets)
  const reps = numericValue(entry.reps)

  if (!sets || !reps) {
    return null
  }

  return sets * reps
}

function chartMetricType(groupEntries, isCardio) {
  if (isCardio) {
    const distancePoints = groupEntries.filter((entry) => hasMetricValue(entry.distance_km)).length
    return distancePoints >= Math.min(2, groupEntries.length) ? 'distance' : 'duration'
  }

  return groupEntries.some((entry) => hasMetricValue(entry.weight))
      ? 'estimatedOneRepMax'
      : 'totalReps'
}

function progressMetricValue(entry, metricType) {
  if (metricType === 'distance') {
    return hasMetricValue(entry.distance_km) ? numericValue(entry.distance_km) : null
  }

  if (metricType === 'duration') {
    return hasMetricValue(entry.duration_minutes) ? numericValue(entry.duration_minutes) : null
  }

  if (metricType === 'estimatedOneRepMax') {
    return estimateOneRepMax(entry.weight, entry.reps)
  }

  return totalReps(entry)
}

function chartMetricLabel(metricType) {
  const labels = {
    distance: t('common.distance'),
    duration: t('common.duration'),
    estimatedOneRepMax: t('progress.estimatedOneRepMax'),
    totalReps: t('progress.totalReps'),
  }

  return labels[metricType] || ''
}

function formatMetricValue(value, metricType) {
  if (metricType === 'distance') {
    return formatDistance(value)
  }

  if (metricType === 'duration') {
    return formatDuration(value)
  }

  if (metricType === 'estimatedOneRepMax') {
    return formatWeight(value)
  }

  return `${formatNumber(value, 0)} ${t('common.reps')}`
}

function formatCardioEntry(entry) {
  return [
    formatDuration(entry.duration_minutes),
    formatDistance(entry.distance_km),
    formatLevel(entry.intensity_level),
  ].filter((value) => value !== '-').join(' - ') || '-'
}

function formatStrengthEntry(entry) {
  const details = [`${entry.sets || '-'} x ${entry.reps || '-'}`]

  if (hasMetricValue(entry.weight)) {
    details.push(formatWeight(entry.weight))
  }

  return details.join(' - ')
}

function formatEntryDetails(entry) {
  return isCardioExercise(entry) ? formatCardioEntry(entry) : formatStrengthEntry(entry)
}

function summaryPrimaryLabel(item) {
  if (isCardioExercise(item)) {
    return t('progress.maxDuration')
  }

  return hasMetricValue(item.max_estimated_one_rep_max)
      ? t('progress.estimatedOneRepMax')
      : t('progress.maxWeight')
}

function summaryPrimaryValue(item) {
  if (isCardioExercise(item)) {
    return formatDuration(item.max_duration_minutes)
  }

  return formatWeight(item.max_estimated_one_rep_max || item.max_weight)
}

function summaryDetailText(item) {
  if (isCardioExercise(item)) {
    return [
      `${t('progress.maxDistance')}: ${formatDistance(item.max_distance_km)}`,
      `${t('progress.maxSpeed')}: ${formatSpeed(item.max_speed_kmh)}`,
      `${t('common.level')}: ${hasMetricValue(item.max_intensity_level) ? formatNumber(item.max_intensity_level, 0) : '-'}`,
    ].join(' - ')
  }

  return [
    `${t('progress.maxWeight')}: ${formatWeight(item.max_weight)}`,
    `${t('progress.maxVolume')}: ${formatTrainingLoad(item.max_volume)}`,
  ].join(' - ')
}

onMounted(() => {
  loadData()
})

watch(distanceUnit, (newUnit, oldUnit) => {
  if (
      form.value.distance_km === '' ||
      form.value.distance_km === null ||
      form.value.distance_km === undefined
  ) {
    return
  }

  const distanceKm = normalizeDistanceValue(form.value.distance_km, oldUnit)
  const convertedDistance = formatDistanceValue(distanceKm, newUnit)
  form.value.distance_km = convertedDistance === null ? '' : convertedDistance.toFixed(2)
})

watch(weightUnit, (newUnit, oldUnit) => {
  form.value.weight = convertWeightInputValue(form.value.weight, oldUnit, newUnit)
})
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

      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="message message-success" role="status">{{ successMessage }}</p>

      <form class="progress-form card" @submit.prevent="saveEntry">
        <h2>{{ t('progress.formTitle') }}</h2>

        <div class="progress-form-grid">
          <div class="form-group exercise-select">
            <span class="form-label">{{ t('common.exercise') }}</span>
            <button
                class="exercise-choice"
                type="button"
                @click="openExercisePicker"
            >
              <template v-if="selectedExercise">
                <span class="choice-media">
                  <img
                      v-if="getExerciseImage(selectedExercise.name) || selectedExercise.image_url"
                      :src="getExerciseImage(selectedExercise.name) || selectedExercise.image_url"
                      :alt="selectedExercise.name"
                  />
                </span>
                <span class="choice-body">
                  <strong>{{ selectedExercise.name }}</strong>
                  <small>
                    {{ translateCategory(selectedExercise.category) }}
                    -
                    {{ translateMuscleGroup(selectedExercise.muscle_group) }}
                  </small>
                </span>
                <span class="choice-action">{{ t('workouts.changeExercise') }}</span>
              </template>

              <template v-else>
                <span class="choice-empty">
                  {{ isExerciseLoading ? t('common.loading') : t('workouts.chooseExercise') }}
                </span>
              </template>
            </button>
            <small v-if="!isExerciseLoading && exercises.length === 0" class="field-hint">
              {{ t('progress.noExercisesAvailable') }}
            </small>
          </div>

          <div class="form-group">
            <label class="form-label" for="entryDate">{{ t('progress.entryDate') }}</label>
            <input id="entryDate" v-model="form.entry_date" class="input" type="date" />
          </div>

          <template v-if="selectedExerciseIsCardio">
            <div class="form-group">
              <label class="form-label" for="duration">{{ t('common.duration') }}</label>
              <input
                  id="duration"
                  v-model="form.duration_minutes"
                  class="input"
                  type="number"
                  min="1"
                  :placeholder="t('common.minutesShort')"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="distance">{{ t('common.distance') }}</label>
              <input
                  id="distance"
                  v-model="form.distance_km"
                  class="input"
                  type="number"
                  min="0"
                  step="0.01"
                  :placeholder="distanceUnit"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="level">{{ t('common.level') }}</label>
              <input
                  id="level"
                  v-model="form.intensity_level"
                  class="input"
                  type="number"
                  min="1"
                  :placeholder="t('common.optional')"
              />
            </div>
          </template>

          <template v-else>
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
                  step="0.0001"
                  :placeholder="weightUnit"
              />
            </div>
          </template>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" type="submit" :disabled="isSaving">
            {{ isSaving ? t('common.saving') : t('progress.saveEntry') }}
          </button>
        </div>
      </form>

      <div v-if="isLoading" class="empty-state card">
        <p>{{ t('common.loading') }}</p>
      </div>

      <template v-else>
        <section class="chart-section">
          <div class="section-head">
            <div>
              <h2>{{ t('progress.chartTitle') }}</h2>
              <p>{{ t('progress.chartSubtitle') }}</p>
            </div>
          </div>

          <div v-if="progressCharts.length === 0" class="empty-state card">
            <p>{{ t('progress.noChartData') }}</p>
          </div>

          <div v-else class="chart-grid">
            <article v-for="chart in progressCharts" :key="chart.history_key" class="chart-card card">
              <div class="chart-card-head">
                <div class="chart-title-row">
                  <span class="progress-media">
                    <img
                        v-if="exerciseImageSource(chart)"
                        :src="exerciseImageSource(chart)"
                        :alt="chart.exercise_name"
                    />
                    <span v-else>{{ t('exercises.noImage') }}</span>
                  </span>
                  <div>
                    <h3>{{ chart.exercise_name }}</h3>
                    <span>{{ translateMuscleGroup(chart.muscle_group) }}</span>
                  </div>
                </div>
                <span class="pill">{{ chart.totalEntries }} {{ t('progress.entries') }}</span>
              </div>

              <div
                  class="line-chart-wrap"
                  role="img"
                  :aria-label="`${chart.exercise_name}: ${chart.metricLabel} ${formatMetricValue(chart.latestValue, chart.metricType)}`"
              >
                <svg class="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline class="chart-guide" points="0,25 100,25"></polyline>
                  <polyline class="chart-guide" points="0,50 100,50"></polyline>
                  <polyline class="chart-guide" points="0,75 100,75"></polyline>
                  <polyline
                      v-if="chart.points.length > 1"
                      class="chart-line"
                      :points="chart.linePoints"
                  ></polyline>
                  <circle
                      v-for="point in chart.points"
                      :key="point.id"
                      class="chart-dot"
                      :cx="point.x"
                      :cy="point.y"
                      r="2.8"
                  >
                    <title>{{ formatDate(point.date) }}: {{ formatMetricValue(point.value, chart.metricType) }}</title>
                  </circle>
                </svg>
              </div>

              <div class="chart-meta">
                <span>{{ t('progress.startValue') }} {{ chart.metricLabel }}: {{ formatMetricValue(chart.firstValue, chart.metricType) }}</span>
                <span>{{ t('progress.currentValue') }}: {{ formatMetricValue(chart.latestValue, chart.metricType) }}</span>
              </div>
            </article>
          </div>
        </section>

        <section class="summary-section">
          <div class="section-head">
            <h2>{{ t('progress.summaryTitle') }}</h2>
          </div>

          <div v-if="summary.length === 0" class="empty-state card">
            <p>{{ t('progress.noSummary') }}</p>
          </div>

          <div v-else class="summary-grid">
            <article v-for="item in summary" :key="historyGroupKey(item)" class="summary-card card">
              <div class="summary-top">
                <div class="summary-title-row">
                  <span class="progress-media">
                    <img
                        v-if="exerciseImageSource(item)"
                        :src="exerciseImageSource(item)"
                        :alt="item.exercise_name"
                    />
                    <span v-else>{{ t('exercises.noImage') }}</span>
                  </span>
                  <div>
                    <h3>{{ item.exercise_name }}</h3>
                    <span>{{ translateMuscleGroup(item.muscle_group) }}</span>
                  </div>
                </div>
                <span class="pill">{{ item.total_entries }} {{ t('progress.entries') }}</span>
              </div>

              <div class="metric-row">
                <span>{{ summaryPrimaryLabel(item) }}</span>
                <strong>{{ summaryPrimaryValue(item) }}</strong>
              </div>

              <div class="metric-row">
                <span>{{ t('progress.latest') }}</span>
                <strong>{{ formatDate(item.latest_date) }}</strong>
              </div>

              <small>{{ summaryDetailText(item) }}</small>
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
              <div class="entry-main">
                <span class="progress-media">
                  <img
                      v-if="exerciseImageSource(entry)"
                      :src="exerciseImageSource(entry)"
                      :alt="entry.exercise_name"
                  />
                  <span v-else>{{ t('exercises.noImage') }}</span>
                </span>
                <div>
                <span class="entry-date">{{ formatDate(entry.entry_date) }}</span>
                <h3>{{ entry.exercise_name }}</h3>
                <p>
                  {{ formatEntryDetails(entry) }}
                </p>
                <small>{{ t('progress.source') }}: {{ entry.workout_title || t('progress.manualEntry') }}</small>
                </div>
              </div>

              <button
                  v-if="entry.source_type === 'manual'"
                  class="btn btn-danger"
                  type="button"
                  @click="deleteEntry(entry)"
              >
                {{ t('common.delete') }}
              </button>
            </article>
          </div>
        </section>
      </template>
    </div>
  </section>

  <Teleport to="body">
    <div
        v-if="exercisePickerOpen"
        class="modal-backdrop"
        role="presentation"
        @click.self="closeExercisePicker"
    >
      <section
          ref="exercisePickerRef"
          class="exercise-picker card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="progress-exercise-picker-title"
          tabindex="-1"
          @keydown="handleModalKeydown"
      >
        <div class="picker-head">
          <div>
            <span class="eyebrow">{{ t('workouts.selectedExercise') }}</span>
            <h2 id="progress-exercise-picker-title">{{ t('workouts.exercisePickerTitle') }}</h2>
            <p>{{ t('workouts.exercisePickerSubtitle') }}</p>
          </div>
          <button
              class="btn btn-secondary"
              type="button"
              @click="closeExercisePicker"
          >
            {{ t('common.close') }}
          </button>
        </div>

        <div class="picker-toolbar">
          <div class="form-group search-field">
            <label class="form-label" for="progressExerciseSearch">{{ t('workouts.searchExercise') }}</label>
            <input
                id="progressExerciseSearch"
                data-autofocus
                v-model="pickerSearch"
                class="input"
                type="search"
                :placeholder="t('workouts.searchExercise')"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="progressPickerCategory">{{ t('exercises.category') }}</label>
            <select
                id="progressPickerCategory"
                v-model="pickerCategory"
                class="input"
                @change="handlePickerCategoryChange"
            >
              <option value="">{{ t('exercises.allCategories') }}</option>
              <option v-for="category in availablePickerCategoryOptions" :key="category" :value="category">
                {{ translateCategory(category) }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="progressPickerMuscle">{{ t('exercises.muscleGroup') }}</label>
            <select
                id="progressPickerMuscle"
                v-model="pickerMuscleGroup"
                class="input"
                @change="handlePickerMuscleGroupChange"
            >
              <option value="">{{ t('exercises.allMuscleGroups') }}</option>
              <option v-for="muscle in availablePickerMuscleGroupOptions" :key="muscle" :value="muscle">
                {{ translateMuscleGroup(muscle) }}
              </option>
            </select>
          </div>

          <button class="btn btn-secondary picker-reset" type="button" @click="resetPickerFilters">
            {{ t('exercises.resetFilters') }}
          </button>
        </div>

        <div v-if="isExerciseLoading" class="empty-state">
          <p>{{ t('common.loading') }}</p>
        </div>

        <div v-else-if="filteredPickerExercises.length === 0" class="empty-state">
          <p>{{ t('workouts.noExerciseMatches') }}</p>
        </div>

        <div v-else class="picker-grid">
          <article
              v-for="exercise in filteredPickerExercises"
              :key="exercise.id"
              class="picker-card"
          >
            <div class="picker-media">
              <img
                  v-if="getExerciseImage(exercise.name) || exercise.image_url"
                  :src="getExerciseImage(exercise.name) || exercise.image_url"
                  :alt="exercise.name"
              />
              <span v-else>{{ t('exercises.noImage') }}</span>
            </div>

            <div class="picker-card-body">
              <div>
                <h3>{{ exercise.name }}</h3>
                <div class="exercise-tags">
                  <span>{{ translateCategory(exercise.category) }}</span>
                  <span>{{ translateMuscleGroup(exercise.muscle_group) }}</span>
                </div>
              </div>

              <p>{{ exercise.user_id ? (exercise.description || t('exercises.noDescription')) : translateExerciseDescription(exercise) }}</p>

              <button class="btn btn-primary" type="button" @click="chooseExercise(exercise)">
                {{ t('workouts.chooseExercise') }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
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
  align-items: end;
  margin-top: 1rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.exercise-choice {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 74px;
  padding: 0.55rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  text-align: left;
  gap: 0.75rem;
}

.exercise-choice:hover:not(:disabled) {
  border-color: var(--accent);
}

.choice-media {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 58px;
  flex: 0 0 62px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-soft);
}

.choice-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.25rem;
}

.choice-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.choice-body strong,
.choice-body small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-body small {
  color: var(--text-soft);
  font-weight: 750;
}

.choice-action,
.choice-empty {
  color: var(--accent);
  font-weight: 850;
}

.choice-empty {
  width: 100%;
  text-align: center;
}

.field-hint {
  color: var(--text-muted);
  font-size: 0.86rem;
  font-weight: 700;
}

.chart-section {
  margin-top: 1.5rem;
}

.summary-section,
.entries-section {
  margin-top: 1.5rem;
}

.section-head {
  margin-bottom: 0.8rem;
}

.section-head p {
  color: var(--text-soft);
  font-size: 0.94rem;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.chart-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.chart-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.9rem;
}

.chart-title-row,
.summary-title-row,
.entry-main {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.progress-media {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 64px;
  flex: 0 0 72px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 800;
  text-align: center;
}

.progress-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.25rem;
}

.chart-card h3 {
  font-size: 1.05rem;
  font-weight: 850;
  line-height: 1.25;
}

.chart-card-head span:not(.pill) {
  color: var(--text-soft);
}

.line-chart-wrap {
  height: 170px;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
}

.line-chart {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.chart-guide {
  fill: none;
  stroke: rgba(102, 97, 88, 0.18);
  stroke-width: 0.7;
}

.chart-line {
  fill: none;
  stroke: var(--accent);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3.2;
  vector-effect: non-scaling-stroke;
}

.chart-dot {
  fill: var(--surface);
  stroke: var(--accent);
  stroke-width: 2.6;
  vector-effect: non-scaling-stroke;
}

.chart-meta {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  color: var(--text-soft);
  font-size: 0.88rem;
  font-weight: 750;
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
  align-items: flex-start;
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

.entry-main > div,
.summary-title-row > div,
.chart-title-row > div {
  min-width: 0;
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

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow-y: auto;
  background: rgba(36, 31, 24, 0.42);
  -webkit-overflow-scrolling: touch;
}

.exercise-picker {
  display: flex;
  flex-direction: column;
  width: min(1080px, 100%);
  max-height: min(820px, calc(100vh - 2rem));
  max-height: min(820px, calc(100dvh - 2rem));
  padding: 1.2rem;
  overflow: hidden;
}

.picker-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.picker-head h2 {
  font-size: 1.35rem;
  font-weight: 850;
}

.picker-head p {
  max-width: 680px;
  color: var(--text-soft);
}

.picker-head .btn {
  flex: 0 0 auto;
}

.picker-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1.2fr) minmax(180px, 0.8fr) minmax(180px, 0.8fr) auto;
  gap: 0.8rem;
  align-items: end;
  margin-bottom: 1rem;
}

.picker-reset {
  white-space: nowrap;
}

.picker-grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
  align-content: start;
  min-height: 0;
  overflow: auto;
  padding-right: 0.2rem;
}

.picker-card {
  display: flex;
  min-height: 190px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.picker-media {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38%;
  min-width: 120px;
  min-height: 190px;
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 800;
  text-align: center;
}

.picker-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.7rem;
}

.picker-card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.85rem;
}

.picker-card h3 {
  font-size: 1rem;
  font-weight: 850;
  line-height: 1.25;
}

.exercise-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.exercise-tags span {
  padding: 0.26rem 0.48rem;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 0.78rem;
  font-weight: 800;
}

.picker-card p {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--text-soft);
  font-size: 0.92rem;
  line-height: 1.4;
}

.picker-card-body .btn {
  align-self: flex-start;
  margin-top: auto;
}

@media (max-width: 1050px) {
  .progress-form-grid,
  .chart-grid,
  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }

  .picker-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .exercise-select {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .modal-backdrop {
    align-items: flex-start;
  }

  .exercise-picker {
    max-height: none;
    overflow: visible;
  }

  .progress-form-grid,
  .picker-toolbar,
  .picker-grid,
  .chart-grid,
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

  .chart-card-head,
  .picker-head,
  .chart-meta {
    align-items: stretch;
    flex-direction: column;
  }

  .picker-card {
    flex-direction: column;
    min-height: 0;
  }

  .picker-grid {
    flex: 0 0 auto;
    overflow: visible;
    padding-right: 0;
  }

  .picker-media {
    width: 100%;
    min-width: 0;
    min-height: 0;
    height: 170px;
  }

  .picker-card-body .btn {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .progress-form,
  .chart-card,
  .summary-card,
  .entry-card,
  .exercise-picker {
    padding: 1rem;
  }

  .form-actions .btn,
  .picker-head .btn,
  .picker-card-body .btn,
  .entry-card .btn {
    width: 100%;
  }

  .summary-top,
  .metric-row,
  .chart-title-row,
  .summary-title-row,
  .entry-main {
    align-items: flex-start;
    flex-direction: column;
  }

  .progress-media {
    width: 100%;
    height: 150px;
    flex-basis: auto;
  }

  .line-chart-wrap {
    height: 150px;
  }

  .summary-card small,
  .entry-card p,
  .chart-meta span {
    overflow-wrap: anywhere;
  }

  .choice-action {
    display: none;
  }

  .modal-backdrop {
    padding: 0.65rem;
  }
}
</style>
