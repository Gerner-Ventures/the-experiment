import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Agent, AgentConfig, AgentStatus } from '@/types/agent'
import type { AgentActionData, WSMessage } from '@/types/websocket'
import { useTurnStore } from '@/stores/turn'
import { useSocialStore } from '@/stores/social'

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
    // Preserve exiled agent IDs — round_end sync must not resurrect them
    const exiledIds = new Set<string>()
    for (const [id, agent] of agents.value) {
      if (agent.status === 'exiled') exiledIds.add(id)
    }

    agents.value.clear()
    for (const a of agentData) {
      const agent = parseAgent(a)
      if (exiledIds.has(agent.id)) continue // skip exiled agents
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

  /**
   * Handle agent_action WS message.
   * Parses the action and enqueues a turn — all side effects (movement, bubbles, HUD)
   * are handled by the turn store in sequence.
   */
  function onAction(msg: WSMessage<AgentActionData>) {
    const data = msg.data
    const agent = agents.value.get(data.agent_id)
    const socialStore = useSocialStore()
    const actionType = typeof data.action === 'string'
      ? data.action
      : (data.action?.type as string) ?? 'observe'
    const agentName = data.agent_name ?? agent?.name ?? 'Agent'

    // Extract target location from action (turn store decides if movement is needed at processing time)
    const targetLocation = typeof data.action === 'object'
      ? (data.action.location as string | undefined)
      : undefined
    const innerThought = normalizeLine(data.inner_thought)
    const speechText = normalizeLine(data.speech_text)
    const thought = data.speech_source === 'inner_thought'
      ? speechText ?? innerThought
      : innerThought
    const existingThoughtConversation = (
      data.speech_source === 'inner_thought' && thought
    )
      ? [...socialStore.conversations].reverse().find((conversation) =>
        conversation.agentId === data.agent_id
        && conversation.round === msg.round
        && conversation.source === 'inner_thought'
        && conversation.message === thought,
      )
      : null

    console.debug(`[AgentStore] onAction: ${agentName} → ${actionType}${targetLocation ? ` @ ${targetLocation}` : ''}`)

    useTurnStore().enqueue({
      agentId: data.agent_id,
      agentName,
      round: msg.round,
      actionType,
      targetLocation,
      thought,
      thoughtSource: data.speech_source ?? 'inner_thought',
      thoughtConversationId: existingThoughtConversation?.id,
      thoughtAudioIndex: existingThoughtConversation?.index,
      // Inner-thought speech rows already arrive through agent_speak.
      fromSpeakEvent: data.speech_source === 'inner_thought',
      isConsequence: data.is_consequence ?? false,
      causedBy: data.caused_by,
    })
  }

  function onAgentUpdate(agentId: string, updates: Partial<Agent>) {
    const agent = agents.value.get(agentId)
    if (agent) {
      Object.assign(agent, updates)
    }
  }

  function updateAgentStatus(agentId: string, status: AgentStatus, location?: string) {
    const agent = agents.value.get(agentId)
    if (agent) {
      agent.status = status
      if (location) agent.location = location
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
    setAgents, getAgent, onAction, onAgentUpdate, updateAgentFromDossier,
    updateAgentStatus, resetStatuses,
    $reset,
  }
})

/** Parse agent data from backend (snake_case) or legacy (camelCase) */
function parseAgent(a: Record<string, unknown>): Agent {
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
    llmModel: ((a.llm_model ?? a.llmModel) as string) || 'anthropic/claude-haiku-4-5-20251001',
    location: (a.location as string) || 'town_square',
    status: ((a.status as string) || 'idle') as AgentStatus,
    suspicionLevel: ((a.suspicion_level ?? a.suspicionLevel) as number) || 0,
    inventory: (a.inventory as string[]) || [],
    relationships: (a.relationships as Record<string, Agent['relationships'][string]>) || {},
  }
}

function normalizeLine(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}
