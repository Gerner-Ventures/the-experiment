<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="h-full w-full bg-void text-white noise scanlines">
    <RouterView v-slot="{ Component, route }">
      <Transition
        :name="route.meta.transition as string || 'fade'"
        mode="out-in"
      >
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </div>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
