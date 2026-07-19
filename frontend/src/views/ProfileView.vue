<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import PageHeader from '../components/ui/PageHeader.vue'
import Tabs from '../components/ui/Tabs.vue'
import { authUser, logout } from '../utils/auth'
import { languages, locale, setLanguage, t } from '../utils/i18n'
import { distanceUnit, setDistanceUnit, setWeightUnit, weightUnit } from '../utils/units'
import { toastSuccess } from '../utils/toast'

const router = useRouter()
const activeTab = ref('account')
const tabs = [
  { value: 'account', label: t('profile.accountTab') },
  { value: 'preferences', label: t('profile.preferencesTab') },
]

async function chooseLanguage(code) {
  await setLanguage(code)
  toastSuccess(t('studios.settings.saved'))
}

async function chooseWeightUnit(unit) {
  await setWeightUnit(unit)
  toastSuccess(t('studios.settings.saved'))
}

async function chooseDistanceUnit(unit) {
  await setDistanceUnit(unit)
  toastSuccess(t('studios.settings.saved'))
}

function handleLogout() {
  logout()
  router.push('/login')
}
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <PageHeader :eyebrow="t('profile.eyebrow')" :title="t('profile.title')" :subtitle="t('profile.subtitle')" />

      <Tabs v-model="activeTab" :tabs="tabs" :label="t('profile.title')" />

      <article v-if="activeTab === 'account'" class="card profile-section">
        <h2>{{ t('profile.accountSectionTitle') }}</h2>
        <p class="studio-help">{{ t('profile.accountSectionHint') }}</p>
        <dl class="studio-details">
          <div><dt>{{ t('auth.username') }}</dt><dd>{{ authUser?.username }}</dd></div>
          <div><dt>{{ t('auth.email') }}</dt><dd>{{ authUser?.email }}</dd></div>
        </dl>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="handleLogout">
            {{ t('profile.logoutAction') }}
          </button>
        </div>
      </article>

      <article v-else class="card profile-section">
        <h2>{{ t('profile.preferencesSectionTitle') }}</h2>
        <p class="studio-help">{{ t('profile.preferencesSectionHint') }}</p>

        <div class="profile-pref-group" role="radiogroup" :aria-label="t('routing.language')">
          <span class="form-label">{{ t('routing.language') }}</span>
          <div class="profile-pref-options">
            <button
              v-for="language in languages"
              :key="language.code"
              type="button"
              role="radio"
              class="profile-pref-btn"
              :aria-checked="locale === language.code"
              :class="{ 'profile-pref-btn-active': locale === language.code }"
              @click="chooseLanguage(language.code)"
            >
              {{ language.name }}
            </button>
          </div>
        </div>

        <div class="profile-pref-group" role="radiogroup" :aria-label="t('routing.weightUnit')">
          <span class="form-label">{{ t('routing.weightUnit') }}</span>
          <div class="profile-pref-options">
            <button
              v-for="unit in ['kg', 'lb']"
              :key="unit"
              type="button"
              role="radio"
              class="profile-pref-btn"
              :aria-checked="weightUnit === unit"
              :class="{ 'profile-pref-btn-active': weightUnit === unit }"
              @click="chooseWeightUnit(unit)"
            >
              {{ unit }}
            </button>
          </div>
        </div>

        <div class="profile-pref-group" role="radiogroup" :aria-label="t('routing.distanceUnit')">
          <span class="form-label">{{ t('routing.distanceUnit') }}</span>
          <div class="profile-pref-options">
            <button
              v-for="unit in ['km', 'mi']"
              :key="unit"
              type="button"
              role="radio"
              class="profile-pref-btn"
              :aria-checked="distanceUnit === unit"
              :class="{ 'profile-pref-btn-active': distanceUnit === unit }"
              @click="chooseDistanceUnit(unit)"
            >
              {{ unit }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.profile-section {
  padding: 1.25rem;
  display: grid;
  gap: 1rem;
  align-content: start;
}

.profile-pref-group {
  display: grid;
  gap: 0.5rem;
}

.profile-pref-options {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.profile-pref-btn {
  min-height: 40px;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-soft);
  font-size: var(--text-sm);
  font-weight: 700;
}

.profile-pref-btn:hover {
  border-color: var(--accent);
}

.profile-pref-btn-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-hover);
}
</style>
