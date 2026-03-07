/** WebSocket message types (matches shared/schemas/ws_message.json) */
export type WSMessageType =
  | 'connected'
  | 'round_start' | 'round_end'
  | 'phase_change'
  | 'gm_plan' | 'gm_narration'
  | 'agent_action' | 'agent_move' | 'agent_speak'
  | 'crisis_event'
  | 'meeting_start' | 'meeting_speech' | 'meeting_vote' | 'meeting_result'
  | 'faction_update' | 'cult_activity'
  | 'exile_vote' | 'exile_result'
  | 'threat_update' | 'resource_update'
  | 'observer_event'
  | 'experiment_end'

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
