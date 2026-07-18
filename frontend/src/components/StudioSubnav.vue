<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { t } from '../utils/i18n'
import { MANAGEMENT_ROLES, MEMBERSHIP_VIEW_ROLES } from '../utils/studioContext'

const props = defineProps({
  studioId: { type: String, required: true },
  role: { type: String, default: null },
})

const canManage = computed(() => MANAGEMENT_ROLES.includes(props.role))
const canViewMembers = computed(() => MEMBERSHIP_VIEW_ROLES.includes(props.role))
</script>

<template>
  <nav class="studio-subnav" :aria-label="t('studios.navigation')">
    <RouterLink :to="{ name: 'studio-dashboard', params: { studioId } }">
      {{ t('studios.dashboard') }}
    </RouterLink>
    <template v-if="canManage">
      <RouterLink :to="{ name: 'studio-settings', params: { studioId } }">
        {{ t('studios.settings.title') }}
      </RouterLink>
    </template>
    <RouterLink v-if="canViewMembers" :to="{ name: 'studio-members', params: { studioId } }">
      {{ t('studios.members.title') }}
    </RouterLink>
    <template v-if="canManage">
      <RouterLink :to="{ name: 'studio-invitations', params: { studioId } }">
        {{ t('studios.invitations.title') }}
      </RouterLink>
    </template>
  </nav>
</template>
