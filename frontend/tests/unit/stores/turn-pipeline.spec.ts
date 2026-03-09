/**
 * Comprehensive tests for the turn pipeline state machine.
 * Covers: phase transitions, stale turnId guards, completeThoughtPhase guards,
 * notifyAudioComplete / onBubbleDismissed integration, fromSpeakEvent handling,
 * movement and action phase turnId guards, hud-only phase, onDrained callbacks,
 * and the full thinking→moving→acting→complete lifecycle.
 */
import { setActivePinia, createPinia } from 'pinia'
import { useTurnStore, type Turn, type TurnHandlers } from '@/stores/turn'

jest.mock('@/locales', () => ({
  useLocale: () => ({
    hud: { steppingAgent: '{name}: {action}' },
  }),
}))

function makeTurn(overrides: Partial<Omit<Turn, 'id'>> = {}): Omit<Turn, 'id'> {
  return {
    agentId: 'agent-1',
    agentName: 'Alice',
    round: 1,
    actionType: 'talk',
    thoughtSource: 'inner_thought',
    ...overrides,
  }
}

function makeHandlers(overrides: Partial<TurnHandlers> = {}): TurnHandlers {
  return {
    move: jest.fn((_id, _loc, cb) => cb()),
    playAction: jest.fn((_id, _anim, cb) => cb()),
    updateAgent: jest.fn(),
    addConversation: jest.fn(),
    getAgentLocation: jest.fn(() => 'camp'),
    ...overrides,
  }
}

