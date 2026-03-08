/**
 * Integration tests for WebSocket message routing.
 *
 * Verifies that all message types defined in WSMessageType are routed
 * to the correct store handler via the routeMessage function.
 */
import { setActivePinia, createPinia } from 'pinia'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useSocialStore } from '@/stores/social'
import type { WSMessage, WSMessageType } from '@/types/websocket'

// We can't import useWebSocket directly (it creates a real WebSocket),
// so we re-implement routeMessage to test routing logic in isolation.
function routeMessage(msg: WSMessage) {
  const experimentStore = useExperimentStore()
  const agentStore = useAgentStore()
  const worldStore = useWorldStore()
  const gmStore = useGMStore()
  const socialStore = useSocialStore()

  experimentStore.addEvent(msg)

  const router: Partial<Record<WSMessageType, (m: WSMessage) => void>> = {
    connected: () => { /* no-op */ },
    round_start: (m) => experimentStore.onRoundStart(m),
    round_end: (m) => experimentStore.onRoundEnd(m),
    phase_change: (m) => experimentStore.onPhaseChange(m),
    gm_plan: (m) => gmStore.onPlan(m),
    gm_narration: (m) => gmStore.onNarration(m),
    agent_action: (m) => agentStore.onAction(m),
    agent_move: (m) => agentStore.onMove(m),
    agent_speak: (m) => socialStore.onSpeak(m),
    crisis_event: (m) => worldStore.onCrisis(m),
    threat_update: (m) => worldStore.onThreatUpdate(m),
    resource_update: (m) => worldStore.onResourceUpdate(m),
    meeting_start: (m) => socialStore.onMeetingStart(m),
    meeting_speech: (m) => socialStore.onMeetingSpeech(m),
    meeting_vote: (m) => socialStore.onMeetingVote(m),
    meeting_result: (m) => socialStore.onMeetingResult(m),
    faction_update: (m) => socialStore.onFactionUpdate(m),
    cult_activity: (m) => socialStore.onCultActivity(m),
    exile_vote: (m) => socialStore.onExileVote(m),
    exile_result: (m) => socialStore.onExileResult(m),
    experiment_end: (m) => experimentStore.onEnd(m),
  }

  const handler = router[msg.type as WSMessageType]
  if (handler) {
    handler(msg)
  }
}

function makeMsg(type: WSMessageType, data: Record<string, unknown> = {}, phase?: string, round = 1): WSMessage {
  return { type, round, phase, timestamp: '2026-03-07T00:00:00Z', data }
}

