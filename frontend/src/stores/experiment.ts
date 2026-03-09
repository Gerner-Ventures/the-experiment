import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ExperimentStatus } from '@/types/experiment'
import type { RoundEndData, RoundPhase, WSMessage } from '@/types/websocket'
import { useWorldStore } from '@/stores/world'
import { useAgentStore } from '@/stores/agent'
import { useUIStore } from '@/stores/ui'
import { useTurnStore } from '@/stores/turn'
import { useSocialStore } from '@/stores/social'
import { useLocale } from '@/locales'

export interface ExperimentEvent {
  id: number
  type: string
  round: number
  phase?: string
  /** Backend-provided timestamp (ISO string) */
  timestamp: string
  /** Local time when the WS message was received (ms since epoch) */
  receivedAt: number
  summary: string
  data: Record<string, unknown>
}

let eventCounter = 0

export const useExperimentStore = defineStore('experiment', () => {
  /** Track active polling intervals so they can be cleaned up on $reset().
   *  Scoped inside the store factory so each instance has its own set. */
  const activeIntervals = new Set<ReturnType<typeof setInterval>>()

  function trackInterval(id: ReturnType<typeof setInterval>): ReturnType<typeof setInterval> {
    activeIntervals.add(id)
    return id
  }

  function clearTrackedInterval(id: ReturnType<typeof setInterval>) {
    clearInterval(id)
    activeIntervals.delete(id)
  }

  function clearAllIntervals() {
    activeIntervals.forEach(id => clearInterval(id))
    activeIntervals.clear()
  }

  const locale = useLocale()
  const id = ref<string | null>(null)
  const name = ref('')
  const status = ref<ExperimentStatus>('setup')
  const currentRound = ref(0)
  const totalRounds = ref(15)
  const currentPhase = ref<RoundPhase | null>(null)
  const completedRounds = ref(0)
  const events = ref<ExperimentEvent[]>([])

  /** Guard against duplicate round_end processing (reconnect race, backend retry) */
  let roundEndPending = false

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
      receivedAt: Date.now(),
      summary,
      data: msg.data as Record<string, unknown>,
    })
    if (events.value.length > 500) {
      events.value = events.value.slice(-500)
    }
  }

  function onRoundStart(msg: WSMessage) {
    currentRound.value = msg.round ?? currentRound.value
    currentPhase.value = null
    status.value = 'running'
    useUIStore().setSteppingStatus(
      locale.hud.steppingRoundStarted.replace('{round}', String(currentRound.value)),
    )
  }

  /**
   * Wait for both turn queue drain AND meeting dismissal before proceeding.
   * This prevents phases from advancing while a meeting scene is active.
   */
  function waitForReady(callback: () => void, label: string) {
    const turnStore = useTurnStore()
    const socialStore = useSocialStore()

    const tryProceed = () => {
      if (turnStore.isProcessing) {
        console.debug(`[Experiment] ${label} deferred — waiting for turn queue`)
        turnStore.onDrained(tryProceed)
        return
      }
      if (socialStore.isMeetingActive) {
        console.debug(`[Experiment] ${label} deferred — waiting for meeting dismissal`)
        // Poll for meeting dismissal (watch isn't available in store context)
        const checkMeeting = trackInterval(setInterval(() => {
          if (!socialStore.isMeetingActive) {
            clearTrackedInterval(checkMeeting)
            tryProceed()
          }
        }, 200))
        return
      }
      callback()
    }

    tryProceed()
  }

  function onRoundEnd(msg: WSMessage) {
    if (roundEndPending) return
    roundEndPending = true

    const data = msg.data as unknown as RoundEndData
    if (data.current_round != null) currentRound.value = data.current_round
    if (data.total_rounds != null) totalRounds.value = data.total_rounds
    if (data.status) status.value = data.status as ExperimentStatus
    currentPhase.value = null

    // Sync world store immediately
    const worldStore = useWorldStore()
    if (data.threat_level != null) worldStore.setThreatLevel(data.threat_level)
    if (data.resources) {
      worldStore.setResources({
        food: data.resources.food ?? worldStore.resources.food,
        water: data.resources.water ?? worldStore.resources.water,
        materials: data.resources.materials ?? worldStore.resources.materials,
        power: data.resources.power ?? worldStore.resources.power,
      })
    }

    // Defer round finalization until turns drain AND meeting closes
    const finalize = () => {
      roundEndPending = false
      if (data.agents?.length) useAgentStore().setAgents(data.agents)
      completedRounds.value++
      useUIStore().clearStepping()
      console.debug(`[Experiment] Round ${currentRound.value} finalized`)
    }

    useUIStore().setSteppingStatus(locale.hud.steppingWaiting)
    waitForReady(finalize, `round ${currentRound.value} end`)
  }

  function onPhaseChange(msg: WSMessage) {
    const phase = (msg.phase as RoundPhase) ?? null
    const data = msg.data as Record<string, unknown>
    const socialStore = useSocialStore()

    // Always update the world phase immediately — the PixiWorld renders behind
    // the meeting overlay (opacity-0), so day/night updates are invisible during
    // meetings. When the meeting closes, the world is already at the correct
    // time of day (no jarring jump).
    currentPhase.value = phase
    if (phase) {
      useWorldStore().onPhaseChange(phase)
    }
    console.debug(`[Experiment] Phase applied: ${phase}`)

    // HUD status updates are deferred until the meeting closes — showing
    // "Afternoon starting…" mid-meeting breaks immersion.
    if (data.status === 'starting' && phase) {
      const labels: Record<string, string> = {
        gm_plan: locale.hud.steppingGmPlan,
        dawn: locale.hud.steppingDawn,
        morning: locale.hud.steppingMorning,
        midday: locale.hud.steppingMidday,
        afternoon: locale.hud.steppingAfternoon,
        night: locale.hud.steppingNight,
      }
      if (socialStore.isMeetingActive) {
        // Defer HUD label until meeting dismisses
        const check = trackInterval(setInterval(() => {
          if (!socialStore.isMeetingActive) {
            clearTrackedInterval(check)
            useUIStore().setSteppingStatus(labels[phase] ?? phase)
          }
        }, 200))
      } else {
        useUIStore().setSteppingStatus(labels[phase] ?? phase)
      }
    }
  }

  function onEnd(msg: WSMessage) {
    const data = msg.data as { status?: string }
    status.value = (data.status as ExperimentStatus) ?? 'completed'
    useUIStore().clearStepping()
  }

  function $reset() {
    clearAllIntervals()
    roundEndPending = false
    id.value = null
    name.value = ''
    status.value = 'setup'
    currentRound.value = 0
    totalRounds.value = 15
    currentPhase.value = null
    completedRounds.value = 0
    events.value = []
    eventCounter = 0
  }

  return {
    id, name, status, currentRound, totalRounds, currentPhase, completedRounds,
    events,
    isRunning, isComplete, progress,
    setExperiment, addEvent, onRoundStart, onRoundEnd, onPhaseChange, onEnd,
    $reset,
  }
})
