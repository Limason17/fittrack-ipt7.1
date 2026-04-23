<script setup>
</script>

<template>
  <section class="section">
    <div class="page-container">
      <div class="header">
        <span class="eyebrow">Übungen</span>
        <h1 class="page-title">Deine Übungsübersicht</h1>
        <p class="page-subtitle">
          Hier kannst du deine Übungen später sammeln, ordnen und schnell wiederfinden.
        </p>
      </div>

      <div class="toolbar card">
        <div>
          <h2>Noch keine Übungen vorhanden</h2>
          <p>
            Sobald du eigene Übungen anlegst oder globale Übungen einbindest, erscheinen sie hier.
          </p>
        </div>

        <button class="btn btn-primary" type="button">Neue Übung</button>
      </div>

      <div class="empty-card card">
        <p>
          Im Moment ist deine Übungsliste noch leer. Das ist ein guter Platz für deine wichtigsten
          Kraft-, Cardio- oder Mobility-Übungen.
        </p>
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
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.toolbar h2 {
  font-size: 1.1rem;
  font-weight: 750;
  margin-bottom: 0.35rem;
}

.toolbar p {
  color: var(--text-soft);
}

.empty-card {
  padding: 1.5rem;
}

.empty-card p {
  color: var(--text-soft);
}

@media (max-width: 900px) {
  .toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>