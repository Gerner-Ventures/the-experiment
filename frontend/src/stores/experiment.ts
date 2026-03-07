import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ExperimentStatus } from '@/types/experiment'
import type { RoundPhase, WSMessage } from '@/types/websocket'

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
  const cooperationRatio = ref(0.5)
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
    const data = msg.data as { round: number; total_rounds: number }
    currentRound.value = data.round
    status.value = 'running'
    addEvent(msg)
  }

  function onRoundEnd(msg: WSMessage) {
    const data = msg.data as { cooperation_ratio: number; threat_level: number }
    cooperationRatio.value = data.cooperation_ratio
    addEvent(msg)
  }

  function onPhaseChange(msg: WSMessage) {
    const data = msg.data as { phase: RoundPhase }
    currentPhase.value = data.phase
    addEvent(msg)
  }

  function onEnd(msg: WSMessage) {
    status.value = 'completed'
    addEvent(msg)
  }

  function $reset() {
    id.value = null
    name.value = ''
    status.value = 'setup'
    currentRound.value = 0
    totalRounds.value = 15
    currentPhase.value = null
    cooperationRatio.value = 0.5
    events.value = []
    eventCounter = 0
  }

  return {
    id, name, status, currentRound, totalRounds, currentPhase,
    cooperationRatio, events,
    isRunning, isComplete, progress,
    setExperiment, addEvent, onRoundStart, onRoundEnd, onPhaseChange, onEnd,
    $reset,
  }
})
