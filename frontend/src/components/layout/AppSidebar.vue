<script setup>
import { ref, toRef } from 'vue'
import { RouterLink } from 'vue-router'
import { t } from '../../utils/i18n'
import { useModalFocus } from '../../utils/modalFocus'
import {
  activeStudio,
  activeStudioRole,
  canAccessTrainingManagement,
  canManageActiveStudio,
  canViewActiveStudioMembers,
  isStudioMemberRole,
} from '../../utils/studioContext'
import StudioSwitcher from '../StudioSwitcher.vue'
import fitTrackLogo from '../../assets/FitTrack Logo/FitTrack Logo.png'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

function roleLabel(role) {
  return role ? t(`studios.roles.${role}`) : ''
}

const dialogRef = ref(null)
const isOpen = toRef(props, 'open')
function close() {
  emit('close')
}
const { handleModalKeydown } = useModalFocus({ isOpen, dialogRef, close })
</script>

<template>
  <div v-if="open" class="sidebar-backdrop mobile-only" @click="close"></div>
  <aside
    id="app-sidebar-nav"
    ref="dialogRef"
    class="app-sidebar"
    :class="{ 'app-sidebar-open': open }"
    tabindex="-1"
    @keydown="open && handleModalKeydown($event)"
  >
    <div class="app-sidebar-top">
      <RouterLink to="/" class="app-sidebar-logo" @click="emit('close')">
        <img :src="fitTrackLogo" alt="FitTrack" />
      </RouterLink>
      <StudioSwitcher />
    </div>

    <nav class="app-sidebar-nav" :aria-label="t('routing.mainNavigation')">
      <div class="app-sidebar-group">
        <span class="app-sidebar-group-label">{{ t('nav.personalSection') }}</span>
        <RouterLink to="/" class="app-sidebar-link" @click="emit('close')">
          {{ t('nav.dashboard') }}
        </RouterLink>
        <RouterLink to="/workouts" class="app-sidebar-link" @click="emit('close')">
          {{ t('nav.workouts') }}
        </RouterLink>
        <RouterLink to="/exercises" class="app-sidebar-link" @click="emit('close')">
          {{ t('nav.exercises') }}
        </RouterLink>
        <RouterLink to="/progress" class="app-sidebar-link" @click="emit('close')">
          {{ t('nav.progress') }}
        </RouterLink>
        <RouterLink to="/profile" class="app-sidebar-link" @click="emit('close')">
          {{ t('nav.profile') }}
        </RouterLink>
      </div>

      <div v-if="activeStudio" class="app-sidebar-group">
        <span class="app-sidebar-group-label">
          {{ t('nav.studioSection') }}
          <span class="app-sidebar-group-role">{{ roleLabel(activeStudioRole) }}</span>
        </span>
        <RouterLink
          :to="{ name: 'studio-dashboard', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.studioOverview') }}
        </RouterLink>
        <RouterLink
          v-if="canViewActiveStudioMembers"
          :to="{ name: 'studio-members', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.members') }}
        </RouterLink>
        <RouterLink
          v-if="canManageActiveStudio"
          :to="{ name: 'studio-invitations', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.invitations') }}
        </RouterLink>
        <RouterLink
          v-if="canAccessTrainingManagement"
          :to="{ name: 'studio-coaching', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.coaching') }}
        </RouterLink>
        <RouterLink
          v-if="canAccessTrainingManagement"
          :to="{ name: 'studio-training-programs', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.trainingPrograms') }}
        </RouterLink>
        <RouterLink
          v-if="canAccessTrainingManagement"
          :to="{ name: 'studio-program-assignments', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.assignments') }}
        </RouterLink>
        <RouterLink
          v-if="isStudioMemberRole"
          :to="{ name: 'studio-my-training-plan', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.myTrainingPlan') }}
        </RouterLink>
        <RouterLink
          v-if="isStudioMemberRole"
          :to="{ name: 'studio-workout-sessions', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.myWorkoutSessions') }}
        </RouterLink>
        <RouterLink
          v-if="canManageActiveStudio"
          :to="{ name: 'studio-audit', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.audit') }}
        </RouterLink>
        <RouterLink
          v-if="canManageActiveStudio"
          :to="{ name: 'studio-settings', params: { studioId: activeStudio.id } }"
          class="app-sidebar-link"
          @click="emit('close')"
        >
          {{ t('nav.studioSettings') }}
        </RouterLink>
      </div>

      <RouterLink to="/studios" class="app-sidebar-link app-sidebar-link-muted" @click="emit('close')">
        {{ t('studios.allStudios') }}
      </RouterLink>
    </nav>
  </aside>
</template>

<style scoped>
.app-sidebar {
  grid-area: sidebar;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: var(--shell-sidebar-width);
  padding: 1rem 0.85rem 1.25rem;
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}

.app-sidebar-top {
  display: grid;
  gap: 0.85rem;
  padding: 0 0.15rem;
}

.app-sidebar-logo {
  display: inline-flex;
  padding: 0.25rem 0;
}

.app-sidebar-logo img {
  height: 28px;
  width: auto;
}

.app-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.app-sidebar-group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.app-sidebar-group-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 0.6rem;
  margin-bottom: 0.3rem;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.app-sidebar-group-role {
  color: var(--accent-hover);
  text-transform: none;
  font-weight: 700;
}

.app-sidebar-link {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0 0.6rem;
  border-radius: var(--radius-sm);
  color: var(--text-soft);
  font-size: var(--text-sm);
  font-weight: 650;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.app-sidebar-link:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.app-sidebar-link.router-link-exact-active {
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 750;
}

.app-sidebar-link-muted {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
}

.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1090;
  background: rgba(15, 18, 21, 0.4);
}

.mobile-only {
  display: none;
}

@media (max-width: 1023px) {
  .mobile-only {
    display: block;
  }

  .app-sidebar {
    position: fixed;
    z-index: 1100;
    inset: 0 auto 0 0;
    height: 100dvh;
    transform: translateX(-100%);
    box-shadow: var(--shadow-md);
    transition: transform var(--transition);
  }

  .app-sidebar-open {
    transform: translateX(0);
  }
}
</style>
