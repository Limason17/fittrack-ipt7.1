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
  padding: 1rem 2rem;
  background-color: #2c3e50;
  color: white;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.logo a {
  font-size: 1.5rem;
  font-weight: bold;
  color: #42b983;
  text-decoration: none;
}

.nav-links {
  display: flex;
  list-style: none;
  gap: 1.5rem;
  margin: 0;
  padding: 0;
}

.nav-links a {
  color: white;
  text-decoration: none;
  font-weight: 500;
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
  background: none;
  border: 1px solid white;
  color: white;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
}

.lang-switch:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn {
  text-decoration: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-weight: bold;
  transition: all 0.3s ease;
}

.login-btn {
  color: white;
  border: 1px solid #42b983;
}

.login-btn:hover {
  background-color: rgba(66, 185, 131, 0.1);
}

.register-btn {
  background-color: #42b983;
  color: #2c3e50;
}

.register-btn:hover {
  background-color: #3aa876;
}
</style>