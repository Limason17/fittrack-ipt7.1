<script setup>
import { computed, onMounted, ref } from 'vue'
import { getToken } from '../utils/auth'
import { apiRequest } from '../utils/api'
import { getExerciseImage } from '../utils/exerciseImageMap'
import {
  t,
  translateCategory,
  translateExerciseDescription,
  translateMuscleGroup,
} from '../utils/i18n'
import { normalizeExercise } from '../utils/taxonomy'

const exercises = ref([])
const isLoading = ref(true)
const errorMessage = ref('')
const successMessage = ref('')

const selectedCategory = ref('')
const selectedMuscleGroup = ref('')
const showCreateForm = ref(false)
const editingExerciseId = ref(null)

const emptyExercise = {
  name: '',
  description: '',
  category: '',
  muscle_group: '',
  image_url: '',
}

const newExercise = ref({ ...emptyExercise })

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

const availableCategoryOptions = computed(() => {
  if (!selectedMuscleGroup.value) {
    return categoryOptions
  }

  return categoryOptions.filter((category) =>
      categoryToMuscleGroups[category]?.includes(selectedMuscleGroup.value)
  )
})

const availableMuscleGroupOptions = computed(() => {
  if (!selectedCategory.value) {
    return allMuscleGroups
  }

  return categoryToMuscleGroups[selectedCategory.value] || []
})

const filteredCreateMuscleGroups = computed(() => {
  if (!newExercise.value.category) {
    return allMuscleGroups
  }

  return categoryToMuscleGroups[newExercise.value.category] || []
})

function resetExerciseForm() {
  newExercise.value = { ...emptyExercise }
  editingExerciseId.value = null
}

async function loadExercises() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const params = new URLSearchParams()

    if (selectedCategory.value) {
      params.append('category', selectedCategory.value)
    }

    if (selectedMuscleGroup.value) {
      params.append('muscle_group', selectedMuscleGroup.value)
    }

    const query = params.toString() ? `?${params.toString()}` : ''
    const data = await apiRequest(`/exercises${query}`, {
      token: getToken(),
    })

    exercises.value = data.map(normalizeExercise)
  } catch (error) {
    errorMessage.value = t('exercises.loadError')
  } finally {
    isLoading.value = false
  }
}

async function saveExercise() {
  errorMessage.value = ''
  successMessage.value = ''

  if (!newExercise.value.name || !newExercise.value.category || !newExercise.value.muscle_group) {
    errorMessage.value = t('exercises.missingFields')
    return
  }

  const isEditing = !!editingExerciseId.value

  try {
    await apiRequest(isEditing ? `/exercises/${editingExerciseId.value}` : '/exercises', {
      method: isEditing ? 'PUT' : 'POST',
      token: getToken(),
      body: newExercise.value,
    })

    successMessage.value = isEditing ? t('exercises.updated') : t('exercises.created')
    resetExerciseForm()
    showCreateForm.value = false
    await loadExercises()
  } catch (error) {
    errorMessage.value = t('exercises.saveError')
  }
}

function handleCategoryChange() {
  if (
      selectedCategory.value &&
      selectedMuscleGroup.value &&
      !categoryToMuscleGroups[selectedCategory.value]?.includes(selectedMuscleGroup.value)
  ) {
    selectedMuscleGroup.value = ''
  }

  loadExercises()
}

function handleMuscleGroupChange() {
  if (
      selectedMuscleGroup.value &&
      selectedCategory.value &&
      !categoryToMuscleGroups[selectedCategory.value]?.includes(selectedMuscleGroup.value)
  ) {
    selectedCategory.value = ''
  }

  loadExercises()
}

function handleCreateCategoryChange() {
  if (
      newExercise.value.category &&
      newExercise.value.muscle_group &&
      !categoryToMuscleGroups[newExercise.value.category]?.includes(newExercise.value.muscle_group)
  ) {
    newExercise.value.muscle_group = ''
  }
}

function resetFilters() {
  selectedCategory.value = ''
  selectedMuscleGroup.value = ''
  loadExercises()
}

function toggleCreateForm() {
  if (showCreateForm.value) {
    resetExerciseForm()
    showCreateForm.value = false
    return
  }

  resetExerciseForm()
  showCreateForm.value = true
}

