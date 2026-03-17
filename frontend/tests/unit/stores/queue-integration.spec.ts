/**
 * Queue integration tests — verify that external events (narration, meetings,
 * phase changes) interact correctly with the turn queue pacing layer.
 *
 * These tests cover the scenarios identified in the queue bypass audit:
 * 1. Narration overlay should not interrupt an active turn
 * 2. Meeting activation should be deferred until the queue reaches meeting turns
 * 3. fromSpeakEvent should only be true when the conversation already exists
 * 4. Phase changes should not disrupt turn sequencing
 */

import { setActivePinia, createPinia } from 'pinia'
import { useTurnStore, type Turn, type TurnHandlers } from '@/stores/turn'
import { useSocialStore } from '@/stores/social'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import type { WSMessage } from '@/types/websocket'

// ─── Helpers ───

function makeTurn(overrides: Partial<Omit<Turn, 'id'>> = {}): Omit<Turn, 'id'> {
  return {
    agentId: 'agent-1',
    agentName: 'Alice',
    round: 1,
    actionType: 'talk',
    thought: 'I should investigate.',
    thoughtSource: 'inner_thought',
    ...overrides,
  }
}

function makeHandlers(overrides: Partial<TurnHandlers> = {}): TurnHandlers {
  return {
    move: jest.fn((_id, _loc, cb) => cb()),
    playAction: jest.fn((_id, _anim, cb) => cb()),
    updateAgent: jest.fn(),
    addConversation: jest.fn(() => ({ id: 1, index: 0 })),
    getAgentLocation: jest.fn(() => undefined),
    ...overrides,
  }
}

function makeMsg(type: string, data: Record<string, unknown> = {}, round = 1): WSMessage {
  return { type: type as WSMessage['type'], round, timestamp: '2026-03-07T00:00:00Z', data }
}

// ─── Setup ───

