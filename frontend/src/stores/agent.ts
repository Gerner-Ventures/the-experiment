import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Agent, AgentConfig, AgentStatus } from '@/types/agent'
import type { WSMessage } from '@/types/websocket'

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<Map<string, Agent>>(new Map())

  const agentList = computed(() => Array.from(agents.value.values()))
  const agentCount = computed(() => agents.value.size)

  /** Agent data mapped to AgentConfig format for PixiWorld rendering */
  const agentConfigs = computed<AgentConfig[]>(() =>
    agentList.value.map(a => ({
      id: a.id,
      name: a.name,
      characterId: a.characterId,
      personality: a.personality.traitTags as AgentConfig['personality'],
      personalityAxes: a.personality.axes,
      secretGoal: a.secretGoal.text,
      goalArchetype: a.secretGoal.archetype,
      llmModel: a.llmModel,
    }))
  )

  function setAgents(agentData: Array<Record<string, unknown>>) {
    agents.value.clear()
    for (const a of agentData) {
      const agent = parseAgent(a)
      agents.value.set(agent.id, agent)
    }
  }

  function updateAgentFromDossier(agentId: string, data: Record<string, unknown>) {
    const existing = agents.value.get(agentId)
    if (!existing) return
    const updated = parseAgent(data)
    Object.assign(existing, updated)
  }

  function getAgent(id: string): Agent | undefined {
    return agents.value.get(id)
  }

  function onAction(msg: WSMessage) {
    const data = msg.data as { agent_id: string; action: string; summary: string }
    const agent = agents.value.get(data.agent_id)
    if (agent) {
      agent.status = actionToStatus(data.action)
    }
  }

  function onMove(msg: WSMessage) {
    const data = msg.data as { agent_id: string; location: string }
    const agent = agents.value.get(data.agent_id)
    if (agent) {
      agent.location = data.location
      agent.status = 'moving'
    }
  }

  function onAgentUpdate(agentId: string, updates: Partial<Agent>) {
    const agent = agents.value.get(agentId)
    if (agent) {
      Object.assign(agent, updates)
    }
  }

  function resetStatuses() {
    for (const agent of agents.value.values()) {
      agent.status = 'idle'
    }
  }

  function $reset() {
    agents.value.clear()
  }

  return {
    agents, agentList, agentConfigs, agentCount,
    setAgents, getAgent, onAction, onMove, onAgentUpdate, updateAgentFromDossier, resetStatuses,
    $reset,
  }
})

/** Parse agent data from backend (snake_case) or legacy (camelCase) */
function parseAgent(a: Record<string, unknown>): Agent {
  // Handle both snake_case (backend) and camelCase (legacy)
  const personality = a.personality as Record<string, unknown> | undefined
  const goal = a.goal as Record<string, unknown> | undefined

  return {
    id: (a.agent_id ?? a.id) as string,
    name: a.name as string,
    characterId: ((a.character_id ?? a.characterId) as string) || '',
    personality: {
      axes: (personality?.axes as Agent['personality']['axes']) ?? {} as Agent['personality']['axes'],
      traitTags: ((personality?.trait_tags ?? personality?.traitTags) as string[]) || [],
      selfConcept: (personality?.self_concept ?? personality?.selfConcept) as string | undefined,
    },
    secretGoal: {
      archetype: ((goal?.archetype as string) || 'communal_survival') as Agent['secretGoal']['archetype'],
      text: (goal?.text as string) || '',
      targetAgentId: (goal?.target_agent_id ?? goal?.targetAgentId) as string | undefined,
      targetLocationId: (goal?.target_location_id ?? goal?.targetLocationId) as string | undefined,
      progressSignals: ((goal?.progress_signals ?? goal?.progressSignals) as string[]) || [],
    },
    llmModel: ((a.llm_model ?? a.llmModel) as string) || 'openai/gpt-4o-mini',
    location: (a.location as string) || 'town_square',
    status: ((a.status as string) || 'idle') as AgentStatus,
    suspicionLevel: ((a.suspicion_level ?? a.suspicionLevel) as number) || 0,
    inventory: (a.inventory as string[]) || [],
    relationships: (a.relationships as Record<string, Agent['relationships'][string]>) || {},
  }
}

function actionToStatus(action: string): AgentStatus {
  switch (action) {
    case 'talk': case 'trade': case 'accuse': return 'talking'
    case 'move': case 'explore': return 'moving'
    case 'gather': case 'repair': return 'working'
    case 'hoard': case 'sabotage': return 'sneaking'
    default: return 'idle'
  }
}
