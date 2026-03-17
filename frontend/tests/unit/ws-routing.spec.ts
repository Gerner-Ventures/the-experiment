/**
 * Integration tests for WebSocket message routing.
 *
 * Verifies that all message types defined in WSMessageType are routed
 * to the correct store handler via the routeMessage function.
 *
 * Uses the real extracted routeMessage from wsRouter.ts — no duplication.
 */
import { setActivePinia, createPinia } from 'pinia'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useSocialStore } from '@/stores/social'
import { useTurnStore } from '@/stores/turn'
import { useUIStore } from '@/stores/ui'
import { routeMessage } from '@/composables/wsRouter'
import type { WSMessage, WSMessageType } from '@/types/websocket'

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

  it('routes gm_audio_status to gmStore', () => {
    const gmStore = useGMStore()
    gmStore.hydrateNarration('Resolved narration.', 2, 'narr-2', 'pending', null)
    routeMessage(makeMsg('gm_audio_status', {
      status: 'ready',
      narration_id: 'narr-2',
      audio_url: '/api/experiments/e1/rounds/2/narration/audio?v=narr-2',
    }, undefined, 2))
    expect(gmStore.narrationAudioStatus).toBe('ready')
    expect(gmStore.narrationAudioUrl).toBe('/api/experiments/e1/rounds/2/narration/audio?v=narr-2')
  })

  it('routes agent_action to agentStore (enqueues in turn store)', () => {
    const agentStore = useAgentStore()
    const turnStore = useTurnStore()
    agentStore.setAgents([{ id: 'a1', name: 'Alice', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'communal_survival', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' }])
    routeMessage(makeMsg('agent_action', { agent_id: 'a1', action: 'gather', summary: 'collecting wood' }))
    // Action is now enqueued as a turn, not applied immediately
    expect(turnStore.activeTurn).not.toBeNull()
    expect(turnStore.activeTurn.actionType).toBe('gather')
  })

  it('routes movement updates through agent_action', () => {
    const agentStore = useAgentStore()
    const turnStore = useTurnStore()
    agentStore.setAgents([{ id: 'a1', name: 'Alice', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'communal_survival', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' }])
    routeMessage(makeMsg('agent_action', { agent_id: 'a1', action: { type: 'move', location: 'forest' } }))
    expect(agentStore.getAgent('a1')!.location).not.toBe('forest')
    expect(agentStore.getAgent('a1')!.status).toBe('idle')
    expect(turnStore.activeTurn?.targetLocation).toBe('forest')
  })

  it('routes agent_speak to socialStore', () => {
    const socialStore = useSocialStore()
    routeMessage(makeMsg('agent_speak', {
      agent_id: 'a1',
      agent_name: 'Alice',
      target: 'a2',
      message: 'Hello',
      source: 'dialogue',
    }))
    expect(socialStore.conversations).toHaveLength(1)
    expect(socialStore.conversations[0].message).toBe('Hello')
    expect(socialStore.conversations[0].source).toBe('dialogue')
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
    // Meeting is staged but not active until turn store reaches a meeting turn
    expect(socialStore.isMeetingActive).toBe(false)
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
    // Meeting stays staged (not active) — turn store would activate it
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

  it('routes agent_speech_audio to socialStore', () => {
    const socialStore = useSocialStore()
    // First create a conversation entry so the audio message has something to match
    routeMessage(makeMsg('agent_speak', { agent_id: 'a1', agent_name: 'Alice', target: 'a2', message: 'Hello' }))
    expect(socialStore.conversations).toHaveLength(1)
    expect(socialStore.conversations[0].audioStatus).toBe('idle')

    // Now route the audio status message
    routeMessage(makeMsg('agent_speech_audio', { agent_id: 'a1', round: 1, index: 0, status: 'ready', audio_url: 'https://example.com/audio.mp3' }))
    expect(socialStore.conversations[0].audioStatus).toBe('ready')
    expect(socialStore.conversations[0].audioUrl).toBe('https://example.com/audio.mp3')
  })

  it('routes experiment_end to experimentStore', () => {
    const experimentStore = useExperimentStore()
    routeMessage(makeMsg('experiment_end', { summary: 'Society collapsed' }))
    expect(experimentStore.status).toBe('completed')
  })

  it('routes step_error to uiStore (clears stepping)', () => {
    const uiStore = useUIStore()
    uiStore.setSteppingStatus('Running...')
    routeMessage(makeMsg('step_error', { error: 'timeout' }))
    expect(uiStore.steppingStatus).toBe('')
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
