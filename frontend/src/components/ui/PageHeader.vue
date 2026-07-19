<script setup>
defineProps({
  eyebrow: { type: String, default: '' },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
})
</script>

<template>
  <header class="page-header">
    <div class="page-header-text">
      <span v-if="eyebrow || $slots.eyebrow" class="eyebrow">
        <slot name="eyebrow">{{ eyebrow }}</slot>
      </span>
      <div class="page-header-title-row">
        <h1 class="page-title">{{ title }}</h1>
        <span v-if="$slots.badge" class="page-header-badge">
          <slot name="badge" />
        </span>
      </div>
      <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.25rem;
  flex-wrap: wrap;
}

.page-header-text {
  min-width: 0;
}

.page-header-title-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.page-header-title-row .page-title {
  margin-bottom: 0;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

@media (max-width: 560px) {
  .page-header-actions {
    width: 100%;
  }

  .page-header-actions .btn {
    flex: 1;
  }
}
</style>
