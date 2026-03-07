/** Action types an agent can perform */
export type ActionType =
  // Cooperative
  | 'move' | 'gather' | 'repair' | 'trade' | 'talk'
  | 'vote' | 'rest' | 'observe' | 'heal'
  // Selfish
  | 'hoard' | 'sabotage' | 'explore' | 'accuse' | 'steal' | 'scheme'
  // Aggressive
  | 'attack' | 'threaten' | 'stab' | 'shoot' | 'poison'
  // Social / expressive
  | 'dance' | 'pray' | 'rally' | 'mourn' | 'celebrate' | 'argue'
  // Biological (dark humor)
  | 'pee' | 'poop' | 'vomit' | 'sleep' | 'eat' | 'drink'
  // Meta
  | 'investigate' | 'monologue' | 'panic' | 'breakdown'

/** Cooperation intent level */
export type CooperationIntent = 'high' | 'medium' | 'low' | 'none'

/** An action chosen by an agent */
export interface AgentAction {
  type: ActionType
  target?: string
  location?: string
}

/** Dialogue from an agent to another */
export interface AgentDialogue {
  target: string
  message: string
}

/** Structured decision output from an agent's LLM (matches shared/schemas/agent_decision.json) */
export interface AgentDecision {
  innerThought: string
  suspicion: string | null
  action: AgentAction
  dialogue: AgentDialogue | null
  goalProgress: string
  cooperationIntent: CooperationIntent
}
