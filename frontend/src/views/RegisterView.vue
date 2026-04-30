<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const username = ref('')
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const isLoading = ref(false)

async function handleRegister() {
  errorMessage.value = ''
  successMessage.value = ''

  if (!username.value || !email.value || !password.value) {
    errorMessage.value = 'Bitte fülle alle Felder aus.'
    return
  }

  isLoading.value = true

  try {
    const response = await fetch('http://localhost:3001/api/users/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username.value,
        email: email.value,
        password: password.value,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      errorMessage.value = data.message || 'Registrierung fehlgeschlagen.'
      return
    }

    successMessage.value = 'Registrierung erfolgreich. Du kannst dich jetzt einloggen.'

    username.value = ''
    email.value = ''
    password.value = ''

    setTimeout(() => {
      router.push('/login')
    }, 1000)
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
        <span class="eyebrow">Registrierung</span>
        <h1 class="page-title">Erstelle dein Konto.</h1>
        <p class="page-subtitle">
          Registriere dich, damit du deine persönlichen Trainingsdaten verwalten kannst.
        </p>
      </div>

      <div class="auth-card card">
        <form class="auth-form" @submit.prevent="handleRegister">
          <div class="form-group">
            <label class="form-label" for="username">Benutzername</label>
            <input
                id="username"
                v-model="username"
                type="text"
                class="input"
                placeholder="Benutzername"
                autocomplete="username"
            />
          </div>

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
                autocomplete="new-password"
            />
          </div>

          <p v-if="errorMessage" class="auth-message auth-message-error">
            {{ errorMessage }}
          </p>

          <p v-if="successMessage" class="auth-message auth-message-success">
            {{ successMessage }}
          </p>

          <button type="submit" class="btn btn-primary auth-btn" :disabled="isLoading">
            {{ isLoading ? 'Registrierung läuft...' : 'Registrieren' }}
          </button>
        </form>

        <p class="auth-footer">
          Schon registriert?
          <router-link to="/login">Zum Login</router-link>
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

.auth-message-success {
  background: #e8f4ec;
  color: #256043;
  border: 1px solid #c8dfd0;
}
</style>