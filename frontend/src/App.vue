<script setup>
import { RouterView } from 'vue-router'
import Navbar from './components/Navbar.vue'
</script>

<template>
  <div class="app-shell">
    <Navbar />
    <main>
      <RouterView />
    </main>
  </div>
</template>