beforeEach(() => {
  setActivePinia(createPinia())
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

// ═══════════════════════════════════════════════════════
// 1. Narration blocking defers to turn boundary
// ═══════════════════════════════════════════════════════

describe('narration blocking', () => {
  it('does not interrupt an active turn mid-thought', () => {
    const turnStore = useTurnStore()
    turnStore.setHandlers(makeHandlers())
    turnStore.enqueue(makeTurn({ agentName: 'Alice', actionType: 'observe' }))

    // Turn is processing — thought phase active
    expect(turnStore.phase).toBe('thinking')
    expect(turnStore.activeTurn).not.toBeNull()

    // Narration arrives — sets blocked
    turnStore.setBlocked(true)

    // Turn should NOT be interrupted — still in thinking phase
    expect(turnStore.phase).toBe('thinking')
    expect(turnStore.activeTurn?.agentName).toBe('Alice')
  })

  it('blocks the queue after the active turn completes', () => {
    const turnStore = useTurnStore()
    turnStore.setHandlers(makeHandlers())
    turnStore.enqueue(makeTurn({ agentName: 'Alice' }))
    turnStore.enqueue(makeTurn({ agentName: 'Bob' }))

    expect(turnStore.activeTurn?.agentName).toBe('Alice')

    // Block mid-turn
    turnStore.setBlocked(true)

    // Complete Alice's thought (simulates bubble dismiss)
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)

    // Advance timers for action phase + turn gap
    jest.advanceTimersByTime(5000)

    // Bob should NOT be processing — queue is blocked
    expect(turnStore.activeTurn).toBeNull()
    expect(turnStore.phase).toBe('idle')
    expect(turnStore.queue.length).toBe(1)
  })

  it('resumes processing when unblocked', () => {
    const turnStore = useTurnStore()
    turnStore.setHandlers(makeHandlers())
    turnStore.enqueue(makeTurn({ agentName: 'Alice' }))
    turnStore.enqueue(makeTurn({ agentName: 'Bob' }))

    // Block mid-turn
    turnStore.setBlocked(true)

    // Complete Alice's turn
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    expect(turnStore.activeTurn).toBeNull()

    // Unblock
    turnStore.setBlocked(false)

    // Bob should now be processing
    expect(turnStore.activeTurn?.agentName).toBe('Bob')
  })

  it('blocks immediately when no turn is active', () => {
    const turnStore = useTurnStore()
    turnStore.setHandlers(makeHandlers())

    turnStore.setBlocked(true)
    turnStore.enqueue(makeTurn({ agentName: 'Alice' }))

    // Alice should NOT start — blocked before any turn was active
    expect(turnStore.activeTurn).toBeNull()
    expect(turnStore.queue.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════
// 2. Meeting activation deferred to first meeting turn
// ═══════════════════════════════════════════════════════

describe('meeting activation', () => {
  it('meeting_start stages meeting without activating', () => {
    const socialStore = useSocialStore()
    socialStore.onMeetingStart(makeMsg('meeting_start', { proposal: 'Ration food' }))

    expect(socialStore.meeting).not.toBeNull()
    expect(socialStore.meeting!.proposal).toBe('Ration food')
    expect(socialStore.isMeetingActive).toBe(false)
  })

  it('meeting activates when turn store reaches meeting_speech', () => {
    const turnStore = useTurnStore()
    const socialStore = useSocialStore()
    turnStore.setHandlers(makeHandlers())

    // Stage meeting
    socialStore.onMeetingStart(makeMsg('meeting_start', { proposal: 'Ration food' }))
    expect(socialStore.isMeetingActive).toBe(false)

    // Enqueue a morning turn followed by a meeting turn
    turnStore.enqueue(makeTurn({ agentName: 'Alice', actionType: 'observe' }))
    turnStore.enqueue(makeTurn({
      agentName: 'Bob',
      actionType: 'meeting_speech',
      thought: 'I support this.',
    }))

    // Alice is processing — meeting still not active
    expect(turnStore.activeTurn?.agentName).toBe('Alice')
    expect(socialStore.isMeetingActive).toBe(false)

    // Complete Alice's turn
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Bob (meeting_speech) should now be processing, meeting activated
    expect(turnStore.activeTurn?.agentName).toBe('Bob')
    expect(socialStore.isMeetingActive).toBe(true)
  })

  it('morning turns are not interrupted by meeting_start', () => {
    const turnStore = useTurnStore()
    const socialStore = useSocialStore()
    turnStore.setHandlers(makeHandlers())

    // Start processing a morning turn
    turnStore.enqueue(makeTurn({ agentName: 'Alice', actionType: 'investigate' }))
    expect(turnStore.activeTurn?.agentName).toBe('Alice')

    // meeting_start arrives mid-turn
    socialStore.onMeetingStart(makeMsg('meeting_start', { proposal: 'Vote now' }))

    // Alice should still be processing, undisturbed
    expect(turnStore.activeTurn?.agentName).toBe('Alice')
    expect(turnStore.phase).toBe('thinking')
    expect(socialStore.isMeetingActive).toBe(false)
  })

  it('activateMeeting is idempotent', () => {
    const socialStore = useSocialStore()
    socialStore.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

    socialStore.activateMeeting()
    expect(socialStore.isMeetingActive).toBe(true)

    // Calling again should not throw or change state
    socialStore.activateMeeting()
    expect(socialStore.isMeetingActive).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════
// 3. fromSpeakEvent correctness
// ═══════════════════════════════════════════════════════

describe('fromSpeakEvent', () => {
  it('is false when agent_speak has not arrived yet', () => {
    const agentStore = useAgentStore()
    const turnStore = useTurnStore()
    agentStore.setAgents([{
      agent_id: 'a1', name: 'Alice', character_id: 'test',
      personality: {}, goal: {},
    } as Record<string, unknown>])

    // agent_action arrives — no prior agent_speak
    agentStore.onAction(makeMsg('agent_action', {
      agent_id: 'a1',
      action: { type: 'observe', location: 'town_square' },
      inner_thought: 'I should look around.',
      speech_source: 'inner_thought',
    }))

    expect(turnStore.activeTurn!.fromSpeakEvent).toBe(false)
  })

  it('is true when agent_speak arrived first with matching message', () => {
    const agentStore = useAgentStore()
    const socialStore = useSocialStore()
    const turnStore = useTurnStore()
    agentStore.setAgents([{
      agent_id: 'a1', name: 'Alice', character_id: 'test',
      personality: {}, goal: {},
    } as Record<string, unknown>])

    // agent_speak arrives first
    socialStore.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1',
      agent_name: 'Alice',
      message: 'I should look around.',
      source: 'inner_thought',
    }))

    // agent_action arrives — should find the existing conversation
    agentStore.onAction(makeMsg('agent_action', {
      agent_id: 'a1',
      action: { type: 'observe', location: 'town_square' },
      inner_thought: 'I should look around.',
      speech_text: 'I should look around.',
      speech_source: 'inner_thought',
    }))

    expect(turnStore.activeTurn!.fromSpeakEvent).toBe(true)
    expect(turnStore.activeTurn!.thoughtConversationId).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════
// 4. Queue ordering — turns process in FIFO order
// ═══════════════════════════════════════════════════════

describe('queue ordering', () => {
  it('processes morning turns before meeting turns', () => {
    const turnStore = useTurnStore()
    const socialStore = useSocialStore()
    const processed: string[] = []

    turnStore.setHandlers(makeHandlers({
      updateAgent: jest.fn((id, status) => {
        if (status === 'thinking') processed.push(id)
      }),
    }))

    // Enqueue morning + meeting turns in arrival order
    turnStore.enqueue(makeTurn({ agentId: 'a1', agentName: 'Alice', actionType: 'observe' }))
    turnStore.enqueue(makeTurn({ agentId: 'a2', agentName: 'Bob', actionType: 'rally' }))

    // Stage meeting and enqueue meeting turns
    socialStore.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
    turnStore.enqueue(makeTurn({ agentId: 'a1', agentName: 'Alice', actionType: 'meeting_speech', thought: 'I agree' }))

    // Process through all turns
    // Alice observe
    expect(turnStore.activeTurn?.agentName).toBe('Alice')
    expect(turnStore.activeTurn?.actionType).toBe('observe')
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Bob rally
    expect(turnStore.activeTurn?.agentName).toBe('Bob')
    expect(turnStore.activeTurn?.actionType).toBe('rally')
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Alice meeting_speech — meeting should now be active
    expect(turnStore.activeTurn?.agentName).toBe('Alice')
    expect(turnStore.activeTurn?.actionType).toBe('meeting_speech')
    expect(socialStore.isMeetingActive).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════
// 5. Phase-driven visual sync
// ═══════════════════════════════════════════════════════

describe('phase-driven visual sync', () => {
  function phaseMsg(phase: string, status = 'starting'): WSMessage {
    return { type: 'phase_change', round: 1, timestamp: '', phase, data: { status } } as unknown as WSMessage
  }

  it('applies phase immediately when no turns are active', () => {
    const experimentStore = useExperimentStore()

    experimentStore.onPhaseChange(phaseMsg('morning'))
    expect(experimentStore.currentPhase).toBe('morning')
  })

  it('does NOT apply phase when turns are active', () => {
    const turnStore = useTurnStore()
    const experimentStore = useExperimentStore()
    turnStore.setHandlers(makeHandlers())

    // Apply morning before turns start
    experimentStore.onPhaseChange(phaseMsg('morning'))
    expect(experimentStore.currentPhase).toBe('morning')

    // Start a turn
    turnStore.enqueue(makeTurn({ agentName: 'Alice', phase: 'morning' }))
    expect(turnStore.activeTurn).not.toBeNull()

    // midday arrives from backend while turn is active
    experimentStore.onPhaseChange(phaseMsg('midday'))

    // Visual should still be morning — not midday
    expect(experimentStore.currentPhase).toBe('morning')
  })

  it('transitions visual phase when queue reaches a turn from the new phase', () => {
    const turnStore = useTurnStore()
    const experimentStore = useExperimentStore()
    turnStore.setHandlers(makeHandlers())

    // Apply morning
    experimentStore.onPhaseChange(phaseMsg('morning'))

    // Enqueue morning turn then midday turn
    turnStore.enqueue(makeTurn({ agentName: 'Alice', phase: 'morning', actionType: 'observe' }))
    turnStore.enqueue(makeTurn({ agentName: 'Bob', phase: 'midday', actionType: 'meeting_speech', thought: 'I agree' }))

    // midday phase_change arrives while Alice is active — ignored
    experimentStore.onPhaseChange(phaseMsg('midday'))
    expect(experimentStore.currentPhase).toBe('morning')

    // Complete Alice's morning turn
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Bob's turn starts — tagged with 'midday' — visual transitions
    expect(turnStore.activeTurn?.agentName).toBe('Bob')
    expect(experimentStore.currentPhase).toBe('midday')
  })

  it('transitions through multiple phases as queue progresses', () => {
    const turnStore = useTurnStore()
    const experimentStore = useExperimentStore()
    const socialStore = useSocialStore()
    turnStore.setHandlers(makeHandlers())

    experimentStore.onPhaseChange(phaseMsg('morning'))

    // Enqueue: morning → midday (meeting) → afternoon
    turnStore.enqueue(makeTurn({ agentName: 'Alice', phase: 'morning', actionType: 'observe' }))
    socialStore.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
    turnStore.enqueue(makeTurn({ agentName: 'Bob', phase: 'midday', actionType: 'meeting_speech', thought: 'Yes' }))
    turnStore.enqueue(makeTurn({ agentName: 'Carol', phase: 'afternoon', actionType: 'gather' }))

    // Backend sends all phase changes — ignored while turns active
    experimentStore.onPhaseChange(phaseMsg('midday'))
    experimentStore.onPhaseChange(phaseMsg('afternoon'))
    expect(experimentStore.currentPhase).toBe('morning')

    // Complete Alice (morning)
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Bob starts → midday
    expect(turnStore.activeTurn?.actionType).toBe('meeting_speech')
    expect(experimentStore.currentPhase).toBe('midday')
    expect(socialStore.isMeetingActive).toBe(true)

    // Complete Bob
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Carol starts → afternoon
    expect(turnStore.activeTurn?.agentName).toBe('Carol')
    expect(experimentStore.currentPhase).toBe('afternoon')
  })

  it('does not regress phase when consecutive turns share the same phase', () => {
    const turnStore = useTurnStore()
    const experimentStore = useExperimentStore()
    turnStore.setHandlers(makeHandlers())

    experimentStore.onPhaseChange(phaseMsg('morning'))

    turnStore.enqueue(makeTurn({ agentName: 'Alice', phase: 'morning', actionType: 'observe' }))
    turnStore.enqueue(makeTurn({ agentName: 'Bob', phase: 'morning', actionType: 'rally' }))

    // Complete Alice
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Bob starts — same phase, no transition
    expect(turnStore.activeTurn?.agentName).toBe('Bob')
    expect(experimentStore.currentPhase).toBe('morning')
  })

  it('handles turns without phase field gracefully (no transition)', () => {
    const turnStore = useTurnStore()
    const experimentStore = useExperimentStore()
    turnStore.setHandlers(makeHandlers())

    experimentStore.onPhaseChange(phaseMsg('morning'))

    // Turn with no phase set (legacy or edge case)
    turnStore.enqueue(makeTurn({ agentName: 'Alice', actionType: 'observe' }))
    expect(experimentStore.currentPhase).toBe('morning')

    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Phase unchanged
    expect(experimentStore.currentPhase).toBe('morning')
  })
})

// ═══════════════════════════════════════════════════════
// 6. Turn lifecycle logging (smoke test)
// ═══════════════════════════════════════════════════════

describe('turn lifecycle', () => {
  it('logs completed turn with timing breakdown', () => {
    const turnStore = useTurnStore()
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation()

    turnStore.setHandlers(makeHandlers())
    turnStore.enqueue(makeTurn({ agentName: 'Alice', actionType: 'observe' }))

    // Complete the turn
    turnStore.onBubbleDismissed(turnStore.activeTurn!.id)
    jest.advanceTimersByTime(5000)

    // Should have logged a lifecycle summary
    const lifecycleLogs = debugSpy.mock.calls.filter(
      args => typeof args[0] === 'string' && (args[0] as string).includes('[Turn #') && (args[0] as string).includes('total)'),
    )
    expect(lifecycleLogs.length).toBeGreaterThan(0)

    debugSpy.mockRestore()
  })
})