describe('WebSocket message routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('always logs event to experimentStore regardless of type', () => {
    const experimentStore = useExperimentStore()
    routeMessage(makeMsg('connected'))
    expect(experimentStore.events).toHaveLength(1)
  })

  it('routes connected as no-op (no side effects beyond event log)', () => {
    const experimentStore = useExperimentStore()
    routeMessage(makeMsg('connected'))
    expect(experimentStore.status).toBe('setup') // unchanged
  })

  it('routes round_start to experimentStore', () => {
    const experimentStore = useExperimentStore()
    routeMessage(makeMsg('round_start', { total_rounds: 15 }, undefined, 3))
    expect(experimentStore.currentRound).toBe(3)
    expect(experimentStore.status).toBe('running')
  })

  it('routes round_end to experimentStore', () => {
    const experimentStore = useExperimentStore()
    const worldStore = useWorldStore()
    routeMessage(makeMsg('round_end', { status: 'running', current_round: 3, total_rounds: 15, threat_level: 25, resources: { food: 20, water: 25, materials: 10, power: 8 }, agents: [] }))
    expect(experimentStore.currentRound).toBe(3)
    expect(worldStore.threatLevel).toBe(25)
  })

  it('routes phase_change to experimentStore', () => {
    const experimentStore = useExperimentStore()
    routeMessage(makeMsg('phase_change', {}, 'morning'))
    expect(experimentStore.currentPhase).toBe('morning')
  })

  it('routes gm_plan to gmStore', () => {
    const gmStore = useGMStore()
    routeMessage(makeMsg('gm_plan', {
      round: 1,
      round_theme: 'Tension',
      reasoning: 'test',
      crisis_event: { type: 'social', description: '', severity: 'low', affects: [] },
      resource_modifiers: {},
      narration: 'Dark clouds gather...',
      meta_hint: null,
    }))
    expect(gmStore.currentPlan).not.toBeNull()
    expect(gmStore.showPlanPanel).toBe(true)
  })

  it('routes gm_narration to gmStore', () => {
    const gmStore = useGMStore()
    routeMessage(makeMsg('gm_narration', { text: 'The storm breaks.' }))
    expect(gmStore.narrationText).toBe('The storm breaks.')
    expect(gmStore.showNarration).toBe(true)
  })

  it('routes agent_action to agentStore (enqueues in turn store)', () => {
    const { useTurnStore } = require('@/stores/turn')
    const agentStore = useAgentStore()
    const turnStore = useTurnStore()
    agentStore.setAgents([{ id: 'a1', name: 'Alice', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'communal_survival', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' }])
    routeMessage(makeMsg('agent_action', { agent_id: 'a1', action: 'gather', summary: 'collecting wood' }))
    // Action is now enqueued as a turn, not applied immediately
    expect(turnStore.activeTurn).not.toBeNull()
    expect(turnStore.activeTurn.actionType).toBe('gather')
  })

  it('routes agent_move to agentStore', () => {
    const agentStore = useAgentStore()
    agentStore.setAgents([{ id: 'a1', name: 'Alice', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'communal_survival', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' }])
    routeMessage(makeMsg('agent_move', { agent_id: 'a1', location: 'forest' }))
    expect(agentStore.getAgent('a1')!.location).toBe('forest')
    expect(agentStore.getAgent('a1')!.status).toBe('moving')
  })

  it('routes agent_speak to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('agent_speak', { agent_id: 'a1', agent_name: 'Alice', target: 'a2', message: 'Hello' }))
    expect(socialStore.conversations).toHaveLength(1)
    expect(socialStore.conversations[0].message).toBe('Hello')
  })

  it('routes crisis_event to worldStore', () => {
    const worldStore = useWorldStore()
    routeMessage(makeMsg('crisis_event', { type: 'environmental', description: 'Flood', severity: 'high', affects: ['beach'] }))
    expect(worldStore.activeCrisis).not.toBeNull()
    expect(worldStore.activeCrisis!.description).toBe('Flood')
  })

  it('routes threat_update to worldStore', () => {
    const worldStore = useWorldStore()
    routeMessage(makeMsg('threat_update', { threat_level: 45 }))
    expect(worldStore.threatLevel).toBe(45)
  })

  it('routes resource_update to worldStore', () => {
    const worldStore = useWorldStore()
    routeMessage(makeMsg('resource_update', { food: 8, water: 15 }))
    expect(worldStore.resources.food).toBe(8)
    expect(worldStore.resources.water).toBe(15)
  })

  it('routes meeting_start to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('meeting_start', { proposal: 'Ration food?' }))
    expect(socialStore.meeting).not.toBeNull()
    expect(socialStore.meeting!.proposal).toBe('Ration food?')
    expect(socialStore.isMeetingActive).toBe(true)
  })

  it('routes meeting_speech to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('meeting_start', { proposal: 'test' }))
    routeMessage(makeMsg('meeting_speech', { agent_id: 'a1', text: 'I agree.' }))
    expect(socialStore.meeting!.speeches).toHaveLength(1)
    expect(socialStore.meeting!.speeches[0].text).toBe('I agree.')
  })

  it('routes meeting_vote to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('meeting_start', { proposal: 'test' }))
    routeMessage(makeMsg('meeting_vote', { agent_id: 'a1', vote: 'agree' }))
    expect(socialStore.meeting!.votes['a1']).toBe('agree')
  })

  it('routes meeting_result to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('meeting_start', { proposal: 'test' }))
    routeMessage(makeMsg('meeting_result', { summary: 'Passed', votes: { a1: 'agree' } }))
    expect(socialStore.meeting!.result).toBe('Passed')
    expect(socialStore.isMeetingActive).toBe(false)
  })

  it('routes faction_update to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('faction_update', { faction_id: 'f1', name: 'Rebels' }))
    expect(socialStore.factionUpdates).toHaveLength(1)
    expect(socialStore.factionUpdates[0].name).toBe('Rebels')
  })

  it('routes cult_activity to socialStore as faction event', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('cult_activity', { cult_name: 'The Watchers', ritual: 'chant' }))
    expect(socialStore.factionUpdates).toHaveLength(1)
    expect(socialStore.factionUpdates[0].type).toBe('cult_activity')
    expect(socialStore.factionUpdates[0].cult_name).toBe('The Watchers')
  })

  it('routes exile_vote to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('exile_vote', { target_agent: 'a1', votes: { a2: 'exile' } }))
    expect(socialStore.exileEvents).toHaveLength(1)
    expect(socialStore.exileEvents[0].phase).toBe('vote')
  })

  it('routes exile_result to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('exile_result', { target_agent: 'a1', exiled: true }))
    expect(socialStore.exileEvents).toHaveLength(1)
    expect(socialStore.exileEvents[0].phase).toBe('result')
    expect(socialStore.exileEvents[0].exiled).toBe(true)
  })

  it('routes experiment_end to experimentStore', () => {
    const experimentStore = useExperimentStore()
    routeMessage(makeMsg('experiment_end', { summary: 'Society collapsed' }))
    expect(experimentStore.status).toBe('completed')
  })

  it('ignores unknown message types gracefully', () => {
    // Should not throw
    expect(() => {
      routeMessage(makeMsg('unknown_type' as WSMessageType, {}))
    }).not.toThrow()
  })

  it('full game lifecycle: start → phases → actions → end', () => {
    const experimentStore = useExperimentStore()
    const agentStore = useAgentStore()
    const worldStore = useWorldStore()
    const socialStore = useSocialStore()

    // Setup agents
    agentStore.setAgents([
      { id: 'a1', name: 'Alice', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'communal_survival', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' },
      { id: 'a2', name: 'Bob', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'status_power', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' },
    ])

    // Round 1 begins
    routeMessage(makeMsg('round_start', { total_rounds: 10 }, undefined, 1))
    expect(experimentStore.currentRound).toBe(1)
    expect(experimentStore.isRunning).toBe(true)

    // Phase changes
    routeMessage(makeMsg('phase_change', {}, 'dawn'))
    expect(experimentStore.currentPhase).toBe('dawn')

    // Agent actions (now enqueued in turn store, not applied immediately)
    routeMessage(makeMsg('agent_action', { agent_id: 'a1', action: 'gather', summary: 'collecting' }))
    routeMessage(makeMsg('agent_speak', { agent_id: 'a2', agent_name: 'Bob', target: 'a1', message: 'Need help?' }))
    const { useTurnStore } = require('@/stores/turn')
    const turnStore = useTurnStore()
    expect(turnStore.activeTurn).not.toBeNull()
    expect(socialStore.conversations).toHaveLength(1)

    // Resource update
    routeMessage(makeMsg('resource_update', { food: 20, water: 25 }))
    expect(worldStore.resources.food).toBe(20)

    // Round ends
    routeMessage(makeMsg('round_end', { status: 'running', current_round: 5, total_rounds: 15, threat_level: 15, resources: { food: 20, water: 25, materials: 10, power: 8 }, agents: [] }))

    // Eventually the game ends
    routeMessage(makeMsg('experiment_end', { summary: 'Society thrived' }))
    expect(experimentStore.isComplete).toBe(true)
    expect(experimentStore.status).toBe('completed')

    // All events logged
    expect(experimentStore.events.length).toBeGreaterThanOrEqual(6)
  })
})
