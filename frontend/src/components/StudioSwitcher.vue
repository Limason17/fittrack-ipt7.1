<script setup>
import { computed, onMounted, useId } from 'vue'
import { useRouter } from 'vue-router'

import { authToken } from '../utils/auth'
import { t } from '../utils/i18n'
import {
  activeStudioId,
  authorizedStudios,
  hydrateStudioContext,
  selectStudio,
  studioContextStatus,
} from '../utils/studioContext'

defineProps({ compact: { type: Boolean, default: false } })
const emit = defineEmits(['changed'])

const router = useRouter()
const selectId = `fittrack-studio-context-${useId()}`
const selectableStudios = computed(() => authorizedStudios.value.filter((studio) => (
  studio.status === 'active' && studio.membership?.status === 'active'
)))
const selectedValue = computed(() => activeStudioId.value || '')

function roleLabel(role) {
  return t(`studios.roles.${role}`)
}

function optionLabel(studio) {
  return `${studio.name} — ${roleLabel(studio.membership.role)}`
}

// Stage 3A audit finding: the closed select clips a long studio name/role
// combination with no way to read the full value. A native <select> has no
// CSS ellipsis+tooltip hook of its own, so `title` on the element (for the
// closed/collapsed state) and on each `option` (for the open list) surface
// the full text via the browser's own tooltip instead.
const selectedLabel = computed(() => {
  const selected = selectableStudios.value.find((studio) => studio.id === selectedValue.value)
  return selected ? optionLabel(selected) : t('studios.personal')
})

async function changeContext(event) {
  const studioId = event.target.value
  const selected = selectStudio(studioId)
  if (selected) {
    await router.push({ name: 'studio-dashboard', params: { studioId: selected.id } })
  } else {
    await router.push({ name: 'home' })
  }
  emit('changed', selected?.id || null)
}

onMounted(() => {
  if (authToken.value && studioContextStatus.value === 'idle') {
    hydrateStudioContext().catch(() => {})
  }
})
</script>

<template>
  <div class="studio-switcher" :class="{ 'studio-switcher-compact': compact }">
    <label class="studio-switcher-label" :class="{ 'visually-hidden': compact }" :for="selectId">
      {{ t('studios.switcherLabel') }}
    </label>
    <select
      :id="selectId"
      class="studio-switcher-select"
      :aria-label="t('studios.switcherLabel')"
      :title="selectedLabel"
      :disabled="studioContextStatus === 'loading'"
      :value="selectedValue"
      @change="changeContext"
    >
      <option value="" :title="t('studios.personal')">{{ t('studios.personal') }}</option>
      <option v-for="studio in selectableStudios" :key="studio.id" :value="studio.id" :title="optionLabel(studio)">
        {{ optionLabel(studio) }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.studio-switcher {
  display: grid;
  gap: 0.15rem;
  min-width: 180px;
}

.studio-switcher-label {
  color: var(--text-muted);
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1;
  text-transform: uppercase;
}

.studio-switcher-select {
  width: 100%;
  min-height: 40px;
  padding: 0.4rem 2rem 0.4rem 0.65rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: var(--text-sm);
  font-weight: 750;
}

.studio-switcher-compact {
  width: 100%;
  min-width: 0;
}

.studio-switcher-compact .studio-switcher-select {
  min-height: 44px;
}
</style>
