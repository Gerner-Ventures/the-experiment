/** WebSocket message types (matches shared/schemas/ws_message.json) */
export type WSMessageType =
  | 'connected'
  | 'round_start' | 'round_end'
  | 'phase_change'
  | 'gm_plan' | 'gm_narration' | 'gm_audio_status'
  | 'agent_action' | 'agent_speak' | 'agent_speech_audio'
  | 'crisis_event'
  | 'meeting_start' | 'meeting_speech' | 'meeting_vote' | 'meeting_result'
  | 'faction_update' | 'cult_activity'
  | 'exile_vote' | 'exile_result'
  | 'threat_update' | 'resource_update'
  | 'observer_event'
  | 'experiment_end'
  | 'step_error'

/** Round phase identifiers */
export type RoundPhase = 'gm_plan' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'night'

/** Real-time WebSocket message envelope */
export interface WSMessage<T = Record<string, unknown>> {
  type: WSMessageType
  round: number
  phase?: RoundPhase
  timestamp: string
  /** True when the event is a system-generated consequence, not an agent decision */
  is_consequence?: boolean
  data: T
}

/** Narration audio status from backend TTS pipeline */
export type NarrationAudioStatus = 'pending' | 'ready' | 'error' | 'unavailable'

export type AgentSpeechSource = 'inner_thought' | 'dialogue'

export interface AgentActionData {
  agent_id: string
  agent_name?: string
  action: Record<string, unknown> | string
  inner_thought?: string
  speech_text?: string | null
  speech_source?: AgentSpeechSource | null
  dialogue?: string | { message?: string | null; target?: string | null } | null
  cooperation_intent?: string
  /** True when this action is a system-generated consequence (bleeding, injured, etc.) */
  is_consequence?: boolean
  /** The agent who caused this consequence (only set when is_consequence is true) */
  caused_by?: string
}

export interface AgentSpeakData {
  agent_id: string
  agent_name: string
  target?: string
  message: string
  source?: AgentSpeechSource
}

/** Payload for gm_audio_status WebSocket message */
export interface GMAudioStatusData {
  status: NarrationAudioStatus
  narration_id: string
  audio_url?: string | null
  error?: string
}

/** Payload for agent_speech_audio WebSocket message */
export interface AgentSpeechAudioData {
  agent_id: string
  round: number
  index: number
  source?: AgentSpeechSource
  status: NarrationAudioStatus
  audio_url: string | null
}

// ─── Meeting message payloads ───

export interface MeetingStartData {
  proposal: string
}

export interface MeetingSpeechData {
  agent_id: string
  agent_name?: string
  content: string
  text?: string
  stance?: string
}

export interface MeetingVoteData {
  agent_id: string
  agent_name?: string
  vote: string
}

export interface MeetingResultData {
  summary: string
  votes: Record<string, string>
  tally?: Record<string, number>
  passed?: boolean
}

// ─── Faction / exile payloads ───

export interface FactionUpdateData {
  faction_id?: string
  name?: string
  [key: string]: unknown
}

export interface CultActivityData {
  cult_name?: string
  ritual?: string
  [key: string]: unknown
}

export interface ExileVoteData {
  target_agent?: string
  votes?: Record<string, string>
  [key: string]: unknown
}

export interface ExileResultData {
  target_agent?: string
  exiled?: boolean
  exiled_agent_id?: string
  outcome?: string
  [key: string]: unknown
}

// ─── Round / world payloads ───

export interface RoundEndData {
  status: string
  current_round: number
  total_rounds: number
  threat_level: number
  resources: Record<string, number>
  agents: Record<string, unknown>[]
}

export interface CrisisEventData {
  type: string
  description: string
  severity: string
  affects?: string[]
}

export interface ThreatUpdateData {
  threat_level: number
}

export interface StepErrorData {
  error?: string
  message?: string
}
