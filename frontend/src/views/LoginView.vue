<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { saveAuth } from '../utils/auth'
import { apiRequest } from '../utils/api'
import { applyLanguageForUser, t } from '../utils/i18n'

const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const isLoading = ref(false)

async function handleLogin() {
  errorMessage.value = ''

  if (!email.value || !password.value) {
    errorMessage.value = t('auth.fillFields')
    return
  }

  isLoading.value = true

  try {
    const data = await apiRequest('/users/login', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
      },
    })

    saveAuth(data.token, data.user)
    await applyLanguageForUser(data.user)

    email.value = ''
    password.value = ''

    router.push(route.query.redirect || '/')
  } catch (error) {
    errorMessage.value = error.status ? t('auth.loginFailed') : t('common.serverError')
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <section class="section">
    <div class="page-container auth-wrap">
      <div class="auth-intro">
        <span class="eyebrow">{{ t('nav.login') }}</span>
        <h1 class="page-title">{{ t('auth.loginTitle') }}</h1>
        <p class="page-subtitle">
          {{ t('auth.loginSubtitle') }}
        </p>
      </div>

      <div class="auth-card card">
        <form class="auth-form" @submit.prevent="handleLogin">
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
                :placeholder="t('auth.password')"
                autocomplete="current-password"
            />
          </div>

          <p v-if="errorMessage" class="message message-error">
            {{ errorMessage }}
          </p>

          <button type="submit" class="btn btn-primary auth-btn" :disabled="isLoading">
            {{ isLoading ? t('auth.loginLoading') : t('auth.loginButton') }}
          </button>
        </form>

        <p class="auth-footer">
          {{ t('auth.noAccount') }}
          <RouterLink to="/register">{{ t('auth.toRegister') }}</RouterLink>
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
