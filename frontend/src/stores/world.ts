import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Resources } from '@/types/experiment'
import type { RoundPhase, WSMessage } from '@/types/websocket'
import type { CrisisEvent } from '@/types/gm'

export const useWorldStore = defineStore('world', () => {
  const resources = ref<Resources>({ food: 24, water: 30, materials: 14, power: 10 })
  const threatLevel = ref(0)
  const currentPhase = ref<RoundPhase | null>(null)
  const activeCrisis = ref<CrisisEvent | null>(null)

  const threatColor = computed(() => {
    const t = threatLevel.value
    if (t < 25) return '#00e5a0'
    if (t < 50) return '#f5c542'
    if (t < 75) return '#ff6b35'
    return '#ff2d55'
  })

  const isCollapsing = computed(() => threatLevel.value >= 80)

  function setResources(r: Resources) {
    resources.value = r
  }

  function onResourceUpdate(msg: WSMessage) {
    const data = msg.data as Record<string, unknown>
    resources.value = {
      food: (data.food as number) ?? resources.value.food,
      water: (data.water as number) ?? resources.value.water,
      materials: (data.materials as number) ?? resources.value.materials,
      power: (data.power as number) ?? resources.value.power,
    }
  }

  function onThreatUpdate(msg: WSMessage) {
    const data = msg.data as Record<string, unknown>
    threatLevel.value = (data.threat_level as number) ?? threatLevel.value
  }

  function onCrisis(msg: WSMessage) {
    const data = msg.data as Record<string, unknown>
    activeCrisis.value = {
      type: data.type as CrisisEvent['type'],
      description: data.description as string,
      severity: data.severity as CrisisEvent['severity'],
      affects: data.affects as string[] | undefined,
    }
  }

  function onPhaseChange(phase: RoundPhase) {
    currentPhase.value = phase
  }

  function $reset() {
    resources.value = { food: 24, water: 30, materials: 14, power: 10 }
    threatLevel.value = 0
    currentPhase.value = null
    activeCrisis.value = null
  }

  return {
    resources, threatLevel, currentPhase, activeCrisis,
    threatColor, isCollapsing,
    setResources, onResourceUpdate, onThreatUpdate, onCrisis, onPhaseChange,
    $reset,
  }
})
