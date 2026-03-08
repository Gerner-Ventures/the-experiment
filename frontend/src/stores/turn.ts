import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUIStore } from '@/stores/ui'
import { useLocale } from '@/locales'
import { ACTION_TO_ANIMATION } from '@/types/sprite'
import type { AgentStatus } from '@/types/agent'

export interface Turn {
  id: number
  agentId: string
  agentName: string
  actionType: string
  targetAgentId?: string
  targetLocation?: string
  thought?: string
}

export type TurnPhase = 'idle' | 'moving' | 'acting' | 'talking' | 'hud-only'

export interface TurnHandlers {
  move: (agentId: string, location: string, onComplete: () => void) => void
  playAction: (agentId: string, animationName: string, onComplete: () => void) => void
  updateAgent: (agentId: string, status: AgentStatus, location?: string) => void
  addConversation: (agentId: string, agentName: string, message: string) => void
  getAgentLocation: (agentId: string) => string | undefined
}

/** Actions that skip the acting phase (animation redundant with idle/movement) */
const SKIP_ACTION_PHASE = new Set(['move', 'rest', 'observe', 'explore'])

/** Minimum time the acting phase is visible, even if the animation is shorter */
const MIN_ACTION_DURATION_MS = 800

const HUD_ONLY_DURATION_MS = 1500

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

  // External handlers — set by SimulationView to bridge PixiJS and Vue layers
  let handlers: TurnHandlers | null = null
  let drainedHandler: (() => void) | null = null

  function setHandlers(h: TurnHandlers) {
    handlers = h
  }

  /** Set a one-shot callback fired when the queue fully drains */
  function onDrained(cb: () => void) {
    drainedHandler = cb
  }

  function enqueue(turn: Omit<Turn, 'id'>) {
    const t: Turn = { ...turn, id: ++turnCounter }
    queue.value.push(t)

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
      const cb = drainedHandler
      drainedHandler = null
      cb?.()
      return
    }

    const turn = queue.value.shift()!
    activeTurn.value = turn

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
      handlers.move(turn.agentId, turn.targetLocation!, () => {
        handlers?.updateAgent(turn.agentId, actionToStatus(turn.actionType), turn.targetLocation)
        startActionPhase()
      })
    } else {
      if (turn.targetLocation) {
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
      handlers?.addConversation(turn.agentId, turn.agentName, turn.thought)
      // ConversationBubble renders because activeTurn has a thought.
      // It emits 'dismiss' → SimulationView calls onBubbleDismissed()
    } else {
      // HUD-only: show status briefly then advance
      phase.value = 'hud-only'
      hudTimer = setTimeout(() => processNext(), HUD_ONLY_DURATION_MS)
    }
  }

  function onBubbleDismissed() {
    // Reset agent to idle
    if (activeTurn.value) {
      handlers?.updateAgent(activeTurn.value.agentId, 'idle')
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
  }

  function $reset() {
    clearTimers()
    queue.value = []
    activeTurn.value = null
    phase.value = 'idle'
    turnCounter = 0
    drainedHandler = null
  }

  return {
    queue, activeTurn, phase, isProcessing, hasPendingTurns,
    setHandlers, onDrained,
    enqueue, processNext, onBubbleDismissed,
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
