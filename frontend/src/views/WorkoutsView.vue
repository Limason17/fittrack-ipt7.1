<script setup>
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">Workouts</span>
        <h1 class="page-title">Deine Trainingspläne</h1>
        <p class="page-subtitle">
          Hier kannst du deine Workout-Struktur festhalten und deine Trainingstage vorbereiten.
        </p>
      </div>

      <div class="info-card card">
        <div>
          <h2>Noch keine Workouts angelegt</h2>
          <p>
            Erstelle deinen ersten Trainingsplan, damit du dein Training klarer organisieren kannst.
          </p>
        </div>

        <button class="btn btn-primary" type="button">Workout erstellen</button>
      </div>

      <div class="empty-card card">
        <p>
          Deine Workouts erscheinen hier, sobald du welche anlegst. Du könntest zum Beispiel einen
          Push-, Pull- oder Leg-Day Plan erfassen.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header {
  margin-bottom: 2rem;
}

.info-card {
  padding: 1.4rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.info-card h2 {
  font-size: 1.1rem;
  font-weight: 750;
  margin-bottom: 0.35rem;
}

.info-card p {
  color: var(--text-soft);
}

.empty-card {
  padding: 1.5rem;
}

.empty-card p {
  color: var(--text-soft);
}

@media (max-width: 700px) {
  .info-card {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>