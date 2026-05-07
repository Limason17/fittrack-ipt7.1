<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiRequest } from '../utils/api'
import { locale, t } from '../utils/i18n'

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
    errorMessage.value = t('auth.fillFields')
    return
  }

  if (password.value.length < 6) {
    errorMessage.value = t('auth.passwordLength')
    return
  }

  isLoading.value = true

  try {
    await apiRequest('/users/register', {
      method: 'POST',
      body: {
        username: username.value,
        email: email.value,
        password: password.value,
        language_preference: locale.value,
      },
    })

    successMessage.value = t('auth.registerSuccess')

    username.value = ''
    email.value = ''
    password.value = ''

    setTimeout(() => {
      router.push('/login')
    }, 900)
  } catch (error) {
    errorMessage.value = error.status ? t('auth.registerFailed') : t('common.serverError')
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <section class="section">
    <div class="page-container auth-wrap">
      <div class="auth-intro">
        <span class="eyebrow">{{ t('nav.register') }}</span>
        <h1 class="page-title">{{ t('auth.registerTitle') }}</h1>
        <p class="page-subtitle">
          {{ t('auth.registerSubtitle') }}
        </p>
      </div>

      <div class="auth-card card">
        <form class="auth-form" @submit.prevent="handleRegister">
          <div class="form-group">
            <label class="form-label" for="username">{{ t('auth.username') }}</label>
            <input
                id="username"
                v-model="username"
                type="text"
                class="input"
                :placeholder="t('auth.username')"
                autocomplete="username"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="email">{{ t('auth.email') }}</label>
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
            <label class="form-label" for="password">{{ t('auth.password') }}</label>
            <input
                id="password"
                v-model="password"
                type="password"
                class="input"
                :placeholder="t('auth.passwordPlaceholder')"
                autocomplete="new-password"
            />
          </div>

          <p v-if="errorMessage" class="message message-error">
            {{ errorMessage }}
          </p>

          <p v-if="successMessage" class="message message-success">
            {{ successMessage }}
          </p>

          <button type="submit" class="btn btn-primary auth-btn" :disabled="isLoading">
            {{ isLoading ? t('auth.registerLoading') : t('auth.registerButton') }}
          </button>
        </form>

        <p class="auth-footer">
          {{ t('auth.hasAccount') }}
          <RouterLink to="/login">{{ t('auth.toLogin') }}</RouterLink>
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
  margin-bottom: 1.5rem;
}

.auth-card {
  padding: 1.5rem;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.auth-btn {
  width: 100%;
  margin-top: 0.2rem;
}

.auth-footer {
  margin-top: 1rem;
  color: var(--text-soft);
}

.auth-footer a {
  color: var(--accent);
  font-weight: 800;
}
</style>
