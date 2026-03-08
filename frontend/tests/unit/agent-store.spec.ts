import { setActivePinia, createPinia } from 'pinia'
import { useAgentStore } from '@/stores/agent'
import type { AgentStatus } from '@/types/agent'

// Mock the locale module (required by turn store, which agent store imports)
jest.mock('@/locales', () => ({
  useLocale: () => ({
    hud: {
      steppingAgent: '{name}: {action}',
    },
  }),
}))

function makeRawAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent_id: 'agent-1',
    name: 'Alice',
    character_id: 'intern',
    personality: {
      axes: { paranoia: 50, empathy: 60, dominance: 40, impulsiveness: 30, loyalty: 70, ambition: 50 },
      trait_tags: ['cautious', 'analytical'],
      self_concept: 'A thoughtful person',
    },
    goal: {
      archetype: 'communal_survival',
      text: 'Keep everyone alive',
      progress_signals: ['group cooperation'],
    },
    llm_model: 'anthropic/claude-haiku-4-5-20251001',
    location: 'town_square',
    status: 'idle',
    suspicion_level: 10,
    inventory: ['flashlight'],
    relationships: {},
    ...overrides,
  }
}

describe('agent store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('updateAgentStatus', () => {
    it('updates agent status', () => {
      const store = useAgentStore()
      store.setAgents([makeRawAgent()])

      store.updateAgentStatus('agent-1', 'talking')

      const agent = store.getAgent('agent-1')
      expect(agent).toBeDefined()
      expect(agent!.status).toBe('talking')
    })

    it('updates agent status and location together', () => {
      const store = useAgentStore()
      store.setAgents([makeRawAgent({ location: 'camp' })])

      store.updateAgentStatus('agent-1', 'moving', 'forest')

      const agent = store.getAgent('agent-1')
      expect(agent!.status).toBe('moving')
      expect(agent!.location).toBe('forest')
    })

    it('does not update location when not provided', () => {
      const store = useAgentStore()
      store.setAgents([makeRawAgent({ location: 'camp' })])

      store.updateAgentStatus('agent-1', 'working')

      const agent = store.getAgent('agent-1')
      expect(agent!.status).toBe('working')
      expect(agent!.location).toBe('camp') // unchanged
    })

    it('is a no-op for unknown agent id', () => {
      const store = useAgentStore()
      store.setAgents([makeRawAgent()])

      // Should not throw
      store.updateAgentStatus('nonexistent', 'talking')

      // Original agent unchanged
      expect(store.getAgent('agent-1')!.status).toBe('idle')
    })

    it('handles all valid AgentStatus values', () => {
      const store = useAgentStore()
      const statuses: AgentStatus[] = ['idle', 'thinking', 'talking', 'moving', 'working', 'sneaking', 'exiled']

      for (const status of statuses) {
        store.setAgents([makeRawAgent()])
        store.updateAgentStatus('agent-1', status)
        expect(store.getAgent('agent-1')!.status).toBe(status)
      }
    })
  })

  describe('resetStatuses', () => {
    it('resets all agents to idle', () => {
      const store = useAgentStore()
      store.setAgents([
        makeRawAgent({ agent_id: 'a1', name: 'Alice', status: 'talking' }),
        makeRawAgent({ agent_id: 'a2', name: 'Bob', status: 'moving' }),
      ])

      store.resetStatuses()

      expect(store.getAgent('a1')!.status).toBe('idle')
      expect(store.getAgent('a2')!.status).toBe('idle')
    })
  })
})
