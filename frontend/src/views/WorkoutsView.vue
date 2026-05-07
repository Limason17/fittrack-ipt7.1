<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../utils/api'
import { getToken } from '../utils/auth'
import { getExerciseImage } from '../utils/exerciseImageMap'
import {
  formatDate,
  t,
  translateCategory,
  translateExerciseDescription,
  translateMuscleGroup,
  weekdayNames,
} from '../utils/i18n'
import { normalizeExercise, normalizeWorkout } from '../utils/taxonomy'

const workouts = ref([])
const exercises = ref([])
const isLoading = ref(true)
const isSaving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const showForm = ref(false)
const editingWorkoutId = ref(null)
const selectedMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

const exercisePickerOpen = ref(false)
const pickerRowIndex = ref(null)
const pickerSearch = ref('')
const pickerCategory = ref('')
const pickerMuscleGroup = ref('')

const categoryOptions = [
  'Brust',
  'Rücken',
  'Beine',
  'Schultern',
  'Arme',
  'Core',
  'Cardio',
]

const categoryToMuscleGroups = {
  Brust: ['Brustmitte', 'Obere Brust'],
  Rücken: ['Latissimus', 'Oberer Rücken'],
  Beine: ['Quads', 'Hamstrings', 'Waden'],
  Schultern: ['Vordere Schulter', 'Seitliche Schulter'],
  Arme: ['Bizeps', 'Trizeps'],
  Core: ['Bauch', 'Core'],
  Cardio: ['Ganzkörper', 'Beine'],
}

const allMuscleGroups = [...new Set(Object.values(categoryToMuscleGroups).flat())]

function dateInputValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 10)
}

function emptyWorkoutExercise() {
  return {
    exercise_id: '',
    sets: 3,
    reps: 10,
    weight: '',
  }
}

const form = ref({
  title: '',
  workout_date: dateInputValue(),
  notes: '',
  exercises: [emptyWorkoutExercise()],
})

const monthLabel = computed(() =>
    formatDate(selectedMonth.value, { month: 'long', year: 'numeric' })
)

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
    const matchesSearch =
        !search ||
        exercise.name.toLowerCase().includes(search) ||
        translateMuscleGroup(exercise.muscle_group).toLowerCase().includes(search) ||
        translateCategory(exercise.category).toLowerCase().includes(search)

    return matchesCategory && matchesMuscle && matchesSearch
  })
})

const workoutsByDate = computed(() => {
  const map = new Map()

  workouts.value.forEach((workout) => {
    if (!map.has(workout.workout_date)) {
      map.set(workout.workout_date, [])
    }

    map.get(workout.workout_date).push(workout)
  })

  return map
})

const calendarDays = computed(() => {
  const year = selectedMonth.value.getFullYear()
  const month = selectedMonth.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7
  const days = []

  for (let index = 0; index < leadingEmptyDays; index += 1) {
    days.push({ key: `empty-${index}`, empty: true })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = dateInputValue(new Date(year, month, day))
    days.push({
      key: date,
      day,
      date,
      workouts: workoutsByDate.value.get(date) || [],
    })
  }

  return days
})

async function loadData() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const token = getToken()
    const [workoutData, exerciseData] = await Promise.all([
      apiRequest('/workouts', { token }),
      apiRequest('/exercises', { token }),
    ])

    workouts.value = workoutData.map(normalizeWorkout)
    exercises.value = exerciseData.map(normalizeExercise)
  } catch (error) {
    errorMessage.value = t('workouts.loadError')
  } finally {
    isLoading.value = false
  }
}

function resetForm() {
  form.value = {
    title: '',
    workout_date: dateInputValue(),
    notes: '',
    exercises: [emptyWorkoutExercise()],
  }
  editingWorkoutId.value = null
}

function openCreateForm() {
  resetForm()
  showForm.value = true
}

function closeForm() {
  resetForm()
  closeExercisePicker()
  showForm.value = false
}

