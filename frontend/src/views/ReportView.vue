<script setup lang="ts">
import { useLocale } from '@/locales'

const locale = useLocale()
// TODO: S1.8 — Post-game report
</script>

<template>
  <div class="report">
    <h1>{{ locale.report.title }}</h1>
    <p>{{ locale.report.placeholder }}</p>
  </div>
</template>

<style scoped>
.report {
  padding: 2rem;
}
</style>
