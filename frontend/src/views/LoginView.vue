<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { saveAuth } from '../utils/auth'

const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const isLoading = ref(false)

async function handleLogin() {
  errorMessage.value = ''

  if (!email.value || !password.value) {
    errorMessage.value = 'Bitte fülle alle Felder aus.'
    return
  }

  isLoading.value = true

  try {
    const response = await fetch('http://localhost:3001/api/users/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.value,
        password: password.value,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      errorMessage.value = data.message || 'Login fehlgeschlagen.'
      return
    }

    saveAuth(data.token, data.user)

    email.value = ''
    password.value = ''

    const redirectPath = route.query.redirect || '/'
    router.push(redirectPath)
  } catch (error) {
    errorMessage.value = 'Server nicht erreichbar. Bitte versuche es erneut.'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <section class="section">
    <div class="page-container auth-wrap">
      <div class="auth-intro">
        <span class="eyebrow">Login</span>
        <h1 class="page-title">Willkommen zurück.</h1>
        <p class="page-subtitle">
          Melde dich an, um deine Übungen, Workouts und Fortschritte zu sehen.
        </p>
      </div>

      <div class="auth-card card">
        <form class="auth-form" @submit.prevent="handleLogin">
          <div class="form-group">
            <label class="form-label" for="email">E-Mail</label>
            <input
                id="email"
                v-model="email"
                type="email"
                class="input"
                placeholder="deine@email.ch"
                autocomplete="email"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="password">Passwort</label>
            <input
                id="password"
                v-model="password"
                type="password"
                class="input"
                placeholder="Passwort"
                autocomplete="current-password"
            />
          </div>

          <p v-if="errorMessage" class="auth-message auth-message-error">
            {{ errorMessage }}
          </p>

          <button type="submit" class="btn btn-primary auth-btn" :disabled="isLoading">
            {{ isLoading ? 'Login läuft...' : 'Login' }}
          </button>
        </form>

        <p class="auth-footer">
          Noch kein Konto?
          <router-link to="/register">Registrieren</router-link>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.auth-wrap {
  max-width: 760px;
}

.auth-intro {
  margin-bottom: 2rem;
}

.auth-card {
  padding: 2rem;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.auth-btn {
  width: 100%;
  margin-top: 0.2rem;
}

.auth-footer {
  margin-top: 1.1rem;
  color: var(--text-soft);
}

.auth-footer a {
  font-weight: 700;
}

.auth-message {
  padding: 0.85rem 1rem;
  border-radius: 12px;
  font-size: 0.95rem;
}

.auth-message-error {
  background: #f7e6e6;
  color: #8a2f2f;
  border: 1px solid #e7c5c5;
}
</style>