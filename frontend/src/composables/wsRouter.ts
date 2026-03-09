/**
 * WebSocket message routing — extracted for testability.
 *
 * Maps incoming WSMessage types to the correct Pinia store handler.
 * Both useWebSocket and tests import this single source of truth.
 */
import type {
  AgentActionData,
  AgentSpeakData,
  AgentSpeechAudioData,
  ExileResultData,
  GMAudioStatusData,
  MeetingResultData,
  MeetingSpeechData,
  MeetingStartData,
  MeetingVoteData,
  WSMessage,
  WSMessageType,
} from '@/types/websocket'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useSocialStore } from '@/stores/social'
import { useUIStore } from '@/stores/ui'

export function routeMessage(msg: WSMessage) {
  const experimentStore = useExperimentStore()
  const agentStore = useAgentStore()
  const worldStore = useWorldStore()
  const gmStore = useGMStore()
  const socialStore = useSocialStore()

  // Always log the event
  experimentStore.addEvent(msg)

  const router: Partial<Record<WSMessageType, (m: WSMessage) => void>> = {
    connected: () => { /* connection confirmed, no action needed */ },
    round_start: (m) => experimentStore.onRoundStart(m),
    round_end: (m) => experimentStore.onRoundEnd(m),
    phase_change: (m) => experimentStore.onPhaseChange(m),
    gm_plan: (m) => gmStore.onPlan(m),
    gm_narration: (m) => gmStore.onNarration(m),
    gm_audio_status: (m) => gmStore.onAudioStatus(m as unknown as WSMessage<GMAudioStatusData>),
    agent_action: (m) => agentStore.onAction(m as unknown as WSMessage<AgentActionData>),
    agent_speak: (m) => socialStore.onSpeak(m as unknown as WSMessage<AgentSpeakData>),
    agent_speech_audio: (m) => socialStore.onSpeechAudio(m as unknown as WSMessage<AgentSpeechAudioData>),
    crisis_event: (m) => worldStore.onCrisis(m),
    threat_update: (m) => worldStore.onThreatUpdate(m),
    resource_update: (m) => worldStore.onResourceUpdate(m),
    meeting_start: (m) => socialStore.onMeetingStart(m as unknown as WSMessage<MeetingStartData>),
    meeting_speech: (m) => socialStore.onMeetingSpeech(m as unknown as WSMessage<MeetingSpeechData>),
    meeting_vote: (m) => socialStore.onMeetingVote(m as unknown as WSMessage<MeetingVoteData>),
    meeting_result: (m) => socialStore.onMeetingResult(m as unknown as WSMessage<MeetingResultData>),
    faction_update: (m) => socialStore.onFactionUpdate(m),
    cult_activity: (m) => socialStore.onCultActivity(m),
    exile_vote: (m) => socialStore.onExileVote(m),
    exile_result: (m) => socialStore.onExileResult(m as unknown as WSMessage<ExileResultData>),
    observer_event: () => { /* logged by addEvent above; no handler needed yet */ },
    experiment_end: (m) => experimentStore.onEnd(m),
    step_error: () => {
      useUIStore().clearStepping()
    },
  }

  const handler = router[msg.type as WSMessageType]
  if (handler) {
    handler(msg)
  }
}
