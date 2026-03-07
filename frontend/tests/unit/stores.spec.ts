import { setActivePinia, createPinia } from 'pinia'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useSocialStore } from '@/stores/social'
import { useUIStore } from '@/stores/ui'
import type { WSMessage } from '@/types/websocket'

/** Helper to create a WSMessage with minimal required fields */
function makeMsg<T = Record<string, unknown>>(
  overrides: Partial<WSMessage<T>> & { data: T },
): WSMessage<T> {
  return {
    type: 'round_start',
    round: 1,
    timestamp: '2026-03-07T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// experimentStore
// ---------------------------------------------------------------------------
describe('experimentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has correct defaults', () => {
    const store = useExperimentStore()
    expect(store.id).toBeNull()
    expect(store.name).toBe('')
    expect(store.status).toBe('setup')
    expect(store.currentRound).toBe(0)
    expect(store.totalRounds).toBe(15)
    expect(store.currentPhase).toBeNull()
    expect(store.cooperationRatio).toBe(0.5)
    expect(store.events).toEqual([])
  })

  describe('setExperiment', () => {
    it('populates all fields', () => {
      const store = useExperimentStore()
      store.setExperiment({
        id: 'exp-1',
        name: 'Test Run',
        status: 'running',
        currentRound: 3,
        totalRounds: 10,
      })
      expect(store.id).toBe('exp-1')
      expect(store.name).toBe('Test Run')
      expect(store.status).toBe('running')
      expect(store.currentRound).toBe(3)
      expect(store.totalRounds).toBe(10)
    })
  })

  describe('computed properties', () => {
    it('isRunning reflects status', () => {
      const store = useExperimentStore()
      expect(store.isRunning).toBe(false)
      store.setExperiment({ id: 'x', name: '', status: 'running', currentRound: 0, totalRounds: 10 })
      expect(store.isRunning).toBe(true)
    })

    it('isComplete is true for completed or collapsed', () => {
      const store = useExperimentStore()
      store.setExperiment({ id: 'x', name: '', status: 'completed', currentRound: 0, totalRounds: 10 })
      expect(store.isComplete).toBe(true)
      store.setExperiment({ id: 'x', name: '', status: 'collapsed', currentRound: 0, totalRounds: 10 })
      expect(store.isComplete).toBe(true)
      store.setExperiment({ id: 'x', name: '', status: 'running', currentRound: 0, totalRounds: 10 })
      expect(store.isComplete).toBe(false)
    })

    it('progress computes ratio', () => {
      const store = useExperimentStore()
      store.setExperiment({ id: 'x', name: '', status: 'running', currentRound: 5, totalRounds: 10 })
      expect(store.progress).toBe(0.5)
    })

    it('progress is 0 when totalRounds is 0', () => {
      const store = useExperimentStore()
      store.setExperiment({ id: 'x', name: '', status: 'running', currentRound: 0, totalRounds: 0 })
      expect(store.progress).toBe(0)
    })
  })

  describe('onRoundStart', () => {
    it('updates currentRound, sets running, and adds event', () => {
      const store = useExperimentStore()
      store.onRoundStart(makeMsg({ type: 'round_start', data: { round: 4, total_rounds: 15 } }))
      expect(store.currentRound).toBe(4)
      expect(store.status).toBe('running')
      expect(store.events).toHaveLength(1)
      expect(store.events[0].type).toBe('round_start')
    })
  })

  describe('onRoundEnd', () => {
    it('updates cooperationRatio and adds event', () => {
      const store = useExperimentStore()
      store.onRoundEnd(makeMsg({ type: 'round_end', data: { cooperation_ratio: 0.8, threat_level: 30 } }))
      expect(store.cooperationRatio).toBe(0.8)
      expect(store.events).toHaveLength(1)
    })
  })

  describe('onPhaseChange', () => {
    it('sets currentPhase', () => {
      const store = useExperimentStore()
      store.onPhaseChange(makeMsg({ type: 'phase_change', data: { phase: 'dawn' } }))
      expect(store.currentPhase).toBe('dawn')
      expect(store.events).toHaveLength(1)
    })
  })

  describe('onEnd', () => {
    it('sets status to completed', () => {
      const store = useExperimentStore()
      store.onEnd(makeMsg({ type: 'experiment_end', data: { summary: 'Game over' } }))
      expect(store.status).toBe('completed')
      expect(store.events).toHaveLength(1)
    })
  })

  describe('addEvent', () => {
    it('uses summary field when available', () => {
      const store = useExperimentStore()
      store.addEvent(makeMsg({ data: { summary: 'Something happened' } }))
      expect(store.events[0].summary).toBe('Something happened')
    })

    it('falls back to text field', () => {
      const store = useExperimentStore()
      store.addEvent(makeMsg({ data: { text: 'Hello world' } }))
      expect(store.events[0].summary).toBe('Hello world')
    })

    it('falls back to msg.type', () => {
      const store = useExperimentStore()
      store.addEvent(makeMsg({ type: 'crisis_event', data: {} }))
      expect(store.events[0].summary).toBe('crisis_event')
    })

    it('caps events at 500', () => {
      const store = useExperimentStore()
      for (let i = 0; i < 510; i++) {
        store.addEvent(makeMsg({ data: { summary: `evt-${i}` } }))
      }
      expect(store.events.length).toBe(500)
      // The oldest events should have been trimmed
      expect(store.events[0].summary).toBe('evt-10')
    })
  })

  describe('$reset', () => {
    it('restores defaults', () => {
      const store = useExperimentStore()
      store.setExperiment({ id: 'x', name: 'Test', status: 'running', currentRound: 5, totalRounds: 20 })
      store.addEvent(makeMsg({ data: { summary: 'test' } }))
      store.$reset()
      expect(store.id).toBeNull()
      expect(store.name).toBe('')
      expect(store.status).toBe('setup')
      expect(store.currentRound).toBe(0)
      expect(store.totalRounds).toBe(15)
      expect(store.events).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// agentStore
// ---------------------------------------------------------------------------
describe('agentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const sampleAgents = [
    { id: 'a1', name: 'Alice', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'communal_survival', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' },
    { id: 'a2', name: 'Bob', personality: { axes: {}, traitTags: [] }, goal: { archetype: 'status_power', text: '', progressSignals: [] }, llmModel: 'openai/gpt-4o-mini' },
  ]

  describe('setAgents', () => {
    it('populates agents map', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      expect(store.agentCount).toBe(2)
      expect(store.agentList).toHaveLength(2)
    })

    it('clears existing agents before setting', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.setAgents([sampleAgents[0]])
      expect(store.agentCount).toBe(1)
    })
  })

  describe('getAgent', () => {
    it('returns agent by id', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      const agent = store.getAgent('a1')
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('Alice')
    })

    it('returns undefined for unknown id', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      expect(store.getAgent('nonexistent')).toBeUndefined()
    })
  })

  describe('onAction', () => {
    it('sets agent status based on action type', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.onAction(makeMsg({ type: 'agent_action', data: { agent_id: 'a1', action: 'talk', summary: 'chatting' } }))
      expect(store.getAgent('a1')!.status).toBe('talking')
    })

    it('maps gather to working', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.onAction(makeMsg({ type: 'agent_action', data: { agent_id: 'a1', action: 'gather', summary: '' } }))
      expect(store.getAgent('a1')!.status).toBe('working')
    })

    it('maps sabotage to sneaking', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.onAction(makeMsg({ type: 'agent_action', data: { agent_id: 'a1', action: 'sabotage', summary: '' } }))
      expect(store.getAgent('a1')!.status).toBe('sneaking')
    })

    it('defaults unknown actions to idle', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.onAction(makeMsg({ type: 'agent_action', data: { agent_id: 'a1', action: 'unknown_thing', summary: '' } }))
      expect(store.getAgent('a1')!.status).toBe('idle')
    })

    it('does nothing for unknown agent_id', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      // Should not throw
      store.onAction(makeMsg({ type: 'agent_action', data: { agent_id: 'ghost', action: 'talk', summary: '' } }))
      expect(store.agentCount).toBe(2)
    })
  })

  describe('onMove', () => {
    it('updates agent location and sets status to moving', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.onMove(makeMsg({ type: 'agent_move', data: { agent_id: 'a1', location: 'beach' } }))
      const agent = store.getAgent('a1')!
      expect(agent.location).toBe('beach')
      expect(agent.status).toBe('moving')
    })
  })

  describe('resetStatuses', () => {
    it('sets all agents to idle', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.onAction(makeMsg({ type: 'agent_action', data: { agent_id: 'a1', action: 'talk', summary: '' } }))
      store.onMove(makeMsg({ type: 'agent_move', data: { agent_id: 'a2', location: 'forest' } }))
      store.resetStatuses()
      expect(store.getAgent('a1')!.status).toBe('idle')
      expect(store.getAgent('a2')!.status).toBe('idle')
    })
  })

  describe('$reset', () => {
    it('clears all agents', () => {
      const store = useAgentStore()
      store.setAgents(sampleAgents)
      store.$reset()
      expect(store.agentCount).toBe(0)
      expect(store.agentList).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// worldStore
// ---------------------------------------------------------------------------
describe('worldStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has correct defaults', () => {
    const store = useWorldStore()
    expect(store.resources).toEqual({ food: 24, water: 30, materials: 14, power: 10 })
    expect(store.threatLevel).toBe(0)
    expect(store.currentPhase).toBeNull()
    expect(store.activeCrisis).toBeNull()
  })

  describe('setResources', () => {
    it('replaces resources object', () => {
      const store = useWorldStore()
      store.setResources({ food: 10, water: 10, materials: 10, power: 10 })
      expect(store.resources.food).toBe(10)
    })
  })

  describe('onResourceUpdate', () => {
    it('updates individual resource fields', () => {
      const store = useWorldStore()
      store.onResourceUpdate(makeMsg({ type: 'resource_update', data: { food: 5, water: 20 } }))
      expect(store.resources.food).toBe(5)
      expect(store.resources.water).toBe(20)
      // Unchanged fields keep defaults
      expect(store.resources.materials).toBe(14)
      expect(store.resources.power).toBe(10)
    })
  })

  describe('onThreatUpdate', () => {
    it('updates threat level', () => {
      const store = useWorldStore()
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 55 } }))
      expect(store.threatLevel).toBe(55)
    })
  })

  describe('onCrisis', () => {
    it('sets activeCrisis', () => {
      const store = useWorldStore()
      store.onCrisis(makeMsg({
        type: 'crisis_event',
        data: { type: 'environmental', description: 'Storm incoming', severity: 'high', affects: ['beach'] },
      }))
      expect(store.activeCrisis).toEqual({
        type: 'environmental',
        description: 'Storm incoming',
        severity: 'high',
        affects: ['beach'],
      })
    })
  })

  describe('threatColor computed', () => {
    it('returns green for low threat', () => {
      const store = useWorldStore()
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 10 } }))
      expect(store.threatColor).toBe('#00e5a0')
    })

    it('returns yellow for moderate threat', () => {
      const store = useWorldStore()
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 30 } }))
      expect(store.threatColor).toBe('#f5c542')
    })

    it('returns orange for high threat', () => {
      const store = useWorldStore()
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 60 } }))
      expect(store.threatColor).toBe('#ff6b35')
    })

    it('returns red for critical threat', () => {
      const store = useWorldStore()
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 80 } }))
      expect(store.threatColor).toBe('#ff2d55')
    })
  })

  describe('isCollapsing computed', () => {
    it('is true when threat >= 80', () => {
      const store = useWorldStore()
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 80 } }))
      expect(store.isCollapsing).toBe(true)
    })

    it('is false when threat < 80', () => {
      const store = useWorldStore()
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 79 } }))
      expect(store.isCollapsing).toBe(false)
    })
  })

  describe('$reset', () => {
    it('restores defaults', () => {
      const store = useWorldStore()
      store.setResources({ food: 0, water: 0, materials: 0, power: 0 })
      store.onThreatUpdate(makeMsg({ type: 'threat_update', data: { threat_level: 90 } }))
      store.$reset()
      expect(store.resources).toEqual({ food: 24, water: 30, materials: 14, power: 10 })
      expect(store.threatLevel).toBe(0)
      expect(store.activeCrisis).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// gmStore
// ---------------------------------------------------------------------------
describe('gmStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has correct defaults', () => {
    const store = useGMStore()
    expect(store.currentPlan).toBeNull()
    expect(store.narrationText).toBe('')
    expect(store.showPlanPanel).toBe(false)
    expect(store.showNarration).toBe(false)
    expect(store.planApproved).toBe(false)
  })

  describe('onPlan', () => {
    it('sets currentPlan and shows panel', () => {
      const store = useGMStore()
      store.onPlan(makeMsg({
        type: 'gm_plan',
        data: {
          round: 3,
          round_theme: 'Scarcity',
          reasoning: 'Resources running low',
          crisis_event: { type: 'resource', description: 'Drought', severity: 'medium', affects: [] },
          resource_modifiers: { food: -5 },
          narration: 'The sun beats down mercilessly...',
          meta_hint: null,
        },
      }))
      expect(store.currentPlan).not.toBeNull()
      expect(store.currentPlan!.round).toBe(3)
      expect(store.currentPlan!.roundTheme).toBe('Scarcity')
      expect(store.currentPlan!.narration).toBe('The sun beats down mercilessly...')
      expect(store.showPlanPanel).toBe(true)
      expect(store.planApproved).toBe(false)
    })
  })

  describe('onNarration', () => {
    it('sets narration text and shows it', () => {
      const store = useGMStore()
      store.onNarration(makeMsg({ type: 'gm_narration', data: { text: 'Night falls over the island.' } }))
      expect(store.narrationText).toBe('Night falls over the island.')
      expect(store.showNarration).toBe(true)
    })
  })

  describe('approvePlan', () => {
    it('marks plan as approved and hides panel', () => {
      const store = useGMStore()
      store.onPlan(makeMsg({
        type: 'gm_plan',
        data: {
          round: 1,
          round_theme: 'Calm',
          reasoning: '',
          crisis_event: { type: 'resource', description: '', severity: 'low', affects: [] },
          resource_modifiers: {},
          narration: '',
          meta_hint: null,
        },
      }))
      store.approvePlan()
      expect(store.planApproved).toBe(true)
      expect(store.showPlanPanel).toBe(false)
    })
  })

  describe('dismissNarration', () => {
    it('hides narration', () => {
      const store = useGMStore()
      store.onNarration(makeMsg({ type: 'gm_narration', data: { text: 'Hello' } }))
      store.dismissNarration()
      expect(store.showNarration).toBe(false)
    })
  })

  describe('$reset', () => {
    it('restores defaults', () => {
      const store = useGMStore()
      store.onNarration(makeMsg({ type: 'gm_narration', data: { text: 'Hello' } }))
      store.$reset()
      expect(store.currentPlan).toBeNull()
      expect(store.narrationText).toBe('')
      expect(store.showPlanPanel).toBe(false)
      expect(store.showNarration).toBe(false)
      expect(store.planApproved).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// socialStore
// ---------------------------------------------------------------------------
describe('socialStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has correct defaults', () => {
    const store = useSocialStore()
    expect(store.conversations).toEqual([])
    expect(store.meeting).toBeNull()
    expect(store.isMeetingActive).toBe(false)
  })

  describe('onSpeak', () => {
    it('adds a conversation message', () => {
      const store = useSocialStore()
      store.onSpeak(makeMsg({
        type: 'agent_speak',
        data: { agent_id: 'a1', agent_name: 'Alice', target: 'a2', message: 'Hi Bob' },
      }))
      expect(store.conversations).toHaveLength(1)
      expect(store.conversations[0].agentName).toBe('Alice')
      expect(store.conversations[0].message).toBe('Hi Bob')
    })

    it('caps at 100 messages', () => {
      const store = useSocialStore()
      for (let i = 0; i < 110; i++) {
        store.onSpeak(makeMsg({
          type: 'agent_speak',
          data: { agent_id: 'a1', agent_name: 'Alice', target: 'a2', message: `msg-${i}` },
        }))
      }
      expect(store.conversations.length).toBe(100)
      expect(store.conversations[0].message).toBe('msg-10')
    })

    it('recentConversations returns last 20', () => {
      const store = useSocialStore()
      for (let i = 0; i < 30; i++) {
        store.onSpeak(makeMsg({
          type: 'agent_speak',
          data: { agent_id: 'a1', agent_name: 'Alice', target: 'a2', message: `msg-${i}` },
        }))
      }
      expect(store.recentConversations).toHaveLength(20)
      expect(store.recentConversations[0].message).toBe('msg-10')
    })
  })

  describe('onMeetingStart', () => {
    it('initializes meeting state', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg({
        type: 'meeting_start',
        data: { proposal: 'Should we ration food?' },
      }))
      expect(store.meeting).not.toBeNull()
      expect(store.meeting!.proposal).toBe('Should we ration food?')
      expect(store.meeting!.active).toBe(true)
      expect(store.meeting!.votes).toEqual({})
      expect(store.meeting!.speeches).toEqual([])
      expect(store.meeting!.result).toBeNull()
      expect(store.isMeetingActive).toBe(true)
    })
  })

  describe('onMeetingVote', () => {
    it('records a vote', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg({ type: 'meeting_start', data: { proposal: 'test' } }))
      store.onMeetingVote(makeMsg({ type: 'meeting_vote', data: { agent_id: 'a1', vote: 'agree' } }))
      expect(store.meeting!.votes['a1']).toBe('agree')
    })

    it('does nothing if no meeting', () => {
      const store = useSocialStore()
      // Should not throw
      store.onMeetingVote(makeMsg({ type: 'meeting_vote', data: { agent_id: 'a1', vote: 'agree' } }))
      expect(store.meeting).toBeNull()
    })
  })

  describe('onMeetingResult', () => {
    it('finalizes meeting with result and deactivates', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg({ type: 'meeting_start', data: { proposal: 'test' } }))
      store.onMeetingResult(makeMsg({
        type: 'meeting_result',
        data: { summary: 'Proposal passed', votes: { a1: 'agree', a2: 'disagree' } },
      }))
      expect(store.meeting!.result).toBe('Proposal passed')
      expect(store.meeting!.votes).toEqual({ a1: 'agree', a2: 'disagree' })
      expect(store.meeting!.active).toBe(false)
      expect(store.isMeetingActive).toBe(false)
    })
  })

  describe('dismissMeeting', () => {
    it('deactivates meeting', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg({ type: 'meeting_start', data: { proposal: 'test' } }))
      store.dismissMeeting()
      expect(store.meeting!.active).toBe(false)
    })

    it('does nothing when no meeting exists', () => {
      const store = useSocialStore()
      // Should not throw
      store.dismissMeeting()
      expect(store.meeting).toBeNull()
    })
  })

  describe('$reset', () => {
    it('restores defaults', () => {
      const store = useSocialStore()
      store.onSpeak(makeMsg({
        type: 'agent_speak',
        data: { agent_id: 'a1', agent_name: 'Alice', target: 'a2', message: 'Hi' },
      }))
      store.onMeetingStart(makeMsg({ type: 'meeting_start', data: { proposal: 'test' } }))
      store.$reset()
      expect(store.conversations).toEqual([])
      expect(store.meeting).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// uiStore
// ---------------------------------------------------------------------------
describe('uiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has correct defaults', () => {
    const store = useUIStore()
    expect(store.selectedAgentId).toBeNull()
    expect(store.activePanel).toBe('none')
    expect(store.playbackSpeed).toBe(1)
    expect(store.isPlaying).toBe(false)
    expect(store.hasSelectedAgent).toBe(false)
  })

  describe('selectAgent', () => {
    it('sets selected agent and opens dossier panel', () => {
      const store = useUIStore()
      store.selectAgent('a1')
      expect(store.selectedAgentId).toBe('a1')
      expect(store.activePanel).toBe('dossier')
      expect(store.hasSelectedAgent).toBe(true)
    })
  })

  describe('deselectAgent', () => {
    it('clears selection and closes dossier panel', () => {
      const store = useUIStore()
      store.selectAgent('a1')
      store.deselectAgent()
      expect(store.selectedAgentId).toBeNull()
      expect(store.activePanel).toBe('none')
      expect(store.hasSelectedAgent).toBe(false)
    })

    it('keeps non-dossier panel open on deselect', () => {
      const store = useUIStore()
      store.selectAgent('a1')
      store.setPanel('log')
      store.deselectAgent()
      expect(store.selectedAgentId).toBeNull()
      expect(store.activePanel).toBe('log')
    })
  })

  describe('setPanel', () => {
    it('sets active panel', () => {
      const store = useUIStore()
      store.setPanel('gm-plan')
      expect(store.activePanel).toBe('gm-plan')
    })
  })

  describe('togglePanel', () => {
    it('opens panel when currently none', () => {
      const store = useUIStore()
      store.togglePanel('log')
      expect(store.activePanel).toBe('log')
    })

    it('closes panel when toggling same panel', () => {
      const store = useUIStore()
      store.setPanel('log')
      store.togglePanel('log')
      expect(store.activePanel).toBe('none')
    })

    it('switches to different panel', () => {
      const store = useUIStore()
      store.setPanel('log')
      store.togglePanel('meeting')
      expect(store.activePanel).toBe('meeting')
    })
  })

  describe('togglePlaying', () => {
    it('toggles isPlaying', () => {
      const store = useUIStore()
      expect(store.isPlaying).toBe(false)
      store.togglePlaying()
      expect(store.isPlaying).toBe(true)
      store.togglePlaying()
      expect(store.isPlaying).toBe(false)
    })
  })

  describe('$reset', () => {
    it('restores defaults', () => {
      const store = useUIStore()
      store.selectAgent('a1')
      store.togglePlaying()
      store.$reset()
      expect(store.selectedAgentId).toBeNull()
      expect(store.activePanel).toBe('none')
      expect(store.playbackSpeed).toBe(1)
      expect(store.isPlaying).toBe(false)
    })
  })
})