function addExerciseRow() {
  form.value.exercises.push(emptyWorkoutExercise())
}

function removeExerciseRow(index) {
  if (form.value.exercises.length === 1) {
    form.value.exercises = [emptyWorkoutExercise()]
    return
  }

  form.value.exercises.splice(index, 1)
}

function selectedExerciseById(exerciseId) {
  return exercises.value.find((exercise) => Number(exercise.id) === Number(exerciseId))
}

function openExercisePicker(index) {
  pickerRowIndex.value = index
  exercisePickerOpen.value = true
}

function closeExercisePicker() {
  exercisePickerOpen.value = false
  pickerRowIndex.value = null
}

function chooseExercise(exercise) {
  if (pickerRowIndex.value === null) {
    return
  }

  form.value.exercises[pickerRowIndex.value].exercise_id = exercise.id
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

function validWorkoutForm() {
  if (!form.value.title || !form.value.workout_date || form.value.exercises.length === 0) {
    return false
  }

  return form.value.exercises.every(
      (row) => row.exercise_id && Number(row.sets) > 0 && Number(row.reps) > 0
  )
}

function workoutPayload() {
  return {
    title: form.value.title,
    workout_date: form.value.workout_date,
    notes: form.value.notes,
    exercises: form.value.exercises.map((row) => ({
      exercise_id: Number(row.exercise_id),
      sets: Number(row.sets),
      reps: Number(row.reps),
      weight: row.weight === '' ? null : Number(row.weight),
    })),
  }
}

async function saveWorkout() {
  errorMessage.value = ''
  successMessage.value = ''

  if (!validWorkoutForm()) {
    errorMessage.value = t('workouts.missingFields')
    return
  }

  const isEditing = !!editingWorkoutId.value
  isSaving.value = true

  try {
    await apiRequest(isEditing ? `/workouts/${editingWorkoutId.value}` : '/workouts', {
      method: isEditing ? 'PUT' : 'POST',
      token: getToken(),
      body: workoutPayload(),
    })

    successMessage.value = isEditing ? t('workouts.updated') : t('workouts.created')
    closeForm()
    await loadData()
  } catch (error) {
    errorMessage.value = t('workouts.saveError')
  } finally {
    isSaving.value = false
  }
}

function startEditWorkout(workout) {
  form.value = {
    title: workout.title || '',
    workout_date: workout.workout_date || dateInputValue(),
    notes: workout.notes || '',
    exercises: workout.exercises.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      sets: exercise.sets,
      reps: exercise.reps,
      weight: exercise.weight ?? '',
    })),
  }

  if (form.value.exercises.length === 0) {
    form.value.exercises = [emptyWorkoutExercise()]
  }

  editingWorkoutId.value = workout.id
  showForm.value = true
}

async function deleteWorkout(workout) {
  if (!confirm(t('workouts.confirmDelete', { title: workout.title }))) {
    return
  }

  errorMessage.value = ''
  successMessage.value = ''

  try {
    await apiRequest(`/workouts/${workout.id}`, {
      method: 'DELETE',
      token: getToken(),
    })

    successMessage.value = t('workouts.deleted')
    await loadData()
  } catch (error) {
    errorMessage.value = t('workouts.deleteError')
  }
}

function changeMonth(direction) {
  selectedMonth.value = new Date(
      selectedMonth.value.getFullYear(),
      selectedMonth.value.getMonth() + direction,
      1
  )
}

function localeName() {
  return document.documentElement.lang === 'en' ? 'en-US' : 'de-CH'
}

