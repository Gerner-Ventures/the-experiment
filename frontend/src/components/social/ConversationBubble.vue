<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  agentName: string
  message: string
  index?: number
}>()

const visible = ref(true)
let fadeTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  fadeTimer = setTimeout(() => {
    visible.value = false
  }, 6000)
})

onUnmounted(() => {
  if (fadeTimer) clearTimeout(fadeTimer)
})

const bottomOffset = (props.index ?? 0) * 64 + 56
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="absolute right-4 z-30 max-w-[240px]"
      :style="{ bottom: `${bottomOffset}px` }"
    >
      <div class="bg-base/90 backdrop-blur-sm border border-white/[0.08] rounded-lg px-3 py-2 shadow-lg">
        <div class="font-mono text-[10px] text-accent/60 uppercase tracking-wider mb-0.5">
          {{ agentName }}
        </div>
        <div class="text-xs text-white/80 leading-snug line-clamp-3">
          "{{ message }}"
        </div>
      </div>
    </div>
  </Transition>
</template>
