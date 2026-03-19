<script setup>
import { RouterView } from 'vue-router'
import Navbar from './components/Navbar.vue'
</script>

<template>
  <header>
    <Navbar />
  </header>

  <main>
    <RouterView />
  </main>
</template>

<style scoped>
main {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}
</style>