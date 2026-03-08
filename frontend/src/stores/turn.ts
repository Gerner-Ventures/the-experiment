import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUIStore } from '@/stores/ui'
import { useLocale } from '@/locales'
import { HD_ACTION_TO_ANIMATION as ACTION_TO_ANIMATION } from '@/config/sprites/hd/animations'
import { SKIP_ACTION_PHASE } from '@/config/action-categories'
import type { AgentStatus } from '@/types/agent'

export interface Turn {
  id: number
  agentId: string
  agentName: string
  actionType: string
  targetAgentId?: string
  targetLocation?: string
  thought?: string
  /** When true, the conversation row was already added by agent_speak — skip addConversation */
  fromSpeakEvent?: boolean
}

export type TurnPhase = 'idle' | 'moving' | 'acting' | 'talking' | 'hud-only'

export interface TurnHandlers {
  move: (agentId: string, location: string, onComplete: () => void) => void
  playAction: (agentId: string, animationName: string, onComplete: () => void) => void
  updateAgent: (agentId: string, status: AgentStatus, location?: string) => void
  addConversation: (agentId: string, agentName: string, message: string) => void
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
  let speechAudioTimer: ReturnType<typeof setTimeout> | null = null

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

    // Update agent status
    handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType))

    // Step 1: Move if the agent's target location differs from their current location
    const currentLocation = handlers?.getAgentLocation(turn.agentId)
    const needsMove = turn.targetLocation && turn.targetLocation !== currentLocation

    if (needsMove && handlers) {
      phase.value = 'moving'
      console.debug(`[Turn] Moving ${turn.agentName}: ${currentLocation} → ${turn.targetLocation}`)
      handlers.move(turn.agentId, turn.targetLocation!, () => {
        // Movement complete — update agent location, proceed to action phase
        handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType), turn.targetLocation)
        startActionPhase()
      })
    } else {
      if (turn.targetLocation) {
        console.debug(`[Turn] ${turn.agentName} already at ${turn.targetLocation}`)
        handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType), turn.targetLocation)
      }
      startActionPhase()
    }
  }

  function startActionPhase() {
    const turn = activeTurn.value
    if (!turn) return

    const animation = ACTION_TO_ANIMATION[turn.actionType]
    if (!animation || SKIP_ACTION_PHASE.has(turn.actionType)) {
      startSpeechPhase()
      return
    }

    phase.value = 'acting'

    // Dual gate: both animation and minimum duration must complete
    let animDone = false
    let floorDone = false

    const proceed = () => {
      if (animDone && floorDone) {
        startSpeechPhase()
      }
    }

    if (handlers) {
      handlers.playAction(turn.agentId, animation, () => {
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

  function startSpeechPhase() {
    const turn = activeTurn.value
    if (!turn) return

    if (turn.thought) {
      phase.value = 'talking'
      // Add to conversation log — skip if already added via agent_speak WS event
      if (!turn.fromSpeakEvent) {
        handlers?.addConversation(turn.agentId, turn.agentName, turn.thought)
      }
      console.debug(`[Turn] Showing bubble: ${turn.agentName}`)
      // ConversationBubble will render because activeTurn has a thought.
      // It emits 'dismiss' → SimulationView calls onBubbleDismissed()
      // It emits 'audioEnd' → SimulationView calls notifyAudioComplete()
      // Safety: max timeout prevents indefinite blocking if audio never completes
      speechAudioTimer = setTimeout(() => {
        speechAudioTimer = null
        onBubbleDismissed()
      }, AUDIO_MAX_TIMEOUT_MS)
    } else {
      // HUD-only: show status briefly then advance
      phase.value = 'hud-only'
      console.debug(`[Turn] HUD-only: ${turn.agentName} → ${turn.actionType}`)
      hudTimer = setTimeout(() => processNext(), HUD_ONLY_DURATION_MS)
    }
  }

  /**
   * Called by SimulationView when ConversationBubble emits 'audioEnd'.
   * Clears audio timers and triggers bubble dismissal.
   */
  function notifyAudioComplete() {
    if (speechAudioTimer) {
      clearTimeout(speechAudioTimer)
      speechAudioTimer = null
    }
    onBubbleDismissed()
  }

  /**
   * Called by SimulationView when ConversationBubble emits 'dismiss' (text-only fade).
   * Also called internally by notifyAudioComplete for audio-gated flow.
   */
  function onBubbleDismissed() {
    console.debug(`[Turn] Bubble dismissed, advancing`)
    // Reset agent to idle
    if (activeTurn.value) {
      handlers?.updateAgent(activeTurn.value.agentId, 'idle')
    }
    if (speechAudioTimer) {
      clearTimeout(speechAudioTimer)
      speechAudioTimer = null
    }
    processNext()
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
    if (speechAudioTimer) {
      clearTimeout(speechAudioTimer)
      speechAudioTimer = null
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
    case 'move': case 'explore': return 'moving'
    case 'gather': case 'repair': return 'working'
    case 'hoard': case 'sabotage': return 'sneaking'
    default: return 'idle'
  }
}
