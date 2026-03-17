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
  /** Latest phase the backend reported — may be ahead of the visual when turns are active */
  const latestBackendPhase = ref<RoundPhase | null>(null)
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

  /**
   * Apply a phase visually — updates currentPhase, PixiWorld day/night, and HUD label.
   * Called either immediately (when queue idle) or by the turn store (when queue drives phase).
   */
  function applyPhase(phase: RoundPhase) {
    if (currentPhase.value === phase) return
    currentPhase.value = phase
    useWorldStore().onPhaseChange(phase)
    console.debug(`[Experiment] Phase applied: ${phase}`)

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

  function onPhaseChange(msg: WSMessage) {
    const phase = (msg.phase as RoundPhase) ?? null
    if (!phase) return

    const turnStore = useTurnStore()

    // When no turns are active, apply immediately (pre-turn phases: gm_plan, dawn, morning)
    if (!turnStore.isProcessing) {
      applyPhase(phase)
      return
    }

    // When turns are active, store the latest backend phase. The turn store drives
    // the visual phase from turn.phase, and flushes latestBackendPhase when the
    // queue drains (handles phases with no tagged turns, like night).
    latestBackendPhase.value = phase
    console.debug(`[Experiment] Phase received: ${phase} (visual driven by turn queue)`)
  }

  /**
   * Called by the turn store when the queue drains. Applies the latest backend
   * phase if turns didn't cover it (e.g., night phase has no agent actions).
   */
  function flushLatestPhase() {
    if (latestBackendPhase.value && latestBackendPhase.value !== currentPhase.value) {
      applyPhase(latestBackendPhase.value)
    }
    latestBackendPhase.value = null
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
    latestBackendPhase.value = null
    completedRounds.value = 0
    events.value = []
    eventCounter = 0
  }

  return {
    id, name, status, currentRound, totalRounds, currentPhase, completedRounds,
    events,
    isRunning, isComplete, progress,
    setExperiment, addEvent, onRoundStart, onRoundEnd, onPhaseChange, applyPhase, flushLatestPhase, onEnd,
    $reset,
  }
})
