<script setup>
import { computed, onMounted, ref } from 'vue'
import { getToken } from '../utils/auth'
import { getExerciseImage } from '../utils/exerciseImageMap'

const exercises = ref([])
const isLoading = ref(true)
const errorMessage = ref('')
const successMessage = ref('')

const selectedCategory = ref('')
const selectedMuscleGroup = ref('')

const showCreateForm = ref(false)

const newExercise = ref({
  name: '',
  description: '',
  category: '',
  muscle_group: '',
  image_url: '',
})

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

async function loadExercises() {
  isLoading.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const token = getToken()
    const params = new URLSearchParams()

    if (selectedCategory.value) {
      params.append('category', selectedCategory.value)
    }

    if (selectedMuscleGroup.value) {
      params.append('muscle_group', selectedMuscleGroup.value)
    }

    const url = `http://localhost:3001/api/exercises${params.toString() ? `?${params.toString()}` : ''}`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      errorMessage.value = data.message || 'Übungen konnten nicht geladen werden.'
      return
    }

    exercises.value = data
  } catch (error) {
    errorMessage.value = 'Server nicht erreichbar. Bitte versuche es erneut.'
  } finally {
    isLoading.value = false
  }
}

async function createExercise() {
  errorMessage.value = ''
  successMessage.value = ''

  if (!newExercise.value.name || !newExercise.value.category || !newExercise.value.muscle_group) {
    errorMessage.value = 'Bitte fülle Name, Kategorie und Muskelgruppe aus.'
    return
  }

  try {
    const token = getToken()

    const response = await fetch('http://localhost:3001/api/exercises', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newExercise.value),
    })

    const data = await response.json()

    if (!response.ok) {
      errorMessage.value = data.message || 'Übung konnte nicht erstellt werden.'
      return
    }

    successMessage.value = 'Übung erfolgreich erstellt.'

    newExercise.value = {
      name: '',
      description: '',
      category: '',
      muscle_group: '',
      image_url: '',
    }

    showCreateForm.value = false
    await loadExercises()
  } catch (error) {
    errorMessage.value = 'Server nicht erreichbar. Bitte versuche es erneut.'
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

onMounted(() => {
  loadExercises()
})
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">Übungen</span>
        <h1 class="page-title">Dein Übungskatalog</h1>
        <p class="page-subtitle">
          Filtere Übungen nach Kategorie und Muskelgruppe oder erstelle eine eigene Übung.
        </p>
      </div>

      <div class="toolbar card">
        <div class="toolbar-left">
          <div class="filter-group">
            <label class="form-label" for="categoryFilter">Kategorie</label>
            <select
                id="categoryFilter"
                v-model="selectedCategory"
                class="input"
                @change="handleCategoryChange"
            >
              <option value="">Alle Kategorien</option>
              <option
                  v-for="category in availableCategoryOptions"
                  :key="category"
                  :value="category"
              >
                {{ category }}
              </option>
            </select>
          </div>

          <div class="filter-group">
            <label class="form-label" for="muscleGroupFilter">Muskelgruppe</label>
            <select
                id="muscleGroupFilter"
                v-model="selectedMuscleGroup"
                class="input"
                @change="handleMuscleGroupChange"
            >
              <option value="">Alle Muskelgruppen</option>
              <option
                  v-for="muscleGroup in availableMuscleGroupOptions"
                  :key="muscleGroup"
                  :value="muscleGroup"
              >
                {{ muscleGroup }}
              </option>
            </select>
          </div>
        </div>

        <div class="toolbar-actions">
          <button class="btn btn-secondary" type="button" @click="resetFilters">
            Filter zurücksetzen
          </button>
          <button class="btn btn-primary" type="button" @click="showCreateForm = !showCreateForm">
            {{ showCreateForm ? 'Schließen' : 'Neue Übung' }}
          </button>
        </div>
      </div>

      <div v-if="showCreateForm" class="create-card card">
        <h2>Eigene Übung erstellen</h2>

        <div class="create-grid">
          <div class="form-group">
            <label class="form-label" for="exerciseName">Name</label>
            <input
                id="exerciseName"
                v-model="newExercise.name"
                type="text"
                class="input"
                placeholder="z. B. Cable Fly"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="exerciseCategory">Kategorie</label>
            <select
                id="exerciseCategory"
                v-model="newExercise.category"
                class="input"
                @change="handleCreateCategoryChange"
            >
              <option value="">Kategorie wählen</option>
              <option v-for="category in categoryOptions" :key="category" :value="category">
                {{ category }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="exerciseMuscleGroup">Muskelgruppe</label>
            <select
                id="exerciseMuscleGroup"
                v-model="newExercise.muscle_group"
                class="input"
            >
              <option value="">Muskelgruppe wählen</option>
              <option
                  v-for="muscleGroup in filteredCreateMuscleGroups"
                  :key="muscleGroup"
                  :value="muscleGroup"
              >
                {{ muscleGroup }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="exerciseImage">Bild-URL</label>
            <input
                id="exerciseImage"
                v-model="newExercise.image_url"
                type="text"
                class="input"
                placeholder="Optional"
            />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="exerciseDescription">Beschreibung</label>
          <textarea
              id="exerciseDescription"
              v-model="newExercise.description"
              class="input textarea"
              placeholder="Kurze Beschreibung der Übung"
          />
        </div>

        <div class="create-actions">
          <button class="btn btn-primary" type="button" @click="createExercise">
            Übung speichern
          </button>
        </div>
      </div>

      <div v-if="errorMessage" class="message-card message-error">
        <p>{{ errorMessage }}</p>
      </div>

      <div v-if="successMessage" class="message-card message-success">
        <p>{{ successMessage }}</p>
      </div>

      <div v-if="isLoading" class="empty-card card">
        <p>Übungen werden geladen...</p>
      </div>

      <div v-else-if="exercises.length === 0" class="empty-card card">
        <p>Keine Übungen gefunden. Passe die Filter an oder erstelle eine neue Übung.</p>
      </div>

      <div v-else class="exercise-grid">
        <article
            v-for="exercise in exercises"
            :key="exercise.id"
            class="exercise-card card"
        >
          <div class="exercise-media">
            <div
                v-if="exercise.user_id && exercise.image_url"
                class="exercise-image-shell exercise-image-shell-url"
            >
              <img
                  :src="exercise.image_url"
                  :alt="exercise.name"
                  class="exercise-image exercise-image-cover"
              />
            </div>

            <div
                v-else-if="getExerciseImage(exercise.name)"
                class="exercise-image-shell"
            >
              <img
                  :src="getExerciseImage(exercise.name)"
                  :alt="exercise.name"
                  class="exercise-image"
              />
            </div>

            <div
                v-else-if="exercise.image_url"
                class="exercise-image-shell exercise-image-shell-url"
            >
              <img
                  :src="exercise.image_url"
                  :alt="exercise.name"
                  class="exercise-image exercise-image-cover"
              />
            </div>

            <div v-else class="exercise-image-shell">
              <div class="exercise-image exercise-image-placeholder">
                <span class="placeholder-label">Kein Bild vorhanden</span>
              </div>
            </div>
          </div>

          <div class="exercise-body">
            <div class="exercise-top">
              <h2>{{ exercise.name }}</h2>
              <span class="exercise-badge">
                {{ exercise.user_id ? 'Eigene Übung' : 'Globale Übung' }}
              </span>
            </div>

            <div class="exercise-tags">
              <span class="tag">{{ exercise.category }}</span>
              <span class="tag tag-highlight">{{ exercise.muscle_group }}</span>
            </div>

            <p class="exercise-description">
              {{ exercise.description || 'Keine Beschreibung vorhanden.' }}
            </p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 2rem;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
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

.toolbar-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.create-card {
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.create-card h2 {
  margin-bottom: 1rem;
  font-size: 1.15rem;
  font-weight: 750;
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.textarea {
  min-height: 120px;
  resize: vertical;
  padding-top: 0.9rem;
  border-radius: 12px;
}

.create-actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
}

.message-card {
  padding: 1rem 1.2rem;
  border-radius: 14px;
  margin-bottom: 1.5rem;
}

.message-error {
  background: #f7e6e6;
  color: #8a2f2f;
  border: 1px solid #e7c5c5;
}

.message-success {
  background: #e8f4ec;
  color: #256043;
  border: 1px solid #c8dfd0;
}

.empty-card {
  padding: 1.5rem;
}

.empty-card p {
  color: var(--text-soft);
}

.exercise-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.5rem;
}

.exercise-card {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 24px;
  min-height: 100%;
}

.exercise-body {
  padding: 1.3rem 1.35rem 1.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
}

.exercise-top {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 0.8rem;
  margin-bottom: 0.95rem;
}

.exercise-top h2 {
  font-size: 1.1rem;
  font-weight: 800;
  line-height: 1.25;
}

.exercise-badge {
  font-size: 0.8rem;
  padding: 0.38rem 0.68rem;
  border-radius: 999px;
  background: #f7f2eb;
  border: 1px solid var(--border);
  white-space: nowrap;
  color: var(--text-soft);
}

.exercise-tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}

.tag {
  font-size: 0.82rem;
  padding: 0.38rem 0.7rem;
  border-radius: 999px;
  background: #f6f1ea;
  color: var(--text);
}

.tag-highlight {
  background: #f4dcd7;
  color: #a3473b;
  font-weight: 700;
}

.exercise-description {
  color: var(--text-soft);
  line-height: 1.55;
}

.exercise-media {
  padding: 1rem 1rem 0;
  background: transparent;
}

.exercise-image-shell {
  width: 100%;
  height: 240px;
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(180deg, #f7f3ed 0%, #f0ebe3 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.exercise-image-shell-url {
  width: calc(100% - 2rem);
  height: 200px;
  margin: 1rem auto;
}

.exercise-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 1rem;
  display: block;
  border-radius: 18px;
}

.exercise-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.placeholder-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-muted);
}

.exercise-image-cover {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  padding: 0.75rem;
  border-radius: 18px;
}

@media (max-width: 1100px) {
  .exercise-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .create-grid {
    grid-template-columns: 1fr;
  }

  .exercise-grid {
    grid-template-columns: 1fr;
  }
}
</style>