function formatWeight(weight) {
  if (weight === null || weight === undefined || weight === '') {
    return '-'
  }

  return `${Number(weight).toLocaleString(localeName(), { maximumFractionDigits: 2 })} ${t('common.kg')}`
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header-row">
        <div>
          <span class="eyebrow">{{ t('workouts.eyebrow') }}</span>
          <h1 class="page-title">{{ t('workouts.title') }}</h1>
          <p class="page-subtitle">
            {{ t('workouts.subtitle') }}
          </p>
        </div>

        <button class="btn btn-primary" type="button" @click="openCreateForm">
          {{ t('workouts.newWorkout') }}
        </button>
      </div>

      <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
      <p v-if="successMessage" class="message message-success">{{ successMessage }}</p>

      <div v-if="showForm" class="workout-form card">
        <div class="form-title-row">
          <h2>{{ editingWorkoutId ? t('workouts.formEditTitle') : t('workouts.formCreateTitle') }}</h2>
          <button class="btn btn-secondary" type="button" @click="closeForm">
            {{ t('common.close') }}
          </button>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label" for="workoutTitle">{{ t('workouts.titleLabel') }}</label>
            <input
                id="workoutTitle"
                v-model="form.title"
                class="input"
                type="text"
                :placeholder="t('workouts.titlePlaceholder')"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="workoutDate">{{ t('common.date') }}</label>
            <input
                id="workoutDate"
                v-model="form.workout_date"
                class="input"
                type="date"
            />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="workoutNotes">{{ t('common.notes') }}</label>
          <textarea
              id="workoutNotes"
              v-model="form.notes"
              class="input textarea"
              :placeholder="t('workouts.notesPlaceholder')"
          />
        </div>

        <div class="exercise-rows">
          <div
              v-for="(row, index) in form.exercises"
              :key="index"
              class="exercise-row"
          >
            <div class="form-group exercise-select">
              <span class="form-label">{{ t('common.exercise') }}</span>

              <button
                  class="exercise-choice"
                  type="button"
                  @click="openExercisePicker(index)"
              >
                <template v-if="selectedExerciseById(row.exercise_id)">
                  <span class="choice-media">
                    <img
                        v-if="getExerciseImage(selectedExerciseById(row.exercise_id).name) || selectedExerciseById(row.exercise_id).image_url"
                        :src="getExerciseImage(selectedExerciseById(row.exercise_id).name) || selectedExerciseById(row.exercise_id).image_url"
                        :alt="selectedExerciseById(row.exercise_id).name"
                    />
                  </span>
                  <span class="choice-body">
                    <strong>{{ selectedExerciseById(row.exercise_id).name }}</strong>
                    <small>
                      {{ translateCategory(selectedExerciseById(row.exercise_id).category) }}
                      -
                      {{ translateMuscleGroup(selectedExerciseById(row.exercise_id).muscle_group) }}
                    </small>
                  </span>
                  <span class="choice-action">{{ t('workouts.changeExercise') }}</span>
                </template>

                <template v-else>
                  <span class="choice-empty">{{ t('workouts.chooseExercise') }}</span>
                </template>
              </button>
            </div>

            <div class="form-group small-field">
              <label class="form-label" :for="`sets-${index}`">{{ t('common.sets') }}</label>
              <input :id="`sets-${index}`" v-model="row.sets" class="input" type="number" min="1" />
            </div>

            <div class="form-group small-field">
              <label class="form-label" :for="`reps-${index}`">{{ t('common.reps') }}</label>
              <input :id="`reps-${index}`" v-model="row.reps" class="input" type="number" min="1" />
            </div>

            <div class="form-group small-field">
              <label class="form-label" :for="`weight-${index}`">{{ t('common.weight') }}</label>
              <input
                  :id="`weight-${index}`"
                  v-model="row.weight"
                  class="input"
                  type="number"
                  min="0"
                  step="0.25"
                  :placeholder="t('common.kg')"
              />
            </div>

            <button class="btn btn-danger row-remove" type="button" @click="removeExerciseRow(index)">
              {{ t('common.delete') }}
            </button>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" type="button" @click="addExerciseRow">
            {{ t('workouts.addExercise') }}
          </button>
          <button class="btn btn-primary" type="button" :disabled="isSaving" @click="saveWorkout">
            {{ isSaving ? t('common.saving') : (editingWorkoutId ? t('workouts.updateWorkout') : t('workouts.saveWorkout')) }}
          </button>
        </div>
      </div>

      <div v-if="isLoading" class="empty-state card">
        <p>{{ t('common.loading') }}</p>
      </div>

      <template v-else>
        <section class="calendar-card card">
          <div class="calendar-head">
            <h2>{{ t('workouts.calendar') }}</h2>
            <div class="calendar-controls">
              <button class="btn btn-secondary" type="button" :aria-label="t('workouts.previousMonth')" @click="changeMonth(-1)">
                &lt;
              </button>
              <strong>{{ monthLabel }}</strong>
              <button class="btn btn-secondary" type="button" :aria-label="t('workouts.nextMonth')" @click="changeMonth(1)">
                &gt;
              </button>
            </div>
          </div>

          <div class="weekday-grid">
            <span v-for="dayName in weekdayNames()" :key="dayName">{{ dayName }}</span>
          </div>

          <div class="calendar-grid">
            <div
                v-for="day in calendarDays"
                :key="day.key"
                class="calendar-day"
                :class="{ 'calendar-day-empty': day.empty, 'calendar-day-active': day.workouts?.length }"
            >
              <template v-if="!day.empty">
                <span class="day-number">{{ day.day }}</span>
                <div class="day-workouts">
                  <span v-for="workout in day.workouts" :key="workout.id">
                    {{ workout.title }}
                  </span>
                </div>
              </template>
            </div>
          </div>
        </section>

        <section class="workout-list-section">
          <div class="list-head">
            <h2>{{ t('workouts.listTitle') }}</h2>
            <span class="pill">{{ t('workouts.total', { count: workouts.length }) }}</span>
          </div>

          <div v-if="workouts.length === 0" class="empty-state card">
            <h3>{{ t('workouts.noWorkouts') }}</h3>
            <p>{{ t('workouts.noWorkoutsText') }}</p>
          </div>

          <div v-else class="workout-grid">
            <article v-for="workout in workouts" :key="workout.id" class="workout-card card">
              <div class="workout-card-head">
                <div>
                  <span class="workout-date">{{ formatDate(workout.workout_date) }}</span>
                  <h3>{{ workout.title }}</h3>
                </div>
                <div class="workout-actions">
                  <button class="btn btn-secondary" type="button" @click="startEditWorkout(workout)">
                    {{ t('common.edit') }}
                  </button>
                  <button class="btn btn-danger" type="button" @click="deleteWorkout(workout)">
                    {{ t('common.delete') }}
                  </button>
                </div>
              </div>

              <p v-if="workout.notes" class="workout-notes">{{ workout.notes }}</p>

              <div class="workout-exercises">
                <div v-for="exercise in workout.exercises" :key="exercise.id" class="workout-exercise">
                  <strong>{{ exercise.name }}</strong>
                  <span>
                    {{ exercise.sets }} x {{ exercise.reps }} - {{ formatWeight(exercise.weight) }}
                  </span>
                </div>
              </div>
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
      <section class="exercise-picker card" role="dialog" aria-modal="true">
        <div class="picker-head">
          <div>
            <span class="eyebrow">{{ t('workouts.selectedExercise') }}</span>
            <h2>{{ t('workouts.exercisePickerTitle') }}</h2>
            <p>{{ t('workouts.exercisePickerSubtitle') }}</p>
          </div>
          <button class="btn btn-secondary" type="button" @click="closeExercisePicker">
            {{ t('common.close') }}
          </button>
        </div>

        <div class="picker-toolbar">
          <div class="form-group search-field">
            <label class="form-label" for="exerciseSearch">{{ t('workouts.searchExercise') }}</label>
            <input
                id="exerciseSearch"
                v-model="pickerSearch"
                class="input"
                type="search"
                :placeholder="t('workouts.searchExercise')"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="pickerCategory">{{ t('exercises.category') }}</label>
            <select
                id="pickerCategory"
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
            <label class="form-label" for="pickerMuscle">{{ t('exercises.muscleGroup') }}</label>
            <select
                id="pickerMuscle"
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

        <div v-if="filteredPickerExercises.length === 0" class="empty-state">
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
.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.4rem;
}

