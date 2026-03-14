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

function createMockHandlers(overrides: Partial<TurnHandlers> = {}): TurnHandlers {
  return {
    move: jest.fn((_id, _loc, cb) => cb()),
    playAction: jest.fn((_id, _anim, cb) => cb()),
    updateAgent: jest.fn(),
    addConversation: jest.fn(),
    getAgentLocation: jest.fn(() => 'camp'),
    ...overrides,
  }
}

describe('useTurnStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('starts in idle phase with an empty queue', () => {
    const store = useTurnStore()
    expect(store.phase).toBe('idle')
    expect(store.queue).toEqual([])
    expect(store.activeTurn).toBeNull()
  })

  it('holds movement until the thought phase completes', () => {
    const move = jest.fn()
    const store = useTurnStore()
    store.setHandlers(createMockHandlers({ move }))

    store.enqueue(makeTurn({
      actionType: 'move',
      targetLocation: 'forest',
      thought: 'I should head north.',
    }))

    expect(store.phase).toBe('thinking')
    expect(move).not.toHaveBeenCalled()

    store.onBubbleDismissed(store.activeTurn!.id)

    expect(store.phase).toBe('moving')
    expect(move).toHaveBeenCalledWith('agent-1', 'forest', expect.any(Function))
  })

  it('does not double-advance when audioEnd and dismiss both arrive for the same bubble', () => {
    const store = useTurnStore()
    store.setHandlers(createMockHandlers({
      getAgentLocation: jest.fn(() => undefined),
    }))

    store.enqueue(makeTurn({ agentId: 'a1', thought: 'first thought', actionType: 'move' }))
    store.enqueue(makeTurn({ agentId: 'a2', thought: 'second thought', actionType: 'move' }))

    const firstTurnId = store.activeTurn!.id
    store.notifyAudioComplete(firstTurnId)

    // Advance past the TURN_GAP_MS timer so the second turn starts
    jest.advanceTimersByTime(500)

    expect(store.activeTurn!.agentId).toBe('a2')
    const secondTurnId = store.activeTurn!.id

    // Stale dismiss for first turn should be ignored
    store.onBubbleDismissed(firstTurnId)

    expect(store.activeTurn!.id).toBe(secondTurnId)
    expect(store.phase).toBe('thinking')
  })

  it('adds a fallback inner-thought conversation row with source and round metadata', () => {
    const handlers = createMockHandlers()
    const store = useTurnStore()
    store.setHandlers(handlers)

    store.enqueue(makeTurn({
      thought: 'Keep it together.',
      round: 3,
    }))

    expect(handlers.addConversation).toHaveBeenCalledWith(
      'agent-1',
      'Alice',
      'Keep it together.',
      'inner_thought',
      3,
    )
  })

  it('skips fallback conversation rows when speech already came from agent_speak', () => {
    const handlers = createMockHandlers()
    const store = useTurnStore()
    store.setHandlers(handlers)

    store.enqueue(makeTurn({
      thought: 'Already tracked.',
      fromSpeakEvent: true,
    }))

    expect(handlers.addConversation).not.toHaveBeenCalled()
  })

  it('advances hud-only turns after the action floor timer', () => {
    const store = useTurnStore()
    store.setHandlers(createMockHandlers())

    store.enqueue(makeTurn({ actionType: 'gather', thought: undefined }))

    expect(store.phase).toBe('acting')

    jest.advanceTimersByTime(1500)
    expect(store.phase).toBe('hud-only')

    jest.advanceTimersByTime(1500)
    expect(store.phase).toBe('idle')
    expect(store.activeTurn).toBeNull()
  })

  it('fires drained callbacks after the queue fully empties', () => {
    const store = useTurnStore()
    store.setHandlers(createMockHandlers())
    const drained = jest.fn()
    store.onDrained(drained)

    store.enqueue(makeTurn({ actionType: 'gather', thought: undefined }))
    jest.advanceTimersByTime(3000)

    expect(drained).toHaveBeenCalledTimes(1)
  })

  it('fires drained callbacks only once per registration', () => {
    const store = useTurnStore()
    store.setHandlers(createMockHandlers())
    const drained = jest.fn()
    store.onDrained(drained)

    store.enqueue(makeTurn({ actionType: 'gather', thought: undefined }))
    jest.advanceTimersByTime(3000)
    store.enqueue(makeTurn({ actionType: 'gather', thought: undefined }))
    jest.advanceTimersByTime(3000)

    expect(drained).toHaveBeenCalledTimes(1)
  })

  it('clears pending timers on reset', () => {
    const handlers = createMockHandlers()
    const store = useTurnStore()
    store.setHandlers(handlers)

    store.enqueue(makeTurn({ thought: 'Hold position.' }))
    store.$reset()
    jest.advanceTimersByTime(15000)

    expect(store.phase).toBe('idle')
    expect(store.activeTurn).toBeNull()
    expect(handlers.updateAgent).toHaveBeenCalledTimes(1)
  })

  it('waits for both animation completion and the floor timer before advancing', () => {
    let finishAction: (() => void) | null = null
    const store = useTurnStore()
    store.setHandlers(createMockHandlers({
      playAction: jest.fn((_id, _anim, cb) => { finishAction = cb }),
      getAgentLocation: jest.fn(() => 'camp'),
    }))

    store.enqueue(makeTurn({
      actionType: 'stab',
      thought: 'Strike now.',
      targetLocation: 'camp',
    }))

    store.notifyAudioComplete(store.activeTurn!.id)
    expect(store.phase).toBe('acting')

    finishAction!()
    expect(store.phase).toBe('acting')

    jest.advanceTimersByTime(1500)
    expect(store.phase).toBe('idle')
  })

  it('queues turns without starting them while blocked, then resumes when unblocked', () => {
    const handlers = createMockHandlers()
    const store = useTurnStore()
    store.setHandlers(handlers)
    store.setBlocked(true)

    store.enqueue(makeTurn({
      actionType: 'move',
      targetLocation: 'forest',
      thought: 'Wait for the narration.',
    }))

    expect(store.activeTurn).toBeNull()
    expect(store.phase).toBe('idle')
    expect(handlers.addConversation).not.toHaveBeenCalled()

    store.setBlocked(false)

    expect(store.activeTurn).not.toBeNull()
    expect(store.phase).toBe('thinking')
    expect(handlers.addConversation).toHaveBeenCalledWith(
      'agent-1',
      'Alice',
      'Wait for the narration.',
      'inner_thought',
      1,
    )
  })
})
