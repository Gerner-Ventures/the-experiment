import type { PersonalityTrait } from '@/config/agent-options'

/** Agent setup configuration (before experiment starts) */
export interface AgentConfig {
  id: string
  name: string
  characterId: string
  personality: PersonalityTrait[]
  secretGoal: string
  llmModel: string
}

/** Agent status during simulation */
export type AgentStatus = 'idle' | 'thinking' | 'talking' | 'moving' | 'working' | 'sneaking' | 'exiled'

/** Trust relationship between two agents */
export interface AgentRelationship {
  trust: number // -100 to 100
  notes: string
}

/** Agent personality descriptor */
export interface AgentPersonality {
  traits: PersonalityTrait[]
  description: string
}

/** Full agent state during experiment (matches shared/schemas/agent.json) */
export interface Agent {
  id: string
  name: string
  characterId: string
  personality: AgentPersonality
  secretGoal: string
  llmModel: string
  location: string
  status: AgentStatus
  suspicionLevel: number // 0-100
  inventory: string[]
  relationships: Record<string, AgentRelationship>
}
