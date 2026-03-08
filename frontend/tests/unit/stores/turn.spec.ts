import { setActivePinia, createPinia } from 'pinia'
import { useTurnStore, type TurnHandlers } from '@/stores/turn'

function createMockHandlers(overrides: Partial<TurnHandlers> = {}): TurnHandlers {
  return {
    move: jest.fn((_id, _loc, cb) => cb()),
    playAction: jest.fn((_id, _anim, cb) => cb()),
    updateAgent: jest.fn(),
    addConversation: jest.fn(),
    getAgentLocation: jest.fn(() => 'town_square'),
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

  it('starts in idle phase with empty queue', () => {
    const store = useTurnStore()
    expect(store.phase).toBe('idle')
    expect(store.queue).toEqual([])
    expect(store.activeTurn).toBeNull()
    expect(store.isProcessing).toBe(false)
  })

  it('enqueues a turn and starts processing', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers()
    store.setHandlers(handlers)

    store.enqueue({
      agentId: 'a1',
      agentName: 'Alice',
      actionType: 'stab',
      thought: 'Take that!',
    })

    expect(store.activeTurn).not.toBeNull()
    expect(store.activeTurn!.agentName).toBe('Alice')
    expect(store.isProcessing).toBe(true)
  })

  it('skips action phase for move/rest/explore', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers()
    store.setHandlers(handlers)

    store.enqueue({
      agentId: 'a1',
      agentName: 'Alice',
      actionType: 'move',
      thought: 'Going somewhere',
    })

    // Should skip acting phase — playAction never called
    expect(handlers.playAction).not.toHaveBeenCalled()
    // Should be in talking phase (has thought)
    expect(store.phase).toBe('talking')
  })

  it('enters acting phase for stab action', () => {
    const store = useTurnStore()
    // playAction does not immediately call back — simulates animation duration
    let playActionCb: (() => void) | null = null
    const handlers = createMockHandlers({
      playAction: jest.fn((_id, _anim, cb) => { playActionCb = cb }),
    })
    store.setHandlers(handlers)

    store.enqueue({
      agentId: 'a1',
      agentName: 'Alice',
      actionType: 'stab',
      thought: 'Die!',
    })

    expect(store.phase).toBe('acting')
    expect(handlers.playAction).toHaveBeenCalledWith('a1', 'stab', expect.any(Function))

    // Animation completes but floor timer hasn't
    playActionCb!()
    expect(store.phase).toBe('acting') // still waiting for min duration

    // Floor timer expires
    jest.advanceTimersByTime(1500)
    expect(store.phase).toBe('talking')
  })

  it('proceeds to hud-only when no thought', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers()
    store.setHandlers(handlers)

    store.enqueue({
      agentId: 'a1',
      agentName: 'Alice',
      actionType: 'gather',
    })

    // After acting phase completes (instant mock + 800ms floor)
    jest.advanceTimersByTime(1500)
    expect(store.phase).toBe('hud-only')

    // After HUD timer
    jest.advanceTimersByTime(1500)
    expect(store.phase).toBe('idle')
    expect(store.activeTurn).toBeNull()
  })

  it('processes queue sequentially', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers()
    store.setHandlers(handlers)

    store.enqueue({ agentId: 'a1', agentName: 'Alice', actionType: 'move', thought: 'Hi' })
    store.enqueue({ agentId: 'a2', agentName: 'Bob', actionType: 'move', thought: 'Hey' })

    expect(store.activeTurn!.agentName).toBe('Alice')
    expect(store.queue.length).toBe(1)

    // Dismiss Alice's bubble
    store.onBubbleDismissed()
    expect(store.activeTurn!.agentName).toBe('Bob')
  })

  it('calls onDrained when queue empties', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers()
    store.setHandlers(handlers)

    const drained = jest.fn()
    store.onDrained(drained)

    store.enqueue({ agentId: 'a1', agentName: 'Alice', actionType: 'move', thought: 'Hi' })
    store.onBubbleDismissed()

    expect(drained).toHaveBeenCalled()
  })

  it('moves agent when target location differs', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers({
      getAgentLocation: jest.fn(() => 'town_square'),
    })
    store.setHandlers(handlers)

    store.enqueue({
      agentId: 'a1',
      agentName: 'Alice',
      actionType: 'move',
      targetLocation: 'beach_camp',
      thought: 'Walking',
    })

    expect(handlers.move).toHaveBeenCalledWith('a1', 'beach_camp', expect.any(Function))
  })

  it('skips move when already at target location', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers({
      getAgentLocation: jest.fn(() => 'beach_camp'),
    })
    store.setHandlers(handlers)

    store.enqueue({
      agentId: 'a1',
      agentName: 'Alice',
      actionType: 'move',
      targetLocation: 'beach_camp',
      thought: 'Already here',
    })

    expect(handlers.move).not.toHaveBeenCalled()
  })

  it('resets cleanly including handlers', () => {
    const store = useTurnStore()
    const handlers = createMockHandlers()
    store.setHandlers(handlers)

    store.enqueue({ agentId: 'a1', agentName: 'Alice', actionType: 'stab' })
    store.$reset()

    expect(store.phase).toBe('idle')
    expect(store.queue).toEqual([])
    expect(store.activeTurn).toBeNull()

    // After reset, enqueuing should not call stale handlers
    const stalePlayAction = handlers.playAction as jest.Mock
    stalePlayAction.mockClear()
    store.enqueue({ agentId: 'a2', agentName: 'Bob', actionType: 'stab' })
    // Without handlers set, playAction should not be called
    expect(stalePlayAction).not.toHaveBeenCalled()
  })
})
