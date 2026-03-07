<script setup lang="ts">
import { computed } from 'vue'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  arcName: string
  currentRound: number
  totalRounds: number
}>()

interface TimelineAct {
  name: string
  startRound: number
  endRound: number
  tone: string
}

const acts = computed<TimelineAct[]>(() => {
  // Map arc presets to acts
  const arcMap: Record<string, TimelineAct[]> = {
    'lord-of-the-flies': [
      { name: 'False Peace', startRound: 1, endRound: 5, tone: 'Cooperative' },
      { name: 'The Fracture', startRound: 6, endRound: 10, tone: 'Suspicious' },
      { name: 'The Reckoning', startRound: 11, endRound: 15, tone: 'Desperate' },
    ],
    'slow-burn': [
      { name: 'Arrival', startRound: 1, endRound: 3, tone: 'Curious' },
      { name: 'Settling In', startRound: 4, endRound: 6, tone: 'Comfortable' },
      { name: 'First Cracks', startRound: 7, endRound: 9, tone: 'Uneasy' },
      { name: 'Erosion', startRound: 10, endRound: 12, tone: 'Strained' },
      { name: 'Collapse', startRound: 13, endRound: 15, tone: 'Chaotic' },
    ],
    'chaos-from-round-1': [
      { name: 'Panic', startRound: 1, endRound: 6, tone: 'Desperate' },
      { name: 'Endgame', startRound: 7, endRound: 15, tone: 'Apocalyptic' },
    ],
    'the-long-peace': [
      { name: 'Golden Age', startRound: 1, endRound: 6, tone: 'Peaceful' },
      { name: 'Shock', startRound: 7, endRound: 11, tone: 'Crisis' },
      { name: 'Aftermath', startRound: 12, endRound: 15, tone: 'Survival' },
    ],
  }
  return arcMap[props.arcName] || []
})

const currentActIndex = computed(() => {
  return acts.value.findIndex(
    act => props.currentRound >= act.startRound && props.currentRound <= act.endRound
  )
})
</script>

<template>
  <div class="bg-base/80 backdrop-blur-sm rounded-lg border border-white/[0.06] p-3 min-w-[180px]">
    <span class="font-mono text-[10px] text-white/40 uppercase tracking-wider block mb-2">{{ locale.hud.arc }}</span>

    <div class="space-y-1">
      <div
        v-for="(act, i) in acts"
        :key="i"
        class="flex items-center gap-2"
      >
        <div
          class="w-2 h-2 rounded-full shrink-0 transition-colors duration-300"
          :class="{
            'bg-accent': i === currentActIndex,
            'bg-white/20': i !== currentActIndex && i > currentActIndex,
            'bg-white/10': i < currentActIndex,
          }"
        />
        <span
          class="font-mono text-[10px] transition-colors duration-300"
          :class="{
            'text-accent': i === currentActIndex,
            'text-white/40': i !== currentActIndex,
          }"
        >
          {{ act.name }}
        </span>
        <span class="font-mono text-[8px] text-white/20 ml-auto">
          {{ act.startRound }}-{{ act.endRound }}
        </span>
      </div>
    </div>
  </div>
</template>
