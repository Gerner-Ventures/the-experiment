<script setup lang="ts">
import { useLocale } from '@/locales'

const locale = useLocale()
// TODO: S1.3-S1.7 — Isometric world, agent rendering, UI panels, dossier, social views
</script>

<template>
  <div class="simulation">
    <p>{{ locale.simulation.placeholder }}</p>
  </div>
</template>

<style scoped>
.simulation {
  width: 100%;
  height: 100vh;
}
</style>
