<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="home-container">
    <section class="hero">
      <h1>Dein Training. Dein Erfolg. 💪</h1>
      <p>
        Willkommen bei FitTrack! Plane deine Workouts, speichere deine Übungen
        und verfolge deinen Fortschritt – alles einfach und übersichtlich an einem Ort.
      </p>

      <div class="cta-buttons">
        <RouterLink to="/register" class="btn primary">Jetzt starten</RouterLink>
        <RouterLink to="/login" class="btn secondary">Zum Login</RouterLink>
      </div>
    </section>

    <section class="features">
      <div class="feature-card">
        <h2>🏋️ Übungen</h2>
        <p>Erfasse alle deine Lieblingsübungen für das Gym oder für Zuhause.</p>
      </div>

      <div class="feature-card">
        <h2>📅 Workouts</h2>
        <p>Stelle individuelle Trainingspläne zusammen und behalte den Überblick.</p>
      </div>

      <div class="feature-card">
        <h2>📈 Fortschritt</h2>
        <p>Dokumentiere deine Gewichte und Wiederholungen, um deine Erfolge zu sehen.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem 2rem;
  gap: 5rem;
}

.hero {
  text-align: center;
  max-width: 800px;
}

.hero h1 {
  font-size: 3.5rem;
  color: #ffffff;
  margin-bottom: 1.5rem;
  line-height: 1.2;
}

.hero p {
  font-size: 1.2rem;
  color: #a0aab5;
  line-height: 1.6;
  margin-bottom: 2.5rem;
}

.cta-buttons {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
}

.btn {
  padding: 0.8rem 2rem;
  border-radius: 8px;
  font-size: 1.1rem;
  font-weight: bold;
  transition: all 0.3s ease;
}

.primary {
  background-color: #42b983;
  color: #121418;
}

.primary:hover {
  background-color: #3aa876;
  transform: translateY(-2px);
}

.secondary {
  background-color: transparent;
  color: #ffffff;
  border: 2px solid #555;
}

.secondary:hover {
  border-color: #ffffff;
  transform: translateY(-2px);
}

.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
  width: 100%;
  max-width: 1200px;
}

.feature-card {
  background: #1e2229;
  padding: 2.5rem;
  border-radius: 12px;
  border: 1px solid #2a2f38;
  text-align: center;
  transition: all 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-5px);
  border-color: #42b983;
  box-shadow: 0 10px 20px rgba(0,0,0,0.2);
}

.feature-card h2 {
  color: #ffffff;
  margin-bottom: 1rem;
  font-size: 1.5rem;
}

.feature-card p {
  color: #a0aab5;
  line-height: 1.6;
}
</style>