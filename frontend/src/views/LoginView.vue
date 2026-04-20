<script setup>
</script>

<template>
  <section class="section">
    <div class="page-container auth-wrap">
      <div class="auth-intro">
        <span class="eyebrow">Login</span>
        <h1 class="page-title">Willkommen zurück.</h1>
      </div>

      <div class="auth-card card">
        <form class="auth-form">
          <div class="form-group">
            <label class="form-label" for="email">E-Mail</label>
            <input id="email" type="email" class="input" placeholder="deine@email.ch" />
          </div>

          <div class="form-group">
            <label class="form-label" for="password">Passwort</label>
            <input id="password" type="password" class="input" placeholder="Passwort" />
          </div>

          <button type="submit" class="btn btn-primary auth-btn">Login</button>
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
</style>