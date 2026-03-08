import { setActivePinia, createPinia } from 'pinia'
import { useTurnStore, type TurnHandlers } from '@/stores/turn'
import { useUIStore } from '@/stores/ui'

// Mock the locale module so the turn store can call useLocale()
jest.mock('@/locales', () => ({
  useLocale: () => ({
    hud: {
      steppingAgent: '{name}: {action}',
    },
  }),
}))

function makeTurn(overrides: Partial<{ agentId: string; agentName: string; actionType: string; targetLocation: string; thought: string }> = {}) {
  return {
    agentId: overrides.agentId ?? 'agent-1',
    agentName: overrides.agentName ?? 'Alice',
    actionType: overrides.actionType ?? 'talk',
    targetLocation: overrides.targetLocation,
    thought: overrides.thought,
  }
}

function makeMockHandlers(overrides: Partial<TurnHandlers> = {}): TurnHandlers {
  return {
    move: overrides.move ?? jest.fn((_id, _loc, onComplete) => onComplete()),
    playAction: overrides.playAction ?? jest.fn((_id, _anim, onComplete) => onComplete()),
    updateAgent: overrides.updateAgent ?? jest.fn(),
    addConversation: overrides.addConversation ?? jest.fn(),
    getAgentLocation: overrides.getAgentLocation ?? jest.fn(() => undefined),
  }
}

/** Advance past the MIN_ACTION_DURATION_MS (1500ms) floor timer so
 *  the acting phase dual gate completes and advances to speech. */
function advancePastActionFloor() {
  jest.advanceTimersByTime(1500)
}

