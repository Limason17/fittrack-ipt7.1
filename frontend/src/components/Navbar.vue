<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <nav class="navbar">
    <div class="logo">
      <RouterLink to="/">FitTrack</RouterLink>
    </div>

    <ul class="nav-links">
      <li><RouterLink to="/exercises">Übungen</RouterLink></li>
      <li><RouterLink to="/workouts">Workouts</RouterLink></li>
      <li><RouterLink to="/progress">Fortschritt</RouterLink></li>
    </ul>

    <div class="nav-actions">
      <button class="lang-switch" title="Sprache wechseln">DE / EN</button>
      <RouterLink to="/login" class="btn login-btn">Login</RouterLink>
      <RouterLink to="/register" class="btn register-btn">Registrieren</RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.2rem 5%;
  background-color: #1e2229;
  border-bottom: 1px solid #2a2f38;
}

.logo a {
  font-size: 1.5rem;
  font-weight: 800;
  color: #42b983;
}

.nav-links {
  display: flex;
  list-style: none;
  gap: 2rem;
}

.nav-links a {
  color: #a0aab5;
  font-weight: 600;
  transition: color 0.3s ease;
}

.nav-links a:hover,
.nav-links a.router-link-active {
  color: #42b983;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.lang-switch {
  background: transparent;
  border: 1px solid #555;
  color: #a0aab5;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.lang-switch:hover {
  border-color: #42b983;
  color: #42b983;
}

.btn {
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  font-weight: 600;
  transition: all 0.3s ease;
}

.login-btn {
  color: #ffffff;
  border: 1px solid #555;
}

.login-btn:hover {
  border-color: #42b983;
  color: #42b983;
}

.register-btn {
  background-color: #42b983;
  color: #121418;
}

.register-btn:hover {
  background-color: #3aa876;
}
</style>