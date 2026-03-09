import { setActivePinia, createPinia } from 'pinia'
import { useTurnStore, type Turn, type TurnHandlers } from '@/stores/turn'

jest.mock('@/locales', () => ({
  useLocale: () => ({
    hud: {
      steppingAgent: '{name}: {action}',
    },
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
    getAgentLocation: jest.fn(() => undefined),
    ...overrides,
  }
}

describe('turn store – meeting-specific pipeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('SPEECH_ONLY_ACTIONS skip movement', () => {
    it('meeting_speech with thought skips move handler even when targetLocation is set', () => {
      const move = jest.fn((_id: string, _loc: string, cb: () => void) => cb())
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        move,
        getAgentLocation: jest.fn(() => 'camp'),
      }))

      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        targetLocation: 'town_hall',
        thought: 'I propose we build shelter.',
      }))

      // Thinking phase
      expect(store.phase).toBe('thinking')

      // Complete thought phase
      store.notifyAudioComplete(store.activeTurn!.id)

      // Move handler should never be called
      expect(move).not.toHaveBeenCalled()
      // Turn should finish immediately (thought exists → finishTurn)
      expect(store.phase).toBe('idle')
    })

    it('meeting_vote with thought skips move handler even when targetLocation is set', () => {
      const move = jest.fn((_id: string, _loc: string, cb: () => void) => cb())
      const store = useTurnStore()
      store.setHandlers(makeHandlers({
        move,
        getAgentLocation: jest.fn(() => 'camp'),
      }))

      store.enqueue(makeTurn({
        actionType: 'meeting_vote',
        targetLocation: 'town_hall',
        thought: 'I vote yes.',
      }))

      expect(store.phase).toBe('thinking')
      store.notifyAudioComplete(store.activeTurn!.id)

      expect(move).not.toHaveBeenCalled()
      expect(store.phase).toBe('idle')
    })

    it('meeting_speech without thought goes to hud-only then finishes after 1500ms', () => {
      const move = jest.fn((_id: string, _loc: string, cb: () => void) => cb())
      const handlers = makeHandlers({ move })
      const store = useTurnStore()
      store.setHandlers(handlers)

      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        targetLocation: 'town_hall',
      }))

      // No thought → skip thinking → startMovementPhase → SPEECH_ONLY → completeTurnPhase → hud-only
      expect(store.phase).toBe('hud-only')
      expect(move).not.toHaveBeenCalled()

      // Advance past HUD_ONLY_DURATION_MS (1500ms)
      jest.advanceTimersByTime(1500)

      // Should have finished and set agent to idle
      expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'idle')
      expect(store.phase).toBe('idle')
    })
  })

  describe('turn gap between turns', () => {
    it('inserts a 400ms gap before processing the next queued turn', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      // Enqueue two turns with thoughts so they finish deterministically
      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        thought: 'First speech.',
        agentName: 'Alice',
      }))
      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        thought: 'Second speech.',
        agentId: 'agent-2',
        agentName: 'Bob',
      }))

      // First turn is active in thinking phase
      expect(store.activeTurn!.agentName).toBe('Alice')

      // Complete first turn's thought
      store.notifyAudioComplete(store.activeTurn!.id)

      // After finishTurn → scheduleNext: queue has items → 400ms gap
      // Phase should be idle during the gap
      expect(store.phase).toBe('idle')
      // Second turn should not yet be active
      expect(store.activeTurn!.agentName).toBe('Alice')

      // Advance past the 400ms gap
      jest.advanceTimersByTime(400)

      // Now the second turn should be processing
      expect(store.activeTurn!.agentName).toBe('Bob')
      expect(store.phase).toBe('thinking')
    })
  })

  describe('hasPendingTurns computed', () => {
    it('is true when the queue has items', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ thought: 'One.' }))
      store.enqueue(makeTurn({ agentId: 'agent-2', agentName: 'Bob', thought: 'Two.' }))

      // First turn is active, second is still in queue
      expect(store.hasPendingTurns).toBe(true)
    })

    it('is false when queue is empty and activeTurn is processing', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({ thought: 'Solo turn.' }))

      // The turn was shifted from the queue into activeTurn
      expect(store.activeTurn).not.toBeNull()
      expect(store.hasPendingTurns).toBe(false)
    })

    it('is false when fully drained', () => {
      const store = useTurnStore()
      store.setHandlers(makeHandlers())

      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        thought: 'Done.',
      }))

      store.notifyAudioComplete(store.activeTurn!.id)

      expect(store.activeTurn).toBeNull()
      expect(store.hasPendingTurns).toBe(false)
    })
  })

  describe('scheduleNext drains immediately when queue is empty', () => {
    it('calls processNext immediately without gap timer when last turn finishes', () => {
      const drained = jest.fn()
      const store = useTurnStore()
      store.setHandlers(makeHandlers())
      store.onDrained(drained)

      store.enqueue(makeTurn({
        actionType: 'meeting_speech',
        thought: 'Only turn.',
      }))

      // Complete the only turn
      store.notifyAudioComplete(store.activeTurn!.id)

      // Should drain immediately — no need to advance timers
      expect(drained).toHaveBeenCalledTimes(1)
      expect(store.activeTurn).toBeNull()
      expect(store.phase).toBe('idle')
    })
  })
})