function startEditExercise(exercise) {
  if (!exercise.user_id) {
    return
  }

  newExercise.value = {
    name: exercise.name || '',
    description: exercise.description || '',
    category: exercise.category || '',
    muscle_group: exercise.muscle_group || '',
    image_url: exercise.image_url || '',
  }
  editingExerciseId.value = exercise.id
  showCreateForm.value = true
}

async function deleteExercise(exercise) {
  if (!exercise.user_id || !confirm(t('exercises.confirmDelete', { name: exercise.name }))) {
    return
  }

  errorMessage.value = ''
  successMessage.value = ''

  try {
    await apiRequest(`/exercises/${exercise.id}`, {
      method: 'DELETE',
      token: getToken(),
    })

    successMessage.value = t('exercises.deleted')
    await loadExercises()
  } catch (error) {
    errorMessage.value = t('exercises.deleteError')
  }
}

function displayDescription(exercise) {
  if (exercise.user_id) {
    return exercise.description || t('exercises.noDescription')
  }

  return translateExerciseDescription(exercise)
}

onMounted(() => {
  loadExercises()
})
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">{{ t('exercises.eyebrow') }}</span>
        <h1 class="page-title">{{ t('exercises.title') }}</h1>
        <p class="page-subtitle">
          {{ t('exercises.subtitle') }}
        </p>
      </div>

      <div class="toolbar card">
        <div class="toolbar-left">
          <div class="filter-group">
            <label class="form-label" for="categoryFilter">{{ t('exercises.category') }}</label>
            <select
                id="categoryFilter"
                v-model="selectedCategory"
                class="input"
                @change="handleCategoryChange"
            >
              <option value="">{{ t('exercises.allCategories') }}</option>
              <option
                  v-for="category in availableCategoryOptions"
                  :key="category"
                  :value="category"
              >
                {{ translateCategory(category) }}
              </option>
            </select>
          </div>

          <div class="filter-group">
            <label class="form-label" for="muscleGroupFilter">{{ t('exercises.muscleGroup') }}</label>
            <select
                id="muscleGroupFilter"
                v-model="selectedMuscleGroup"
                class="input"
                @change="handleMuscleGroupChange"
            >
              <option value="">{{ t('exercises.allMuscleGroups') }}</option>
              <option
                  v-for="muscleGroup in availableMuscleGroupOptions"
                  :key="muscleGroup"
                  :value="muscleGroup"
              >
                {{ translateMuscleGroup(muscleGroup) }}
              </option>
            </select>
          </div>
        </div>

        <div class="toolbar-actions">
          <button class="btn btn-secondary" type="button" @click="resetFilters">
            {{ t('exercises.resetFilters') }}
          </button>
          <button class="btn btn-primary" type="button" @click="toggleCreateForm">
            {{ showCreateForm ? t('common.close') : t('exercises.newExercise') }}
          </button>
        </div>
      </div>

      <div v-if="showCreateForm" class="create-card card">
        <h2>{{ editingExerciseId ? t('exercises.editTitle') : t('exercises.createTitle') }}</h2>

        <div class="create-grid">
          <div class="form-group">
            <label class="form-label" for="exerciseName">{{ t('exercises.name') }}</label>
            <input
                id="exerciseName"
                v-model="newExercise.name"
                type="text"
                class="input"
                placeholder="Cable Fly"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="exerciseCategory">{{ t('exercises.category') }}</label>
            <select
                id="exerciseCategory"
                v-model="newExercise.category"
                class="input"
                @change="handleCreateCategoryChange"
            >
              <option value="">{{ t('exercises.chooseCategory') }}</option>
              <option v-for="category in categoryOptions" :key="category" :value="category">
                {{ translateCategory(category) }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="exerciseMuscleGroup">{{ t('exercises.muscleGroup') }}</label>
            <select
                id="exerciseMuscleGroup"
                v-model="newExercise.muscle_group"
                class="input"
            >
              <option value="">{{ t('exercises.chooseMuscleGroup') }}</option>
              <option
                  v-for="muscleGroup in filteredCreateMuscleGroups"
                  :key="muscleGroup"
                  :value="muscleGroup"
              >
                {{ translateMuscleGroup(muscleGroup) }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="exerciseImage">{{ t('exercises.imageUrl') }}</label>
            <input
                id="exerciseImage"
                v-model="newExercise.image_url"
                type="text"
                class="input"
                :placeholder="t('common.optional')"
            />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="exerciseDescription">{{ t('exercises.description') }}</label>
          <textarea
              id="exerciseDescription"
              v-model="newExercise.description"
              class="input textarea"
              :placeholder="t('exercises.descriptionPlaceholder')"
          />
        </div>

        <div class="create-actions">
          <button class="btn btn-secondary" type="button" @click="toggleCreateForm">
            {{ t('common.cancel') }}
          </button>
          <button class="btn btn-primary" type="button" @click="saveExercise">
            {{ editingExerciseId ? t('exercises.updateExercise') : t('exercises.saveExercise') }}
          </button>
        </div>
      </div>

      <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
      <p v-if="successMessage" class="message message-success">{{ successMessage }}</p>

      <div v-if="isLoading" class="empty-state card">
        <p>{{ t('exercises.loading') }}</p>
      </div>

      <div v-else-if="exercises.length === 0" class="empty-state card">
        <p>{{ t('exercises.empty') }}</p>
      </div>

      <div v-else class="exercise-grid">
        <article
            v-for="exercise in exercises"
            :key="exercise.id"
            class="exercise-card card"
        >
          <div class="exercise-media">
            <img
                v-if="exercise.user_id && exercise.image_url"
                :src="exercise.image_url"
                :alt="exercise.name"
                class="exercise-image exercise-image-cover"
            />

            <img
                v-else-if="getExerciseImage(exercise.name)"
                :src="getExerciseImage(exercise.name)"
                :alt="exercise.name"
                class="exercise-image"
            />

            <img
                v-else-if="exercise.image_url"
                :src="exercise.image_url"
                :alt="exercise.name"
                class="exercise-image exercise-image-cover"
            />

            <div v-else class="exercise-placeholder">
              {{ t('exercises.noImage') }}
            </div>
          </div>

          <div class="exercise-body">
            <div class="exercise-top">
              <h2>{{ exercise.name }}</h2>
              <span class="pill">
                {{ exercise.user_id ? t('exercises.custom') : t('exercises.global') }}
              </span>
            </div>

            <div class="exercise-tags">
              <span class="tag">{{ translateCategory(exercise.category) }}</span>
              <span class="tag tag-highlight">{{ translateMuscleGroup(exercise.muscle_group) }}</span>
            </div>

            <p class="exercise-description">
              {{ displayDescription(exercise) }}
            </p>

            <div v-if="exercise.user_id" class="card-actions">
              <button class="btn btn-secondary" type="button" @click="startEditExercise(exercise)">
                {{ t('common.edit') }}
              </button>
              <button class="btn btn-danger" type="button" @click="deleteExercise(exercise)">
                {{ t('common.delete') }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 1.6rem;
}

.toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  margin-bottom: 1rem;
}

.toolbar-left {
  display: flex;
  gap: 1rem;
  flex: 1;
  flex-wrap: wrap;
}

.filter-group {
  min-width: 220px;
  flex: 1;
}

.toolbar-actions,
.create-actions,
.card-actions {
  display: flex;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.toolbar-actions,
.create-actions {
  justify-content: flex-end;
}

.create-card {
  padding: 1.2rem;
  margin-bottom: 1rem;
}

.create-card h2 {
  margin-bottom: 1rem;
  font-size: 1.1rem;
  font-weight: 850;
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.create-actions {
  margin-top: 1rem;
}

.message {
  margin-bottom: 1rem;
}

.exercise-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.exercise-card {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.exercise-media {
  width: 100%;
  height: 220px;
  padding: 0.75rem;
  background: var(--surface-soft);
}

.exercise-image,
.exercise-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 8px;
}

.exercise-image {
  display: block;
  object-fit: contain;
  padding: 0.7rem;
  background: #fff;
}

.exercise-image-cover {
  object-fit: contain;
}

.exercise-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-weight: 750;
  text-align: center;
  background: #fff;
}

.exercise-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem;
}

.exercise-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
}

.exercise-top h2 {
  font-size: 1.05rem;
  font-weight: 850;
  line-height: 1.25;
}

.exercise-tags {
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.tag {
  padding: 0.3rem 0.58rem;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 750;
}

.tag-highlight {
  background: var(--surface-tint);
  color: var(--warning);
}

.exercise-description {
  flex: 1;
  color: var(--text-soft);
}

@media (max-width: 1100px) {
  .exercise-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .create-grid,
  .exercise-grid {
    grid-template-columns: 1fr;
  }

  .toolbar-actions,
  .create-actions {
    justify-content: flex-start;
  }
}
</style>
