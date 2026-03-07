import type { PersonalityTrait } from '@/config/agent-options'

/** Personality axis names (matches backend PersonalityAxes) */
export type PersonalityAxis = 'paranoia' | 'empathy' | 'dominance' | 'impulsiveness' | 'loyalty' | 'ambition'

/** Numeric personality axes (0-100 each, matches backend PersonalityAxes) */
export type PersonalityAxes = Record<PersonalityAxis, number>

/** Full personality profile sent to backend */
export interface PersonalityProfile {
  axes: PersonalityAxes
  traitTags: string[]
  selfConcept?: string
}

/** Goal archetype (matches backend GoalArchetype) */
export type GoalArchetype =
  | 'communal_survival'
  | 'protective_attachment'
  | 'status_power'
  | 'resource_control'
  | 'escape_exit'
  | 'truth_revelation'
  | 'social_disruption'
  | 'belief_transformation'
  | 'personal_redemption'
  | 'obsession_desire'

/** Structured secret goal (matches backend SecretGoal) */
export interface SecretGoal {
  archetype: GoalArchetype
  text: string
  targetAgentId?: string
  targetLocationId?: string
  progressSignals: string[]
}

/** Agent setup configuration (before experiment starts) */
export interface AgentConfig {
  id: string
  name: string
  characterId: string
  personality: PersonalityTrait[]
  personalityAxes: PersonalityAxes
  secretGoal: string
  goalArchetype: GoalArchetype | ''
  llmModel: string
}

/** Agent status during simulation */
export type AgentStatus = 'idle' | 'thinking' | 'talking' | 'moving' | 'working' | 'sneaking' | 'exiled'

/** Trust relationship between two agents */
export interface AgentRelationship {
  trust: number // -100 to 100
  history: string[]
  notes?: string
}

/** Full agent state during experiment (matches backend EngineAgentState) */
export interface Agent {
  id: string
  name: string
  characterId: string
  personality: PersonalityProfile
  secretGoal: SecretGoal
  llmModel: string
  location: string
  status: AgentStatus
  suspicionLevel: number // 0-100
  inventory: string[]
  relationships: Record<string, AgentRelationship>
}
