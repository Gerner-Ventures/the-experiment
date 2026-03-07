<script setup lang="ts">
import { computed } from 'vue'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  value: number
}>()

const percentage = computed(() => Math.min(100, Math.max(0, props.value)))

const color = computed(() => {
  const v = percentage.value
  if (v < 25) return '#00e5a0'
  if (v < 50) return '#f5c542'
  if (v < 75) return '#ff6b35'
  return '#ff2d55'
})

const isPulsing = computed(() => percentage.value >= 75)

const label = computed(() => {
  const v = percentage.value
  if (v < 25) return locale.hud.threatLow
  if (v < 50) return locale.hud.threatMedium
  if (v < 75) return locale.hud.threatHigh
  return locale.hud.threatCritical
})
</script>

<template>
  <div class="bg-base/80 backdrop-blur-sm rounded-lg border border-white/[0.06] p-3 w-44">
    <div class="flex items-center justify-between mb-2">
      <span class="font-mono text-[10px] text-white/40 uppercase tracking-wider">{{ locale.hud.threat }}</span>
      <span
        class="font-mono text-xs font-bold"
        :class="{ 'animate-pulse': isPulsing }"
        :style="{ color }"
      >
        {{ Math.round(percentage) }}
      </span>
    </div>

    <!-- Gauge bar -->
    <div class="relative h-2 bg-white/[0.06] rounded-full overflow-hidden">
      <div
        class="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
        :class="{ 'animate-pulse': isPulsing }"
        :style="{ width: `${percentage}%`, backgroundColor: color }"
      />
    </div>

    <div class="mt-1 text-right">
      <span class="font-mono text-[9px] uppercase tracking-wider" :style="{ color: color + '99' }">
        {{ label }}
      </span>
    </div>
  </div>
</template>
