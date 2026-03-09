import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUIStore } from '@/stores/ui'
import { useLocale } from '@/locales'
import { HD_ACTION_TO_ANIMATION as ACTION_TO_ANIMATION } from '@/config/sprites/hd/animations'
import { SKIP_ACTION_PHASE, SPEECH_ONLY_ACTIONS } from '@/config/action-categories'
import type { AgentStatus } from '@/types/agent'
import type { AgentSpeechSource } from '@/types/websocket'

export interface Turn {
  id: number
  agentId: string
  agentName: string
  round: number
  actionType: string
  targetAgentId?: string
  targetLocation?: string
  thought?: string
  thoughtSource?: AgentSpeechSource
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
  ) => void
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

export const useTurnStore = defineStore('turn', () => {
  const locale = useLocale()
  const queue = ref<Turn[]>([])
  const activeTurn = ref<Turn | null>(null)
  const phase = ref<TurnPhase>('idle')
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
    console.debug(`[Turn] Enqueued: ${turn.agentName} → ${turn.actionType} (queue: ${queue.value.length})`)

    // If nothing is active, start processing
    if (!activeTurn.value) {
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

    if (queue.value.length === 0) {
      activeTurn.value = null
      phase.value = 'idle'
      console.debug('[Turn] Queue drained')
      const cbs = drainedHandlers
      drainedHandlers = []
      cbs.forEach(cb => cb())
      return
    }

    const turn = queue.value.shift()!
    activeTurn.value = turn
    console.debug(`[Turn] Processing: ${turn.agentName} → ${turn.actionType} (remaining: ${queue.value.length})`)

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

    phase.value = 'thinking'
    handlers?.updateAgent(turn.agentId, 'thinking')
    if (!turn.fromSpeakEvent) {
      handlers?.addConversation(
        turn.agentId,
        turn.agentName,
        turn.thought,
        turn.thoughtSource ?? 'inner_thought',
        turn.round,
      )
    }
    console.debug(`[Turn] Thinking: ${turn.agentName}`)
    thoughtTimer = setTimeout(() => {
      completeThoughtPhase(turn.id)
    }, AUDIO_MAX_TIMEOUT_MS)
  }

  function completeThoughtPhase(turnId?: number) {
    const turn = activeTurn.value
    if (!turn) {
      console.debug('[Turn] Ignoring thought completion with no active turn')
      return
    }
    if (phase.value !== 'thinking') {
      console.debug(`[Turn] Ignoring thought completion outside thinking phase: ${phase.value}`)
      return
    }
    if (turnId != null && turn.id !== turnId) {
      console.debug(`[Turn] Ignoring stale thought completion for turn ${turnId}; active is ${turn.id}`)
      return
    }

    if (thoughtTimer) {
      clearTimeout(thoughtTimer)
      thoughtTimer = null
    }

    startMovementPhase()
  }

  function startMovementPhase() {
    const turn = activeTurn.value
    if (!turn) return

    handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType))

    // Speech-only actions (meeting_speech, meeting_vote) skip movement and acting
    if (SPEECH_ONLY_ACTIONS.has(turn.actionType)) {
      console.debug(`[Turn] Speech-only: ${turn.agentName} → ${turn.actionType}`)
      completeTurnPhase()
      return
    }

    const currentLocation = handlers?.getAgentLocation(turn.agentId)
    const needsMove = !!turn.targetLocation && turn.targetLocation !== currentLocation

    if (needsMove && handlers) {
      const turnId = turn.id
      phase.value = 'moving'
      console.debug(`[Turn] Moving ${turn.agentName}: ${currentLocation} → ${turn.targetLocation}`)
      handlers.move(turn.agentId, turn.targetLocation!, () => {
        handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType), turn.targetLocation)
        if (activeTurn.value?.id !== turnId) {
          console.debug(`[Turn] Ignoring stale movement completion for turn ${turnId}`)
          return
        }
        startActionPhase()
      })
      return
    }

    if (turn.targetLocation) {
      console.debug(`[Turn] ${turn.agentName} already at ${turn.targetLocation}`)
      handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType), turn.targetLocation)
    }
    startActionPhase()
  }

  function startActionPhase() {
    const turn = activeTurn.value
    if (!turn) return

    const animation = ACTION_TO_ANIMATION[turn.actionType]
    if (!animation || SKIP_ACTION_PHASE.has(turn.actionType)) {
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
        if (activeTurn.value?.id !== turnId) {
          console.debug(`[Turn] Ignoring stale action completion for turn ${turnId}`)
          return
        }
        completeTurnPhase()
      }
    }

    if (handlers) {
      handlers.playAction(turn.agentId, animation, () => {
        if (activeTurn.value?.id !== turnId) {
          console.debug(`[Turn] Ignoring stale action callback for turn ${turnId}`)
          return
        }
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
    console.debug(`[Turn] HUD-only: ${turn.agentName} → ${turn.actionType}`)
    hudTimer = setTimeout(() => finishTurn(), HUD_ONLY_DURATION_MS)
  }

  /**
   * Called by SimulationView when ConversationBubble emits 'audioEnd'.
   * Advances the matching thought phase once audio playback completes.
   */
  function notifyAudioComplete(turnId?: number) {
    completeThoughtPhase(turnId)
  }

  /**
   * Called by SimulationView when ConversationBubble emits 'dismiss' (text-only fade).
   */
  function onBubbleDismissed(turnId?: number) {
    console.debug('[Turn] Thought dismissed, continuing action')
    completeThoughtPhase(turnId)
  }

  function finishTurn() {
    if (activeTurn.value) {
      handlers?.updateAgent(activeTurn.value.agentId, 'idle')
    }
    scheduleNext()
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
    clearTimers()
    queue.value = []
    activeTurn.value = null
    phase.value = 'idle'
    turnCounter = 0
    handlers = null
    drainedHandlers = []
  }

  return {
    queue, activeTurn, phase, isProcessing, hasPendingTurns,
    setHandlers, onDrained,
    enqueue, processNext, onBubbleDismissed, notifyAudioComplete,
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
