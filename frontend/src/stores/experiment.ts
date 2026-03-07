import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ExperimentStatus } from '@/types/experiment'
import type { RoundPhase, WSMessage } from '@/types/websocket'
import { useWorldStore } from '@/stores/world'
import { useAgentStore } from '@/stores/agent'
import { useUIStore } from '@/stores/ui'
import { useLocale } from '@/locales'

export interface ExperimentEvent {
  id: number
  type: string
  round: number
  phase?: string
  timestamp: string
  summary: string
  data: Record<string, unknown>
}

let eventCounter = 0

export const useExperimentStore = defineStore('experiment', () => {
  const id = ref<string | null>(null)
  const name = ref('')
  const status = ref<ExperimentStatus>('setup')
  const currentRound = ref(0)
  const totalRounds = ref(15)
  const currentPhase = ref<RoundPhase | null>(null)
  const events = ref<ExperimentEvent[]>([])

  const isRunning = computed(() => status.value === 'running')
  const isComplete = computed(() => status.value === 'completed' || status.value === 'collapsed')
  const progress = computed(() => totalRounds.value > 0 ? currentRound.value / totalRounds.value : 0)

  function setExperiment(data: {
    id: string
    name: string
    status: ExperimentStatus
    currentRound: number
    totalRounds: number
  }) {
    id.value = data.id
    name.value = data.name
    status.value = data.status
    currentRound.value = data.currentRound
    totalRounds.value = data.totalRounds
  }

  function addEvent(msg: WSMessage) {
    const summary = (msg.data as Record<string, unknown>).summary as string
      || (msg.data as Record<string, unknown>).text as string
      || msg.type
    events.value.push({
      id: ++eventCounter,
      type: msg.type,
      round: msg.round,
      phase: msg.phase,
      timestamp: msg.timestamp,
      summary,
      data: msg.data as Record<string, unknown>,
    })
    // Keep last 500 events
    if (events.value.length > 500) {
      events.value = events.value.slice(-500)
    }
  }

  function onRoundStart(msg: WSMessage) {
    currentRound.value = msg.round ?? currentRound.value
    currentPhase.value = null
    status.value = 'running'
    const locale = useLocale()
    useUIStore().setSteppingStatus(
      locale.hud.steppingRoundStarted.replace('{round}', String(currentRound.value)),
    )
    addEvent(msg)
  }

  function onRoundEnd(msg: WSMessage) {
    const data = msg.data as {
      status: string
      current_round: number
      total_rounds: number
      threat_level: number
      resources: Record<string, number>
      agents: Record<string, unknown>[]
    }
    if (data.current_round != null) currentRound.value = data.current_round
    if (data.total_rounds != null) totalRounds.value = data.total_rounds
    if (data.status) status.value = data.status as ExperimentStatus
    currentPhase.value = null

    // Sync world and agent stores from round_end payload
    const worldStore = useWorldStore()
    const agentStore = useAgentStore()
    if (data.threat_level != null) worldStore.setThreatLevel(data.threat_level)
    if (data.resources) {
      worldStore.setResources({
        food: data.resources.food ?? worldStore.resources.food,
        water: data.resources.water ?? worldStore.resources.water,
        materials: data.resources.materials ?? worldStore.resources.materials,
        power: data.resources.power ?? worldStore.resources.power,
      })
    }
    if (data.agents) agentStore.setAgents(data.agents)
    useUIStore().clearStepping()
    addEvent(msg)
  }

  function onPhaseChange(msg: WSMessage) {
    const phase = (msg.phase as RoundPhase) ?? null
    currentPhase.value = phase
    const data = msg.data as Record<string, unknown>
    const worldStore = useWorldStore()

    if (phase) {
      worldStore.onPhaseChange(phase)
    }

    // phase_change with {status: "starting"} = phase is about to begin (set stepping label)
    // phase_change with {events: [...]} = phase completed (log the event)
    if (data.status === 'starting' && phase) {
      const locale = useLocale()
      const labels: Record<string, string> = {
        gm_plan: locale.hud.steppingGmPlan,
        dawn: locale.hud.steppingDawn,
        morning: locale.hud.steppingMorning,
        midday: locale.hud.steppingMidday,
        afternoon: locale.hud.steppingAfternoon,
        night: locale.hud.steppingNight,
      }
      useUIStore().setSteppingStatus(labels[phase] ?? phase)
    }
    if (data.events) {
      addEvent(msg)
    }
  }

  function onEnd(msg: WSMessage) {
    status.value = 'completed'
    useUIStore().clearStepping()
    addEvent(msg)
  }

  function $reset() {
    id.value = null
    name.value = ''
    status.value = 'setup'
    currentRound.value = 0
    totalRounds.value = 15
    currentPhase.value = null
    events.value = []
    eventCounter = 0
  }

  return {
    id, name, status, currentRound, totalRounds, currentPhase,
    events,
    isRunning, isComplete, progress,
    setExperiment, addEvent, onRoundStart, onRoundEnd, onPhaseChange, onEnd,
    $reset,
  }
})
