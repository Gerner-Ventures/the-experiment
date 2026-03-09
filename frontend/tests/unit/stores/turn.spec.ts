import { setActivePinia, createPinia } from 'pinia'
import { useTurnStore, type Turn, type TurnHandlers } from '@/stores/turn'
import { useUIStore } from '@/stores/ui'

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

describe('turn store sequencing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('uses a thinking phase before action execution', () => {
    const store = useTurnStore()
    store.setHandlers(makeHandlers())

    store.enqueue(makeTurn({ actionType: 'move', thought: 'Wait. Think first.' }))

    expect(store.phase).toBe('thinking')
  })

  it('continues after the thought timeout when no bubble event arrives', () => {
    const move = jest.fn((_id, _loc, cb) => cb())
    const store = useTurnStore()
    store.setHandlers(makeHandlers({
      move,
      getAgentLocation: jest.fn(() => 'camp'),
    }))

    store.enqueue(makeTurn({
      actionType: 'move',
      targetLocation: 'forest',
      thought: 'No time to explain.',
    }))

    jest.advanceTimersByTime(15000)

    expect(move).toHaveBeenCalledWith('agent-1', 'forest', expect.any(Function))
  })

  it('keeps the HUD action label active during the thought phase', () => {
    const store = useTurnStore()
    const uiStore = useUIStore()
    store.setHandlers(makeHandlers())

    store.enqueue(makeTurn({ agentName: 'Bob', actionType: 'explore', thought: 'Maybe the beach.' }))

    expect(store.phase).toBe('thinking')
    expect(uiStore.steppingStatus).toBe('Bob: explore')
  })

  it('returns the agent to idle after a thought-driven turn completes', () => {
    const handlers = makeHandlers()
    const store = useTurnStore()
    store.setHandlers(handlers)

    store.enqueue(makeTurn({ thought: 'Done here.', actionType: 'move' }))
    store.notifyAudioComplete(store.activeTurn!.id)

    expect(handlers.updateAgent).toHaveBeenLastCalledWith('agent-1', 'idle')
    expect(store.phase).toBe('idle')
  })

  it('skips movement when the agent is already at the target location', () => {
    const move = jest.fn()
    const store = useTurnStore()
    store.setHandlers(makeHandlers({
      move,
      getAgentLocation: jest.fn(() => 'forest'),
    }))

    store.enqueue(makeTurn({
      actionType: 'move',
      targetLocation: 'forest',
      thought: 'Already here.',
    }))
    store.notifyAudioComplete(store.activeTurn!.id)

    expect(move).not.toHaveBeenCalled()
  })

  it('updates agent location after movement completes', () => {
    let onMoveComplete: (() => void) | null = null
    const handlers = makeHandlers({
      move: jest.fn((_id, _loc, cb) => { onMoveComplete = cb }),
      getAgentLocation: jest.fn(() => 'camp'),
    })
    const store = useTurnStore()
    store.setHandlers(handlers)

    store.enqueue(makeTurn({
      actionType: 'move',
      targetLocation: 'forest',
      thought: 'Move now.',
    }))
    store.notifyAudioComplete(store.activeTurn!.id)
    onMoveComplete!()

    expect(handlers.updateAgent).toHaveBeenCalledWith('agent-1', 'moving', 'forest')
  })
})