.message {
  margin-bottom: 1rem;
}

.workout-form,
.calendar-card {
  padding: 1.2rem;
  margin-bottom: 1rem;
}

.form-title-row,
.calendar-head,
.list-head,
.workout-card-head,
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.form-title-row h2,
.calendar-head h2,
.list-head h2 {
  font-size: 1.12rem;
  font-weight: 850;
}

.workout-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.exercise-rows {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.exercise-row {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 110px 110px 130px auto;
  gap: 0.75rem;
  align-items: end;
  padding: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
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

.exercise-choice:hover {
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

.row-remove {
  white-space: nowrap;
}

.calendar-controls,
.workout-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.weekday-grid,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.45rem;
}

.weekday-grid {
  margin: 1rem 0 0.45rem;
}

.weekday-grid span {
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-align: center;
}

.calendar-day {
  min-height: 92px;
  padding: 0.55rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fbfaf7;
}

.calendar-day-empty {
  background: transparent;
  border-color: transparent;
}

.calendar-day-active {
  border-color: #c8dfd0;
  background: var(--accent-soft);
}

.day-number {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-soft);
  font-weight: 850;
}

.day-workouts {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.day-workouts span {
  overflow: hidden;
  padding: 0.22rem 0.35rem;
  border-radius: 6px;
  background: #fff;
  color: var(--accent-hover);
  font-size: 0.78rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workout-list-section {
  margin-top: 1.5rem;
}

.list-head {
  margin-bottom: 0.8rem;
}

.empty-state h3 {
  margin-bottom: 0.3rem;
  color: var(--text);
}

.workout-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.workout-card {
  padding: 1rem;
}

.workout-card-head {
  align-items: flex-start;
}

.workout-date {
  color: var(--accent);
  font-size: 0.86rem;
  font-weight: 850;
}

.workout-card h3 {
  margin-top: 0.15rem;
  font-size: 1.1rem;
  font-weight: 850;
}

.workout-notes {
  margin-top: 0.75rem;
  color: var(--text-soft);
}

.workout-exercises {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.9rem;
}

.workout-exercise {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.65rem;
  border-radius: 8px;
  background: var(--surface-soft);
}

.workout-exercise span {
  color: var(--text-soft);
  font-weight: 750;
  white-space: nowrap;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(36, 31, 24, 0.42);
}

.exercise-picker {
  display: flex;
  flex-direction: column;
  width: min(1080px, 100%);
  max-height: min(820px, calc(100vh - 2rem));
  padding: 1.2rem;
  overflow: hidden;
}

.picker-head {
  display: flex;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
  overflow: auto;
  padding-right: 0.2rem;
}

.picker-card {
  display: flex;
  min-height: 100%;
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
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem;
}

.picker-card h3 {
  font-size: 1rem;
  font-weight: 850;
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
  color: var(--text-soft);
  font-size: 0.92rem;
}

@media (max-width: 1120px) {
  .exercise-row,
  .workout-grid {
    grid-template-columns: 1fr;
  }

  .picker-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .header-row,
  .form-title-row,
  .calendar-head,
  .list-head,
  .workout-card-head,
  .form-actions,
  .picker-head {
    align-items: stretch;
    flex-direction: column;
  }

  .picker-toolbar,
  .picker-grid {
    grid-template-columns: 1fr;
  }

  .picker-card {
    flex-direction: column;
  }

  .picker-media {
    width: 100%;
    height: 170px;
  }

  .weekday-grid,
  .calendar-grid {
    gap: 0.3rem;
  }

  .calendar-day {
    min-height: 70px;
    padding: 0.4rem;
  }

  .day-workouts span {
    display: none;
  }
}
</style>
