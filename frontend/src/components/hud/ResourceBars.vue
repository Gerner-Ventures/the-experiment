<script setup lang="ts">
import { computed } from 'vue'
import type { Resources } from '@/types/experiment'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  resources: Resources
}>()

const MAX_VALUES: Resources = { food: 50, water: 50, materials: 30, power: 20 }

const bars = computed(() => [
  { key: 'food' as const, label: locale.parameters.resources.food, value: props.resources.food, max: MAX_VALUES.food, color: '#4ade80' },
  { key: 'water' as const, label: locale.parameters.resources.water, value: props.resources.water, max: MAX_VALUES.water, color: '#60a5fa' },
  { key: 'materials' as const, label: locale.parameters.resources.materials, value: props.resources.materials, max: MAX_VALUES.materials, color: '#f59e0b' },
  { key: 'power' as const, label: locale.parameters.resources.power, value: props.resources.power, max: MAX_VALUES.power, color: '#a78bfa' },
])
</script>

<template>
  <div class="bg-base/80 backdrop-blur-sm rounded-lg border border-white/[0.06] p-3 w-44 space-y-2">
    <span class="font-mono text-[10px] text-white/40 uppercase tracking-wider">{{ locale.hud.resources }}</span>

    <div v-for="bar in bars" :key="bar.key" class="space-y-0.5">
      <div class="flex items-center justify-between">
        <span class="font-mono text-[9px] text-white/50">{{ bar.label }}</span>
        <span class="font-mono text-[9px] text-white/30">{{ Math.round(bar.value) }}</span>
      </div>
      <div class="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500 ease-out"
          :style="{
            width: `${Math.min(100, (bar.value / bar.max) * 100)}%`,
            backgroundColor: bar.value < bar.max * 0.2 ? '#ff2d55' : bar.color,
          }"
          :class="{ 'animate-pulse': bar.value < bar.max * 0.15 }"
        />
      </div>
    </div>
  </div>
</template>
