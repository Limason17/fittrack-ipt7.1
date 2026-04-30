<script setup>
import { computed } from 'vue'

const props = defineProps({
  muscleGroup: {
    type: String,
    default: '',
  },
  category: {
    type: String,
    default: '',
  },
  exerciseName: {
    type: String,
    default: '',
  },
})

function normalizeValue(value) {
  return (value || '')
      .trim()
      .toLowerCase()
      .replaceAll('ä', 'ae')
      .replaceAll('ö', 'oe')
      .replaceAll('ü', 'ue')
      .replaceAll('ß', 'ss')
      .replace('rcken', 'ruecken')
      .replace('ganzkrper', 'ganzkoerper')
}

const normalizedMuscle = computed(() => normalizeValue(props.muscleGroup))

const viewMode = computed(() => {
  const backGroups = ['latissimus', 'obererruecken', 'hamstrings']
  return backGroups.includes(normalizedMuscle.value.replaceAll(' ', '')) ? 'back' : 'front'
})

function isHighlighted(key) {
  const muscle = normalizedMuscle.value.replaceAll(' ', '')

  const groups = {
    chest: ['brustmitte', 'oberebrust'],
    shoulders: ['vordereschulter', 'seitlicheschulter'],
    biceps: ['bizeps'],
    triceps: ['trizeps'],
    abs: ['bauch', 'core'],
    quads: ['quads'],
    calves: ['waden'],
    lats: ['latissimus'],
    upperBack: ['obererruecken'],
    hamstrings: ['hamstrings'],
    fullBody: ['ganzkoerper'],
  }

  return groups[key]?.includes(muscle)
}

const titleText = computed(() => props.exerciseName || 'Übung')
</script>

<template>
  <div class="illustration-wrap">
    <svg
        v-if="viewMode === 'front'"
        viewBox="0 0 260 260"
        class="illustration-svg"
        role="img"
        :aria-label="titleText"
    >
      <rect x="0" y="0" width="260" height="260" rx="24" class="bg" />

      <circle cx="130" cy="42" r="20" class="body" />
      <rect x="98" y="66" width="64" height="82" rx="28" class="body" />

      <rect x="68" y="76" width="22" height="68" rx="12" :class="isHighlighted('biceps') || isHighlighted('triceps') ? 'highlight' : 'body'" />
      <rect x="170" y="76" width="22" height="68" rx="12" :class="isHighlighted('biceps') || isHighlighted('triceps') ? 'highlight' : 'body'" />

      <rect x="102" y="146" width="22" height="82" rx="12" :class="isHighlighted('quads') || isHighlighted('calves') || isHighlighted('fullBody') ? 'highlight' : 'body'" />
      <rect x="136" y="146" width="22" height="82" rx="12" :class="isHighlighted('quads') || isHighlighted('calves') || isHighlighted('fullBody') ? 'highlight' : 'body'" />

      <ellipse cx="108" cy="88" rx="18" ry="16" :class="isHighlighted('shoulders') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
      <ellipse cx="152" cy="88" rx="18" ry="16" :class="isHighlighted('shoulders') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />

      <ellipse cx="110" cy="104" rx="17" ry="16" :class="isHighlighted('chest') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
      <ellipse cx="150" cy="104" rx="17" ry="16" :class="isHighlighted('chest') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />

      <rect x="114" y="118" width="32" height="28" rx="12" :class="isHighlighted('abs') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />

      <rect x="104" y="150" width="18" height="44" rx="10" :class="isHighlighted('quads') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
      <rect x="138" y="150" width="18" height="44" rx="10" :class="isHighlighted('quads') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />

      <rect x="106" y="194" width="14" height="26" rx="8" :class="isHighlighted('calves') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
      <rect x="140" y="194" width="14" height="26" rx="8" :class="isHighlighted('calves') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
    </svg>

    <svg
        v-else
        viewBox="0 0 260 260"
        class="illustration-svg"
        role="img"
        :aria-label="titleText"
    >
      <rect x="0" y="0" width="260" height="260" rx="24" class="bg" />

      <circle cx="130" cy="42" r="20" class="body" />
      <rect x="98" y="66" width="64" height="82" rx="28" class="body" />

      <rect x="68" y="76" width="22" height="68" rx="12" class="body" />
      <rect x="170" y="76" width="22" height="68" rx="12" class="body" />

      <rect x="102" y="146" width="22" height="82" rx="12" class="body" />
      <rect x="136" y="146" width="22" height="82" rx="12" class="body" />

      <ellipse cx="108" cy="90" rx="18" ry="16" :class="isHighlighted('shoulders') || isHighlighted('upperBack') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
      <ellipse cx="152" cy="90" rx="18" ry="16" :class="isHighlighted('shoulders') || isHighlighted('upperBack') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />

      <rect x="108" y="104" width="44" height="24" rx="12" :class="isHighlighted('lats') || isHighlighted('upperBack') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />

      <path
          d="M108 110 C94 114, 90 134, 102 150 L112 150 C104 134, 104 120, 108 110 Z"
          :class="isHighlighted('lats') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'"
      />
      <path
          d="M152 110 C166 114, 170 134, 158 150 L148 150 C156 134, 156 120, 152 110 Z"
          :class="isHighlighted('lats') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'"
      />

      <rect x="104" y="150" width="18" height="44" rx="10" :class="isHighlighted('hamstrings') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
      <rect x="138" y="150" width="18" height="44" rx="10" :class="isHighlighted('hamstrings') || isHighlighted('fullBody') ? 'highlight' : 'body-soft'" />
    </svg>
  </div>
</template>

<style scoped>
.illustration-wrap {
  width: 100%;
  height: 250px;
  background: linear-gradient(180deg, #f7f3ed 0%, #f0ebe3 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.illustration-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.bg {
  fill: #f7f3ed;
}

.body {
  fill: #d6cec2;
}

.body-soft {
  fill: #e7e1d8;
}

.highlight {
  fill: #d86a5c;
}
</style>