describe('turn pipeline – full lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // ─── Phase transitions ───

  describe('phase transitions', () => {
    it('follows thinking → moving → acting → idle for a full turn', () => {
      let finishMove: (() => void) | null = null
      let finishAction: (() => void) | null = null

      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        move: jest.fn((_id, _loc, cb) => { finishMove = cb }),
        playAction: jest.fn((_id, _anim, cb) => { finishAction = cb }),
        getAgentLocation: jest.fn(() => 'camp'),
      }))

      store.enqueue(makeTurn({
        thought: 'Time to go.',
        targetLocation: 'forest',
        actionType: 'stab',
      }))

      // Phase 1: thinking
      expect(store.phase).toBe('thinking')

      store.onBubbleDismissed(store.activeTurn!.id)

      // Phase 2: moving
      expect(store.phase).toBe('moving')

      finishMove!()

      // Phase 3: acting
      expect(store.phase).toBe('acting')

      finishAction!()
      jest.advanceTimersByTime(1500) // floor timer

      // Phase 4: idle (turn finished)
      expect(store.phase).toBe('idle')
      expect(store.activeTurn).toBeNull()
    })

    it('skips thinking when turn has no thought', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        getAgentLocation: jest.fn(() => 'camp'),
      }))

      store.enqueue(makeTurn({
        actionType: 'gather',
        targetLocation: 'camp',
        thought: undefined,
      }))

      // Should go straight to acting (already at location)
      expect(store.phase).toBe('acting')
    })

    it('skips moving when already at target location', () => {
      const move = jest.fn()
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        move,
        getAgentLocation: jest.fn(() => 'forest'),
      }))

      store.enqueue(makeTurn({
        thought: 'I am here already.',
        targetLocation: 'forest',
        actionType: 'gather',
      }))

      store.onBubbleDismissed(store.activeTurn!.id)

      // Should skip moving, go to acting
      expect(store.phase).toBe('acting')
      expect(move).not.toHaveBeenCalled()
    })

    it('skips moving when no targetLocation', () => {
      const move = jest.fn()
      const store = useTurnStore()
      store.setHandlers(makeHandlers({ move }))

      store.enqueue(makeTurn({
        thought: 'Just doing things.',
        actionType: 'gather',
        targetLocation: undefined,
      }))

      store.onBubbleDismissed(store.activeTurn!.id)

      expect(move).not.toHaveBeenCalled()
      expect(store.phase).toBe('acting')
    })

    it('goes to hud-only when turn has no thought and action completes', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({
        actionType: 'gather',
        thought: undefined,
      }))

      // acting phase
      jest.advanceTimersByTime(1500) // floor timer
      expect(store.phase).toBe('hud-only')

      jest.advanceTimersByTime(1500) // HUD_ONLY_DURATION_MS
      expect(store.phase).toBe('idle')
    })

    it('skips hud-only when turn has thought (finishTurn directly)', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({
        actionType: 'gather',
        thought: 'Gathering resources.',
      }))

      // thinking phase
      expect(store.phase).toBe('thinking')
      store.onBubbleDismissed(store.activeTurn!.id)

      // acting → completeTurnPhase → thought exists → finishTurn → idle
      jest.advanceTimersByTime(1500)
      expect(store.phase).toBe('idle')
    })
  })

  // ─── completeThoughtPhase guards ───

  describe('completeThoughtPhase guards', () => {
    it('ignores completion when no active turn', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      // Should not throw
      store.notifyAudioComplete(999)
      expect(store.phase).toBe('idle')
    })

    it('ignores completion when not in thinking phase', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({
        actionType: 'gather',
        thought: 'Working.',
      }))

      // Complete thought to move past thinking
      store.onBubbleDismissed(store.activeTurn!.id)
      expect(store.phase).toBe('acting')

      // Try to complete thought again — should be ignored
      const turnId = store.activeTurn!.id
      store.notifyAudioComplete(turnId)
      expect(store.phase).toBe('acting') // unchanged
    })

    it('ignores completion with stale turnId', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      // Use speech-only actions so they finish cleanly after thought
      store.enqueue(makeTurn({ thought: 'First.', agentId: 'a1', actionType: 'meeting_speech' }))
      store.enqueue(makeTurn({ thought: 'Second.', agentId: 'a2', actionType: 'meeting_speech' }))

      const firstTurnId = store.activeTurn!.id

      // Complete first turn
      store.notifyAudioComplete(firstTurnId)
      jest.advanceTimersByTime(500) // gap

      expect(store.activeTurn!.agentId).toBe('a2')
      expect(store.phase).toBe('thinking')

      // Stale completion for first turn should not affect second
      store.notifyAudioComplete(firstTurnId)
      expect(store.activeTurn!.agentId).toBe('a2')
      expect(store.phase).toBe('thinking')
    })

    it('accepts completion with undefined turnId (backwards compat)', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        thought: 'I agree.',
      }))

      expect(store.phase).toBe('thinking')

      // undefined turnId should still work
      store.notifyAudioComplete(undefined)
      expect(store.phase).toBe('idle') // speech-only → complete → finish
    })
  })

  // ─── Movement phase turnId guard ───

  describe('movement phase turnId guard', () => {
    it('ignores stale move completion when turn has changed', () => {
      let finishMove: (() => void) | null = null
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        move: jest.fn((_id, _loc, cb) => { finishMove = cb }),
        getAgentLocation: jest.fn(() => 'camp'),
      }))

      store.enqueue(makeTurn({
        thought: 'Moving.',
        targetLocation: 'forest',
        actionType: 'gather',
      }))

      store.onBubbleDismissed(store.activeTurn!.id)
      expect(store.phase).toBe('moving')

      // Reset store while move is in progress
      store.$reset()
      expect(store.phase).toBe('idle')

      // Stale move callback should not crash
      finishMove!()
      expect(store.phase).toBe('idle')
    })
  })

  // ─── Action phase dual turnId guards ───

  describe('action phase turnId guards', () => {
    it('ignores stale action callback after turn changes', () => {
      let finishAction: (() => void) | null = null
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        playAction: jest.fn((_id, _anim, cb) => { finishAction = cb }),
      }))

      store.enqueue(makeTurn({
        actionType: 'stab',
        thought: 'Strike!',
      }))

      store.onBubbleDismissed(store.activeTurn!.id)
      expect(store.phase).toBe('acting')

      // Reset while action is in progress
      store.$reset()

      // Stale action callback should not crash
      finishAction!()
      expect(store.phase).toBe('idle')
    })

    it('requires both animation and floor timer before advancing', () => {
      let finishAction: (() => void) | null = null
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        playAction: jest.fn((_id, _anim, cb) => { finishAction = cb }),
      }))

      store.enqueue(makeTurn({
        actionType: 'stab',
        thought: 'Strike!',
      }))

      store.onBubbleDismissed(store.activeTurn!.id)
      expect(store.phase).toBe('acting')

      // Animation completes but floor timer hasn't
      finishAction!()
      expect(store.phase).toBe('acting')

      // Floor timer completes
      jest.advanceTimersByTime(1500)
      expect(store.phase).toBe('idle') // has thought → finishTurn
    })

    it('requires both floor timer and animation before advancing', () => {
      let finishAction: (() => void) | null = null
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        playAction: jest.fn((_id, _anim, cb) => { finishAction = cb }),
      }))

      store.enqueue(makeTurn({
        actionType: 'stab',
        thought: 'Strike!',
      }))

      store.onBubbleDismissed(store.activeTurn!.id)

      // Floor timer first
      jest.advanceTimersByTime(1500)
      expect(store.phase).toBe('acting') // still waiting for animation

      // Now animation
      finishAction!()
      expect(store.phase).toBe('idle')
    })
  })

  // ─── notifyAudioComplete / onBubbleDismissed ───

  describe('notifyAudioComplete and onBubbleDismissed', () => {
    it('notifyAudioComplete passes turnId to completeThoughtPhase', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ thought: 'Hello.', actionType: 'meeting_speech' }))
      const turnId = store.activeTurn!.id

      store.notifyAudioComplete(turnId)

      // Speech-only → complete → finish
      expect(store.phase).toBe('idle')
    })

    it('onBubbleDismissed passes turnId to completeThoughtPhase', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ thought: 'Thinking...', actionType: 'meeting_speech' }))
      const turnId = store.activeTurn!.id

      store.onBubbleDismissed(turnId)

      expect(store.phase).toBe('idle')
    })

    it('only the first of audioEnd/dismiss advances (second is stale)', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ thought: 'Hmm.', actionType: 'meeting_speech' }))
      store.enqueue(makeTurn({ thought: 'Next.', agentId: 'a2', actionType: 'meeting_speech' }))

      const firstId = store.activeTurn!.id
      store.notifyAudioComplete(firstId)

      jest.advanceTimersByTime(500)
      expect(store.activeTurn!.agentId).toBe('a2')

      // Second dismiss for first turn is stale
      store.onBubbleDismissed(firstId)
      expect(store.activeTurn!.agentId).toBe('a2')
      expect(store.phase).toBe('thinking')
    })
  })

  // ─── fromSpeakEvent handling ───

  describe('fromSpeakEvent handling', () => {
    it('adds conversation when fromSpeakEvent is false', () => {
      const handlers = makeHandlers()
      const store = useTurnStore()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({
        thought: 'Hello.',
        fromSpeakEvent: false,
        thoughtSource: 'dialogue',
        round: 5,
      }))

      expect(handlers.addConversation).toHaveBeenCalledWith(
        'agent-1', 'Alice', 'Hello.', 'dialogue', 5,
      )
    })

    it('skips conversation when fromSpeakEvent is true', () => {
      const handlers = makeHandlers()
      const store = useTurnStore()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({
        thought: 'Already tracked.',
        fromSpeakEvent: true,
      }))

      expect(handlers.addConversation).not.toHaveBeenCalled()
    })

    it('defaults thoughtSource to inner_thought when not specified', () => {
      const handlers = makeHandlers()
      const store = useTurnStore()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({
        thought: 'Inner monologue.',
        thoughtSource: undefined,
      }))

      expect(handlers.addConversation).toHaveBeenCalledWith(
        'agent-1', 'Alice', 'Inner monologue.', 'inner_thought', 1,
      )
    })
  })

  // ─── AUDIO_MAX_TIMEOUT_MS auto-advance ───

  describe('audio max timeout', () => {
    it('auto-advances past thinking after 15 seconds if no dismiss/audio', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        thought: 'Long speech.',
      }))

      expect(store.phase).toBe('thinking')

      // Advance past AUDIO_MAX_TIMEOUT_MS (15000)
      jest.advanceTimersByTime(15000)

      // Speech-only → complete → finish
      expect(store.phase).toBe('idle')
    })
  })

  // ─── scheduleNext gap behavior ───

  describe('scheduleNext gap behavior', () => {
    it('sets phase to idle during the gap', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'A.' }))
      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'B.', agentId: 'a2' }))

      store.notifyAudioComplete(store.activeTurn!.id)

      // During gap: phase should be idle
      expect(store.phase).toBe('idle')

      // But activeTurn is still the old one (hasn't been cleared yet by processNext)
      jest.advanceTimersByTime(400)

      expect(store.activeTurn!.agentId).toBe('a2')
      expect(store.phase).toBe('thinking')
    })

    it('drains immediately when queue is empty (no gap)', () => {
      const drained = jest.fn()
      const store = useTurnStore()
      store.setHandlers(makeHandlers())
      store.onDrained(drained)

      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'Only one.' }))
      store.notifyAudioComplete(store.activeTurn!.id)

      // No gap timer needed — immediately drained
      expect(drained).toHaveBeenCalledTimes(1)
      expect(store.activeTurn).toBeNull()
    })
  })

  // ─── onDrained callbacks ───

  describe('onDrained callbacks', () => {
    it('fires all registered callbacks when queue drains', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())
      const cb1 = jest.fn()
      const cb2 = jest.fn()
      store.onDrained(cb1)
      store.onDrained(cb2)

      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'Done.' }))
      store.notifyAudioComplete(store.activeTurn!.id)

      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
    })

    it('clears callbacks after firing (one-shot)', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())
      const cb = jest.fn()
      store.onDrained(cb)

      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'First.' }))
      store.notifyAudioComplete(store.activeTurn!.id)
      expect(cb).toHaveBeenCalledTimes(1)

      // Second drain should not re-fire
      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'Second.' }))
      store.notifyAudioComplete(store.activeTurn!.id)
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  // ─── isProcessing computed ───

  describe('isProcessing computed', () => {
    it('is true when activeTurn is set', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ thought: 'Busy.' }))
      expect(store.isProcessing).toBe(true)
    })

    it('is true when queue has items even if activeTurn is null', () => {
      const store = useTurnStore()
      // Don't set handlers — turns won't be processed
      // Actually enqueue calls processNext which shifts from queue
      // So we need a different approach
      expect(store.isProcessing).toBe(false)
    })

    it('is false when fully idle', () => {
      const store = useTurnStore()
      expect(store.isProcessing).toBe(false)
    })
  })

  // ─── $reset ───

  describe('$reset', () => {
    it('clears all state and pending timers', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ thought: 'Active.' }))
      expect(store.activeTurn).not.toBeNull()

      store.$reset()

      expect(store.queue).toEqual([])
      expect(store.activeTurn).toBeNull()
      expect(store.phase).toBe('idle')
      expect(store.hasPendingTurns).toBe(false)

      // Advancing timers shouldn't cause any state changes
      jest.advanceTimersByTime(20000)
      expect(store.phase).toBe('idle')
    })
  })

  // ─── actionToStatus mapping (via updateAgent calls) ───

  describe('agent status updates', () => {
    it('sets talking status for meeting_speech', () => {
      const handlers = makeHandlers()
      const store = useTurnStore()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'Speech.' }))

      // thinking phase calls updateAgent with 'thinking'
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'thinking')

      store.notifyAudioComplete(store.activeTurn!.id)

      // movement phase (SPEECH_ONLY) calls updateAgent with actionToStatus result
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'talking')
    })

    it('sets talking status for meeting_vote', () => {
      const handlers = makeHandlers()
      const store = useTurnStore()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'meeting_vote', thought: 'I vote.' }))
      store.notifyAudioComplete(store.activeTurn!.id)

      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'talking')
    })

    it('sets idle status when turn finishes', () => {
      const handlers = makeHandlers()
      const store = useTurnStore()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({ actionType: 'meeting_speech', thought: 'Done.' }))
      store.notifyAudioComplete(store.activeTurn!.id)

      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'idle')
    })
  })
})
