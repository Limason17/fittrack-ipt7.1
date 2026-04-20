<script setup>
const workouts = [
  { title: 'Push Day', description: 'Brust, Schulter, Trizeps' },
  { title: 'Pull Day', description: 'Rücken, Bizeps' },
  { title: 'Leg Day', description: 'Beine und Core' },
]
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">Workouts</span>
        <h1 class="page-title">Deine Trainingspläne</h1>
        <p class="page-subtitle">
          Behalte deine Trainingstage in einer klaren und einfachen Übersicht.
        </p>
      </div>

      <div class="workout-list">
        <article v-for="workout in workouts" :key="workout.title" class="workout-card card">
          <div>
            <h2>{{ workout.title }}</h2>
            <p>{{ workout.description }}</p>
          </div>
          <button class="btn btn-secondary">Öffnen</button>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 2rem;
}

.workout-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.workout-card {
  padding: 1.25rem 1.4rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.workout-card h2 {
  font-size: 1.1rem;
  font-weight: 750;
  margin-bottom: 0.35rem;
}

.workout-card p {
  color: var(--text-soft);
}

@media (max-width: 700px) {
  .workout-card {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>