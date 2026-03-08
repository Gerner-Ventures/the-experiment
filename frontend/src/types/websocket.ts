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
  data: T
}

/** Narration audio status from backend TTS pipeline */
export type NarrationAudioStatus = 'pending' | 'ready' | 'error' | 'unavailable'

/** Payload for gm_audio_status WebSocket message */
export interface GMAudioStatusData {
  status: NarrationAudioStatus
  audio_url?: string
  error?: string
}

/** Payload for agent_speech_audio WebSocket message */
export interface AgentSpeechAudioData {
  agent_id: string
  round: number
  index: number
  status: NarrationAudioStatus
  audio_url: string | null
}
