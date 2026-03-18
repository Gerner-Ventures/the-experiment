import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUIStore } from '@/stores/ui'
import { useLocale } from '@/locales'
import { HD_ACTION_TO_ANIMATION as ACTION_TO_ANIMATION } from '@/config/sprites/hd/animations'
import { SKIP_ACTION_PHASE, SPEECH_ONLY_ACTIONS } from '@/config/action-categories'
import type { AgentStatus } from '@/types/agent'
import type { AgentSpeechSource, RoundPhase } from '@/types/websocket'
import { useSocialStore, type ConversationRef } from '@/stores/social'
import { useExperimentStore } from '@/stores/experiment'

export interface Turn {
  id: number
  agentId: string
  agentName: string
  round: number
  /** The backend phase this action belongs to (morning, midday, afternoon, etc.) */
  phase?: string
  actionType: string
  targetAgentId?: string
  targetLocation?: string
  thought?: string
  thoughtSource?: AgentSpeechSource
  thoughtConversationId?: number
  thoughtAudioIndex?: number
  /** When true, the speech row was already added by agent_speak — skip addConversation */
  fromSpeakEvent?: boolean
  /** True when this turn is a system-generated consequence, not an agent decision */
  isConsequence?: boolean
  /** Agent who caused this consequence (for highlighting/targeting) */
  causedBy?: string
}

export type TurnPhase = 'idle' | 'thinking' | 'moving' | 'acting' | 'hud-only'

export interface TurnHandlers {
  move: (agentId: string, location: string, onComplete: () => void) => void
  playAction: (agentId: string, animationName: string, onComplete: () => void) => void
  updateAgent: (agentId: string, status: AgentStatus, location?: string) => void
  addConversation: (
    agentId: string,
    agentName: string,
    message: string,
    source: AgentSpeechSource,
    round: number,
  ) => ConversationRef | void
  getAgentLocation: (agentId: string) => string | undefined
}

/** Minimum time the acting phase is visible so players can register the action,
 *  even if the sprite animation completes sooner. */
const MIN_ACTION_DURATION_MS = 1500

/** How long the HUD status is shown for actions with no speech bubble,
 *  before advancing to the next agent in the queue. */
const HUD_ONLY_DURATION_MS = 1500

/** Maximum time to wait for audio playback before force-advancing */
const AUDIO_MAX_TIMEOUT_MS = 15000

/** Brief pause between turns so the user can register the transition */
const TURN_GAP_MS = 400

// ─── Turn Lifecycle Tracker ───

interface TurnLifecycle {
  turnId: number
  agentName: string
  actionType: string
  startMs: number
  thoughtStartMs: number | null
  thoughtEndMs: number | null
  thoughtDismissReason: string | null
  moveStartMs: number | null
  moveEndMs: number | null
  moveSkipReason: string | null
  actionStartMs: number | null
  actionEndMs: number | null
  actionSkipReason: string | null
  audioStatus: string
  interrupted: boolean
}

function createLifecycle(turn: Turn): TurnLifecycle {
  return {
    turnId: turn.id,
    agentName: turn.agentName,
    actionType: turn.actionType,
    startMs: performance.now(),
    thoughtStartMs: null,
    thoughtEndMs: null,
    thoughtDismissReason: null,
    moveStartMs: null,
    moveEndMs: null,
    moveSkipReason: null,
    actionStartMs: null,
    actionEndMs: null,
    actionSkipReason: null,
    audioStatus: 'none',
    interrupted: false,
  }
}

function formatMs(ms: number | null): string {
  if (ms === null) return 'skipped'
  return `${(ms / 1000).toFixed(1)}s`
}

function logLifecycle(lc: TurnLifecycle) {
  const totalMs = performance.now() - lc.startMs
  const thoughtMs = lc.thoughtStartMs != null && lc.thoughtEndMs != null
    ? lc.thoughtEndMs - lc.thoughtStartMs : null
  const moveMs = lc.moveStartMs != null && lc.moveEndMs != null
    ? lc.moveEndMs - lc.moveStartMs : null
  const actionMs = lc.actionStartMs != null && lc.actionEndMs != null
    ? lc.actionEndMs - lc.actionStartMs : null

  const parts = [
    `thought: ${formatMs(thoughtMs)}${lc.thoughtDismissReason ? ` (${lc.thoughtDismissReason})` : ''}`,
    `move: ${lc.moveSkipReason ? lc.moveSkipReason : formatMs(moveMs)}`,
    `action: ${lc.actionSkipReason ? lc.actionSkipReason : formatMs(actionMs)}`,
    `audio: ${lc.audioStatus}`,
  ]

  const prefix = lc.interrupted ? '⚠' : '✓'
  console.debug(
    `[Turn #${lc.turnId}] ${prefix} ${lc.agentName} → ${lc.actionType} (${formatMs(totalMs)} total)\n  ${parts.join(' | ')}`,
  )
}

