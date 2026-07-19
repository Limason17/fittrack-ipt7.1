<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Badge from '../components/ui/Badge.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { t } from '../utils/i18n'
import { roleTone } from '../utils/studioBadges'
import { getMyMembership, getStudio } from '../utils/studioApi'
import {
  canManageActiveStudio,
  canViewActiveStudioMembers,
  refreshSelectedStudio,
  selectStudio,
  updateAuthorizedStudio,
} from '../utils/studioContext'

const route = useRoute()
const router = useRouter()
const studio = ref(null)
const membership = ref(null)
const isLoading = ref(true)
const errorMessage = ref('')
let loadGeneration = 0

const studioId = computed(() => String(route.params.studioId || ''))
const role = computed(() => membership.value?.role || studio.value?.membership?.role || null)
const canManage = computed(() => canManageActiveStudio.value)
const canViewMembers = computed(() => canViewActiveStudioMembers.value)

function roleLabel(value) {
  return t(`studios.roles.${value}`)
}

async function loadStudio() {
  const generation = ++loadGeneration
  const currentStudioId = studioId.value
  studio.value = null
  membership.value = null
  errorMessage.value = ''
  isLoading.value = true
  try {
    const [studioResult, membershipResult] = await Promise.all([
      getStudio(currentStudioId),
      getMyMembership(currentStudioId),
    ])
    if (generation !== loadGeneration || currentStudioId !== studioId.value) return
    const freshStudio = {
      ...studioResult.studio,
      membership: membershipResult.membership,
    }
    if (freshStudio.membership?.status !== 'active') {
      selectStudio(null)
      await router.replace({ name: 'studios' })
      return
    }
    studio.value = freshStudio
    membership.value = freshStudio.membership
    updateAuthorizedStudio(freshStudio)
  } catch (error) {
    if (generation !== loadGeneration || currentStudioId !== studioId.value) return
    if (error.status === 404) {
      const selected = await refreshSelectedStudio(currentStudioId).catch(() => null)
      if (
        generation !== loadGeneration ||
        currentStudioId !== studioId.value ||
        selected?.ignored
      ) return
      if (!selected) {
        selectStudio(null)
        await router.replace({ name: 'studios' })
        return
      }
    }
    errorMessage.value = error.status === 403
      ? t('studios.permissionDenied')
      : t('studios.loadError')
  } finally {
    if (generation === loadGeneration) isLoading.value = false
  }
}

watch(studioId, loadStudio, { immediate: true })
</script>

<template>
  <section class="section">
    <div class="page-container studio-page">
      <p v-if="errorMessage" class="message message-error" role="alert">{{ errorMessage }}</p>

      <template v-if="isLoading">
        <div class="card studio-detail-card" aria-live="polite" aria-busy="true">
          <div class="skeleton skeleton-text" style="width: 40%; height: 1.5rem;"></div>
          <div class="skeleton skeleton-text" style="width: 65%;"></div>
          <div class="skeleton skeleton-text"></div>
        </div>
      </template>

      <template v-else-if="studio">
        <PageHeader :eyebrow="t('studios.dashboard')" :title="studio.name" :subtitle="t('studios.dashboardSubtitle')">
          <template #badge>
            <Badge :tone="roleTone(role)">{{ roleLabel(role) }}</Badge>
          </template>
        </PageHeader>

        <article class="card studio-detail-card">
          <h2>{{ t('studios.details') }}</h2>
          <dl class="studio-details">
            <div><dt>{{ t('studios.fields.slug') }}</dt><dd>{{ studio.slug }}</dd></div>
            <div><dt>{{ t('studios.fields.locale') }}</dt><dd>{{ studio.defaultLocale }}</dd></div>
            <div><dt>{{ t('studios.fields.timezone') }}</dt><dd>{{ studio.defaultTimezone }}</dd></div>
            <div><dt>{{ t('studios.fields.weightUnit') }}</dt><dd>{{ studio.defaultWeightUnit }}</dd></div>
          </dl>
        </article>

        <article class="card studio-next-steps">
          <h2>{{ t('studios.dashboardNextSteps.title') }}</h2>
          <div v-if="canManage" class="studio-next-grid">
            <div class="studio-next-item">
              <h3>{{ t('studios.dashboardNextSteps.inviteTitle') }}</h3>
              <p>{{ t('studios.dashboardNextSteps.inviteText') }}</p>
              <RouterLink class="btn btn-secondary btn-sm" :to="{ name: 'studio-invitations', params: { studioId } }">
                {{ t('studios.dashboardNextSteps.inviteAction') }}
              </RouterLink>
            </div>
            <div class="studio-next-item">
              <h3>{{ t('studios.dashboardNextSteps.membersTitle') }}</h3>
              <p>{{ t('studios.dashboardNextSteps.membersText') }}</p>
              <RouterLink class="btn btn-secondary btn-sm" :to="{ name: 'studio-members', params: { studioId } }">
                {{ t('studios.dashboardNextSteps.membersAction') }}
              </RouterLink>
            </div>
            <div class="studio-next-item">
              <h3>{{ t('studios.dashboardNextSteps.settingsTitle') }}</h3>
              <p>{{ t('studios.dashboardNextSteps.settingsText') }}</p>
              <RouterLink class="btn btn-secondary btn-sm" :to="{ name: 'studio-settings', params: { studioId } }">
                {{ t('studios.dashboardNextSteps.settingsAction') }}
              </RouterLink>
            </div>
          </div>
          <div v-else-if="canViewMembers" class="studio-next-grid">
            <div class="studio-next-item">
              <h3>{{ t('studios.dashboardNextSteps.membersTitle') }}</h3>
              <p>{{ t('studios.dashboardNextSteps.membersText') }}</p>
              <RouterLink class="btn btn-secondary btn-sm" :to="{ name: 'studio-members', params: { studioId } }">
                {{ t('studios.dashboardNextSteps.membersAction') }}
              </RouterLink>
            </div>
          </div>
          <p v-else class="studio-muted">{{ t('studios.dashboardNextSteps.readOnlyText') }}</p>
        </article>
      </template>
    </div>
  </section>
</template>

<style scoped>
.studio-next-steps {
  padding: 1.25rem;
  display: grid;
  gap: 0.85rem;
}

.studio-next-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.85rem;
}

.studio-next-item {
  display: grid;
  gap: 0.4rem;
  align-content: start;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-soft);
}

.studio-next-item h3 {
  font-size: var(--text-base);
}

.studio-next-item p {
  color: var(--text-soft);
  font-size: var(--text-sm);
}

.studio-next-item .btn {
  justify-self: start;
  margin-top: 0.15rem;
}
</style>
