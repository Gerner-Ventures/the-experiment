<script setup lang="ts">
import { computed } from 'vue'
import type { RoundPhase } from '@/types/websocket'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  current: number
  total: number
  phase: RoundPhase | null
}>()

const phaseLabel = computed(() => {
  if (!props.phase) return ''
  const labels: Record<string, string> = {
    gm_plan: locale.hud.phaseGmPlan,
    dawn: locale.hud.phaseDawn,
    morning: locale.hud.phaseMorning,
    midday: locale.hud.phaseMidday,
    afternoon: locale.hud.phaseAfternoon,
    night: locale.hud.phaseNight,
  }
  return labels[props.phase] || props.phase
})
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="font-mono text-xs text-white/60">
      {{ locale.hud.roundOf.replace('{current}', String(current)).replace('{total}', String(total)) }}
    </span>
    <span v-if="phaseLabel" class="font-mono text-[10px] text-accent/60 uppercase">
      {{ phaseLabel }}
    </span>
  </div>
</template>