function queueSummary(queue: Turn[]): string {
  if (queue.length === 0) return 'empty'
  const counts: Record<string, number> = {}
  for (const t of queue) {
    const key = t.actionType
    counts[key] = (counts[key] ?? 0) + 1
  }
  const parts = Object.entries(counts).map(([k, v]) => `${k}: ${v}`)
  return `${queue.length} remaining [${parts.join(', ')}]`
}

// ─── Store ───

export const useTurnStore = defineStore('turn', () => {
  const locale = useLocale()
  const queue = ref<Turn[]>([])
  const activeTurn = ref<Turn | null>(null)
  const phase = ref<TurnPhase>('idle')
  const blocked = ref(false)
  const isProcessing = computed(() => activeTurn.value !== null || queue.value.length > 0)
  const hasPendingTurns = computed(() => queue.value.length > 0)

  const uiStore = useUIStore()

  let turnCounter = 0
  let hudTimer: ReturnType<typeof setTimeout> | null = null
  let actionFloorTimer: ReturnType<typeof setTimeout> | null = null
  let thoughtTimer: ReturnType<typeof setTimeout> | null = null
  let turnGapTimer: ReturnType<typeof setTimeout> | null = null

  // External handlers — set by SimulationView to bridge PixiJS and Vue layers
  let handlers: TurnHandlers | null = null
  let drainedHandlers: (() => void)[] = []

  // Lifecycle tracking for the active turn
  let lifecycle: TurnLifecycle | null = null

  function setHandlers(h: TurnHandlers) {
    handlers = h
  }

  /** Add a one-shot callback fired when the queue fully drains */
  function onDrained(cb: () => void) {
    drainedHandlers.push(cb)
  }

  function enqueue(turn: Omit<Turn, 'id'>) {
    const t: Turn = { ...turn, id: ++turnCounter }
    queue.value.push(t)
    console.debug(
      `[Turn] Enqueued: ${turn.agentName} → ${turn.actionType}${turn.targetLocation ? ` @ ${turn.targetLocation}` : ''} | Queue: ${queueSummary(queue.value)}`,
    )

    // If nothing is active, start processing
    if (!activeTurn.value && !blocked.value) {
      processNext()
    }
  }

  /** Schedule the next turn with a brief gap so transitions don't overlap */
  function scheduleNext() {
    // Clear any existing gap timer to prevent double-scheduling
    if (turnGapTimer) {
      clearTimeout(turnGapTimer)
      turnGapTimer = null
    }

    if (queue.value.length === 0) {
      processNext() // drain immediately
      return
    }
    // Brief pause between turns
    phase.value = 'idle'
    turnGapTimer = setTimeout(() => {
      turnGapTimer = null
      processNext()
    }, TURN_GAP_MS)
  }

  function processNext() {
    clearTimers()

    if (blocked.value) {
      activeTurn.value = null
      phase.value = 'idle'
      return
    }

    if (queue.value.length === 0) {
      activeTurn.value = null
      phase.value = 'idle'
      // Apply any backend phase that had no tagged turns (e.g., night)
      useExperimentStore().flushLatestPhase()
      console.debug('[Turn] Queue drained')
      const cbs = drainedHandlers
      drainedHandlers = []
      cbs.forEach(cb => cb())
      return
    }

    // Finalize previous lifecycle if one exists (shouldn't normally happen)
    if (lifecycle) {
      lifecycle.interrupted = true
      logLifecycle(lifecycle)
    }

    const turn = queue.value.shift()!
    activeTurn.value = turn
    lifecycle = createLifecycle(turn)

    // Sync visual phase to match this turn's phase (e.g., morning → midday transition)
    if (turn.phase) {
      const experimentStore = useExperimentStore()
      if (experimentStore.currentPhase !== turn.phase) {
        experimentStore.applyPhase(turn.phase as RoundPhase)
      }
    }

    // Activate meeting scene when we reach the first meeting turn.
    // SPEECH_ONLY_ACTIONS includes both meeting_speech and meeting_vote,
    // so activation triggers regardless of which arrives first in the queue.
    if (SPEECH_ONLY_ACTIONS.has(turn.actionType)) {
      const socialStore = useSocialStore()
      if (socialStore.meeting && !socialStore.isMeetingActive) {
        socialStore.activateMeeting()
      }
    }

    console.debug(
      `[Turn #${turn.id}] Processing: ${turn.agentName} → ${turn.actionType} | Queue: ${queueSummary(queue.value)}`,
    )

    // Update HUD
    uiStore.setSteppingStatus(
      locale.hud.steppingAgent
        .replace('{name}', turn.agentName)
        .replace('{action}', turn.actionType),
    )

    if (turn.thought) {
      startThoughtPhase()
      return
    }

    startMovementPhase()
  }

  function startThoughtPhase() {
    const turn = activeTurn.value
    if (!turn || !turn.thought) return

    if (thoughtTimer) {
      clearTimeout(thoughtTimer)
      thoughtTimer = null
    }

    if (lifecycle) lifecycle.thoughtStartMs = performance.now()

    phase.value = 'thinking'
    handlers?.updateAgent(turn.agentId, 'thinking')
    if (!turn.fromSpeakEvent) {
      const conversation = handlers?.addConversation(
        turn.agentId,
        turn.agentName,
        turn.thought,
        turn.thoughtSource ?? 'inner_thought',
        turn.round,
      )
      if (conversation) {
        turn.thoughtConversationId = conversation.id
        turn.thoughtAudioIndex = conversation.index
        if (lifecycle) lifecycle.audioStatus = 'conversation-created'
      } else {
        if (lifecycle) lifecycle.audioStatus = 'no-conversation-ref'
      }
    } else {
      if (lifecycle) {
        lifecycle.audioStatus = turn.thoughtConversationId != null
          ? `from-speak-event(id:${turn.thoughtConversationId})`
          : 'from-speak-event(no-match)'
      }
    }

    console.debug(
      `[Turn #${turn.id}] Thought phase: ${turn.agentName} | fromSpeakEvent: ${turn.fromSpeakEvent} | convId: ${turn.thoughtConversationId ?? 'none'} | audioIdx: ${turn.thoughtAudioIndex ?? 'none'}`,
    )
    thoughtTimer = setTimeout(() => {
      if (lifecycle) lifecycle.thoughtDismissReason = 'audio-timeout'
      completeThoughtPhase(turn.id)
    }, AUDIO_MAX_TIMEOUT_MS)
  }

  function completeThoughtPhase(turnId?: number) {
    const turn = activeTurn.value
    if (!turn) return
    if (phase.value !== 'thinking') return
    if (turnId != null && turn.id !== turnId) return

    if (thoughtTimer) {
      clearTimeout(thoughtTimer)
      thoughtTimer = null
    }

    if (lifecycle) {
      lifecycle.thoughtEndMs = performance.now()
      if (!lifecycle.thoughtDismissReason) {
        lifecycle.thoughtDismissReason = 'unknown'
        console.warn(`[Turn #${turn.id}] Thought completed with no dismiss reason — check callers of completeThoughtPhase`)
      }
    }

    startMovementPhase()
  }

  function startMovementPhase() {
    const turn = activeTurn.value
    if (!turn) return

    if (lifecycle) lifecycle.moveStartMs = performance.now()

    handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType))

    // Speech-only actions (meeting_speech, meeting_vote) skip movement and acting
    if (SPEECH_ONLY_ACTIONS.has(turn.actionType)) {
      if (lifecycle) {
        lifecycle.moveEndMs = performance.now()
        lifecycle.moveSkipReason = 'speech-only'
        lifecycle.actionSkipReason = 'speech-only'
      }
      completeTurnPhase()
      return
    }

    const currentLocation = handlers?.getAgentLocation(turn.agentId)
    const needsMove = !!turn.targetLocation && turn.targetLocation !== currentLocation

    if (needsMove && handlers) {
      const turnId = turn.id
      phase.value = 'moving'
      console.debug(`[Turn #${turn.id}] Moving: ${currentLocation} → ${turn.targetLocation}`)
      handlers.move(turn.agentId, turn.targetLocation!, () => {
        handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType), turn.targetLocation)
        if (activeTurn.value?.id !== turnId) return
        if (lifecycle) lifecycle.moveEndMs = performance.now()
        startActionPhase()
      })
      return
    }

    if (lifecycle) {
      lifecycle.moveEndMs = performance.now()
      lifecycle.moveSkipReason = !turn.targetLocation
        ? 'no-target'
        : `already-at-${turn.targetLocation}`
    }

    if (turn.targetLocation) {
      handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType), turn.targetLocation)
    }
    startActionPhase()
  }

  function startActionPhase() {
    const turn = activeTurn.value
    if (!turn) return

    if (lifecycle) lifecycle.actionStartMs = performance.now()

    const animation = ACTION_TO_ANIMATION[turn.actionType]
    if (!animation || SKIP_ACTION_PHASE.has(turn.actionType)) {
      if (lifecycle) {
        lifecycle.actionEndMs = performance.now()
        lifecycle.actionSkipReason = !animation ? `no-anim(${turn.actionType})` : `skip-phase(${turn.actionType})`
      }
      completeTurnPhase()
      return
    }

    const turnId = turn.id

    phase.value = 'acting'

    // Dual gate: both animation and minimum duration must complete
    let animDone = false
    let floorDone = false

    const proceed = () => {
      if (animDone && floorDone) {
        if (activeTurn.value?.id !== turnId) return
        if (lifecycle) lifecycle.actionEndMs = performance.now()
        completeTurnPhase()
      }
    }

    if (handlers) {
      handlers.playAction(turn.agentId, animation, () => {
        if (activeTurn.value?.id !== turnId) return
        animDone = true
        proceed()
      })
    } else {
      animDone = true
    }

    actionFloorTimer = setTimeout(() => {
      floorDone = true
      proceed()
    }, MIN_ACTION_DURATION_MS)
  }

  function completeTurnPhase() {
    const turn = activeTurn.value
    if (!turn) return

    if (turn.thought) {
      finishTurn()
      return
    }

    phase.value = 'hud-only'
    hudTimer = setTimeout(() => finishTurn(), HUD_ONLY_DURATION_MS)
  }

  /**
   * Called by SimulationView when ConversationBubble emits 'audioEnd'.
   * Advances the matching thought phase once audio playback completes.
   */
  function notifyAudioComplete(turnId?: number) {
    if (lifecycle && !lifecycle.thoughtDismissReason) lifecycle.thoughtDismissReason = 'audio-complete'
    completeThoughtPhase(turnId)
  }

  /**
   * Called by SimulationView when ConversationBubble emits 'dismiss' (text-only fade).
   */
  function onBubbleDismissed(turnId?: number) {
    if (lifecycle && !lifecycle.thoughtDismissReason) lifecycle.thoughtDismissReason = 'bubble-dismissed'
    completeThoughtPhase(turnId)
  }

  function finishTurn() {
    if (activeTurn.value) {
      handlers?.updateAgent(activeTurn.value.agentId, 'idle')
    }
    // Log the completed lifecycle
    if (lifecycle) {
      logLifecycle(lifecycle)
      lifecycle = null
    }
    scheduleNext()
  }

  /**
   * Block/unblock the turn queue. Blocking takes effect at the next turn
   * boundary — it will NOT interrupt an active turn mid-thought or mid-action.
   * This prevents narration overlays from killing an in-progress bubble.
   */
  function setBlocked(value: boolean) {
    const wasBlocked = blocked.value
    blocked.value = value
    if (value && activeTurn.value) {
      console.debug(
        `[Turn] Block requested mid-turn #${activeTurn.value.id} (${activeTurn.value.agentName} → ${activeTurn.value.actionType}) — will take effect after turn completes`,
      )
      // Don't interrupt — the block will be checked in scheduleNext/processNext
      return
    }
    if (wasBlocked && !value) {
      console.debug(`[Turn] Unblocked | Queue: ${queueSummary(queue.value)}`)
    }
    if (!value && !activeTurn.value && queue.value.length > 0) {
      processNext()
    }
  }

  function clearTimers() {
    if (hudTimer) {
      clearTimeout(hudTimer)
      hudTimer = null
    }
    if (actionFloorTimer) {
      clearTimeout(actionFloorTimer)
      actionFloorTimer = null
    }
    if (thoughtTimer) {
      clearTimeout(thoughtTimer)
      thoughtTimer = null
    }
    if (turnGapTimer) {
      clearTimeout(turnGapTimer)
      turnGapTimer = null
    }
  }

  function $reset() {
    if (lifecycle) {
      lifecycle.interrupted = true
      logLifecycle(lifecycle)
      lifecycle = null
    }
    clearTimers()
    queue.value = []
    activeTurn.value = null
    phase.value = 'idle'
    blocked.value = false
    turnCounter = 0
    handlers = null
    drainedHandlers = []
  }

  return {
    queue, activeTurn, phase, isProcessing, hasPendingTurns,
    setHandlers, onDrained,
    enqueue, processNext, onBubbleDismissed, notifyAudioComplete, setBlocked,
    $reset,
  }
})

function actionToStatus(action: string): AgentStatus {
  switch (action) {
    case 'talk': case 'trade': case 'accuse': return 'talking'
    case 'meeting_speech': case 'meeting_vote': return 'talking'
    case 'move': case 'explore': return 'moving'
    case 'gather': case 'repair': return 'working'
    case 'hoard': case 'sabotage': return 'sneaking'
    default: return 'idle'
  }
}