describe('turn store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('enqueue and processNext', () => {
    it('auto-processes the first enqueued turn', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      // HUD-only turn (no thought) — should become activeTurn immediately
      store.enqueue(makeTurn({ actionType: 'gather' }))

      expect(store.activeTurn).not.toBeNull()
      expect(store.activeTurn!.actionType).toBe('gather')
    })

    it('queues subsequent turns without processing them', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      // First turn (talking) — auto-processed
      store.enqueue(makeTurn({ thought: 'hello', agentId: 'a1' }))
      advancePastActionFloor()
      // Second turn — stays in queue
      store.enqueue(makeTurn({ thought: 'world', agentId: 'a2' }))

      expect(store.activeTurn!.agentId).toBe('a1')
      expect(store.queue).toHaveLength(1)
    })

    it('goes idle when queue is empty after processing', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      store.enqueue(makeTurn({ thought: 'only one' }))
      advancePastActionFloor()
      store.onBubbleDismissed()

      expect(store.phase).toBe('idle')
      expect(store.activeTurn).toBeNull()
    })
  })

  describe('phase transitions', () => {
    it('enters moving phase when agent needs to move', () => {
      const store = useTurnStore()
      // Agent is at location "camp", turn wants them at "forest"
      let moveCallback: (() => void) | null = null
      const handlers = makeMockHandlers({
        getAgentLocation: jest.fn(() => 'camp'),
        move: jest.fn((_id, _loc, onComplete) => { moveCallback = onComplete }),
      })
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ targetLocation: 'forest', thought: 'heading out' }))

      expect(store.phase).toBe('moving')
      expect(handlers.move).toHaveBeenCalledWith('agent-1', 'forest', expect.any(Function))

      // Complete the move — enters acting phase
      moveCallback!()
      expect(store.phase).toBe('acting')

      // Advance past action floor — enters talking
      advancePastActionFloor()
      expect(store.phase).toBe('talking')
    })

    it('enters talking phase when turn has a thought (no move needed)', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers({
        getAgentLocation: jest.fn(() => 'camp'),
      }))

      store.enqueue(makeTurn({ targetLocation: 'camp', thought: 'I feel safe here' }))

      // Enters acting phase first (talk has animation), then talking after floor timer
      expect(store.phase).toBe('acting')
      advancePastActionFloor()
      expect(store.phase).toBe('talking')
    })

    it('enters hud-only phase when turn has no thought', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      store.enqueue(makeTurn({ actionType: 'gather' }))

      // 'gather' has an animation, so enters acting first
      expect(store.phase).toBe('acting')
      advancePastActionFloor()
      expect(store.phase).toBe('hud-only')
    })

    it('hud-only auto-advances after timeout', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      store.enqueue(makeTurn({ actionType: 'gather', agentId: 'a1' }))
      advancePastActionFloor()
      expect(store.phase).toBe('hud-only')

      jest.advanceTimersByTime(1500)

      // After timeout, should go idle (queue empty)
      expect(store.phase).toBe('idle')
      expect(store.activeTurn).toBeNull()
    })

    it('hud-only advances to next queued turn after timeout', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      // Two hud-only turns (explore skips action phase)
      store.enqueue(makeTurn({ actionType: 'explore', agentId: 'a1' }))
      store.enqueue(makeTurn({ actionType: 'explore', agentId: 'a2' }))

      expect(store.activeTurn!.agentId).toBe('a1')

      jest.advanceTimersByTime(1500)

      expect(store.activeTurn!.agentId).toBe('a2')
      expect(store.phase).toBe('hud-only')
    })

    it('skips acting phase for actions in SKIP_ACTION_PHASE', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      // 'move' is in SKIP_ACTION_PHASE, so acting is skipped
      store.enqueue(makeTurn({ actionType: 'move', thought: 'walking around' }))

      expect(store.phase).toBe('talking')
    })
  })

  describe('onBubbleDismissed', () => {
    it('advances to next turn when bubble is dismissed', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ thought: 'first', agentId: 'a1' }))
      store.enqueue(makeTurn({ thought: 'second', agentId: 'a2' }))

      advancePastActionFloor()
      expect(store.activeTurn!.agentId).toBe('a1')
      expect(store.phase).toBe('talking')

      store.onBubbleDismissed()

      advancePastActionFloor()
      expect(store.activeTurn!.agentId).toBe('a2')
      expect(store.phase).toBe('talking')
    })

    it('resets agent to idle on dismiss', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ thought: 'hello', agentId: 'a1' }))
      advancePastActionFloor()
      store.onBubbleDismissed()

      expect(handlers.updateAgent).toHaveBeenCalledWith('a1', 'idle')
    })

    it('goes to idle when last bubble is dismissed', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      store.enqueue(makeTurn({ thought: 'only one' }))
      advancePastActionFloor()
      expect(store.phase).toBe('talking')

      store.onBubbleDismissed()

      expect(store.phase).toBe('idle')
      expect(store.activeTurn).toBeNull()
      expect(store.isProcessing).toBe(false)
    })
  })

  describe('onDrained callback', () => {
    it('fires when queue fully drains', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())
      const drainedFn = jest.fn()
      store.onDrained(drainedFn)

      store.enqueue(makeTurn({ actionType: 'gather' }))
      // acting phase floor + hud-only timeout
      advancePastActionFloor()
      jest.advanceTimersByTime(1500)

      expect(drainedFn).toHaveBeenCalledTimes(1)
    })

    it('is one-shot — does not fire again on subsequent drains', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())
      const drainedFn = jest.fn()
      store.onDrained(drainedFn)

      store.enqueue(makeTurn({ actionType: 'gather' }))
      advancePastActionFloor()
      jest.advanceTimersByTime(1500)
      expect(drainedFn).toHaveBeenCalledTimes(1)

      // Enqueue another turn — should NOT fire again
      store.enqueue(makeTurn({ actionType: 'repair' }))
      advancePastActionFloor()
      jest.advanceTimersByTime(1500)
      expect(drainedFn).toHaveBeenCalledTimes(1)
    })

    it('does not fire when queue is not yet empty', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())
      const drainedFn = jest.fn()
      store.onDrained(drainedFn)

      // Talking turns need manual dismiss
      store.enqueue(makeTurn({ thought: 'a', agentId: 'a1' }))
      store.enqueue(makeTurn({ thought: 'b', agentId: 'a2' }))

      advancePastActionFloor()

      // Dismiss first — still one left
      store.onBubbleDismissed()
      expect(drainedFn).not.toHaveBeenCalled()

      advancePastActionFloor()

      // Dismiss second — now drained
      store.onBubbleDismissed()
      expect(drainedFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('HUD status updates', () => {
    it('sets UI store stepping status on each turn', () => {
      const store = useTurnStore()
      const uiStore = useUIStore()
      store.setHandlers(makeMockHandlers())

      store.enqueue(makeTurn({ agentName: 'Bob', actionType: 'explore' }))

      expect(uiStore.steppingStatus).toBe('Bob: explore')
    })
  })

  describe('agent status mapping', () => {
    it('maps talk actions to talking status', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'talk' }))
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'talking')
    })

    it('maps move actions to moving status', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'move' }))
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'moving')
    })

    it('maps gather actions to working status', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'gather' }))
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'working')
    })

    it('maps hoard actions to sneaking status', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'hoard' }))
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'sneaking')
    })

    it('maps unknown actions to idle status', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'unknown_action' }))
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'idle')
    })
  })

  describe('$reset', () => {
    it('clears all state', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())

      store.enqueue(makeTurn({ thought: 'hello', agentId: 'a1' }))
      store.enqueue(makeTurn({ agentId: 'a2' }))
      store.onDrained(jest.fn())

      expect(store.activeTurn).not.toBeNull()
      expect(store.queue.length).toBeGreaterThan(0)

      store.$reset()

      expect(store.queue).toHaveLength(0)
      expect(store.activeTurn).toBeNull()
      expect(store.phase).toBe('idle')
      expect(store.isProcessing).toBe(false)
      expect(store.hasPendingTurns).toBe(false)
    })

    it('clears pending hud timer', () => {
      const store = useTurnStore()
      store.setHandlers(makeMockHandlers())
      const drainedFn = jest.fn()

      // 'explore' skips action phase, goes straight to hud-only
      store.enqueue(makeTurn({ actionType: 'explore' }))
      store.onDrained(drainedFn)

      // Reset before timeout fires
      store.$reset()
      jest.advanceTimersByTime(2000)

      // drainedHandler was cleared by $reset, so it should not fire from the timer
      expect(drainedFn).not.toHaveBeenCalled()
    })
  })

  describe('movement integration', () => {
    it('skips move when no targetLocation', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      // 'move' is in SKIP_ACTION_PHASE, so goes directly to talking
      store.enqueue(makeTurn({ actionType: 'move', thought: 'just talking' }))

      expect(handlers.move).not.toHaveBeenCalled()
      expect(store.phase).toBe('talking')
    })

    it('skips move when agent is already at target location', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers({
        getAgentLocation: jest.fn(() => 'camp'),
      })
      store.setHandlers(handlers)

      // 'move' is in SKIP_ACTION_PHASE
      store.enqueue(makeTurn({ actionType: 'move', targetLocation: 'camp', thought: 'still here' }))

      expect(handlers.move).not.toHaveBeenCalled()
      expect(store.phase).toBe('talking')
    })

    it('updates agent location after move completes', () => {
      const store = useTurnStore()
      let moveCallback: (() => void) | null = null
      const handlers = makeMockHandlers({
        getAgentLocation: jest.fn(() => 'camp'),
        move: jest.fn((_id, _loc, onComplete) => { moveCallback = onComplete }),
      })
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ targetLocation: 'forest', thought: 'going', agentId: 'a1' }))
      expect(store.phase).toBe('moving')

      moveCallback!()

      // After move completes, updateAgent should be called with new location
      expect(handlers.updateAgent).toHaveBeenCalledWith('a1', 'talking', 'forest')
    })

    it('adds conversation when thought is present', () => {
      const store = useTurnStore()
      const handlers = makeMockHandlers()
      store.setHandlers(handlers)

      // 'move' skips action phase, goes directly to speech
      store.enqueue(makeTurn({ actionType: 'move', thought: 'I see things', agentName: 'Eve' }))

      expect(handlers.addConversation).toHaveBeenCalledWith('agent-1', 'Eve', 'I see things')
    })
  })
})
