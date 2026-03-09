import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  AgentSpeakData,
  AgentSpeechAudioData,
  AgentSpeechSource,
  WSMessage,
} from '@/types/websocket'

export type AudioStatus = 'idle' | 'pending' | 'ready' | 'error' | 'unavailable'

export interface ConversationMessage {
  id: number
  agentId: string
  agentName: string
  target: string
  message: string
  source: AgentSpeechSource
  timestamp: string
  round: number
  index: number
  audioStatus: AudioStatus
  audioUrl: string | null
}

export interface MeetingState {
  proposal: string
  votes: Record<string, string>
  speeches: Array<{ agentId: string; text: string }>
  result: string | null
  active: boolean
}

export interface ConversationRef {
  id: number
  index: number
}

function audioEntryKey(
  agentId: string,
  round: number,
  index: number,
  source?: AgentSpeechSource,
) {
  return `${agentId}:${round}:${index}:${source ?? '*'}`
}

let msgCounter = 0

export const useSocialStore = defineStore('social', () => {
  const conversations = ref<ConversationMessage[]>([])
  const meeting = ref<MeetingState | null>(null)
  const queuedAudio = ref<Record<string, AgentSpeechAudioData>>({})

  const recentConversations = computed(() =>
    conversations.value.slice(-20)
  )

  const isMeetingActive = computed(() => meeting.value?.active ?? false)

  function onSpeak(msg: WSMessage<AgentSpeakData>) {
    const data = msg.data
    addConversation(
      data.agent_id,
      data.agent_name,
      data.message,
      data.target ?? '',
      msg.timestamp,
      msg.round,
      data.source ?? 'dialogue',
    )
  }

  function addConversation(
    agentId: string,
    agentName: string,
    message: string,
    target = '',
    timestamp?: string,
    round = 0,
    source: AgentSpeechSource = 'dialogue',
  ): ConversationRef {
    // Compute index: count of messages from the same agent in the same round
    const index = conversations.value.filter(
      (c) => c.agentId === agentId && c.round === round,
    ).length
    const conversation: ConversationMessage = {
      id: ++msgCounter,
      agentId,
      agentName,
      target,
      message,
      source,
      timestamp: timestamp ?? new Date().toISOString(),
      round,
      index,
      audioStatus: 'idle',
      audioUrl: null,
    }
    conversations.value.push(conversation)
    reconcileQueuedAudio(conversation)
    if (conversations.value.length > 100) {
      conversations.value = conversations.value.slice(-100)
    }
    return { id: conversation.id, index: conversation.index }
  }

  function applySpeechAudio(entry: ConversationMessage, data: AgentSpeechAudioData) {
    entry.audioStatus = data.status
    entry.audioUrl = data.audio_url ?? null
  }

  function reconcileQueuedAudio(entry: ConversationMessage) {
    const exactKey = audioEntryKey(entry.agentId, entry.round, entry.index, entry.source)
    const wildcardKey = audioEntryKey(entry.agentId, entry.round, entry.index)
    const queued = queuedAudio.value[exactKey] ?? queuedAudio.value[wildcardKey]
    if (!queued) return
    applySpeechAudio(entry, queued)
    delete queuedAudio.value[exactKey]
    delete queuedAudio.value[wildcardKey]
  }

  function onSpeechAudio(msg: WSMessage<AgentSpeechAudioData>) {
    const data = msg.data
    const entry = conversations.value.find(
      (c) =>
        c.agentId === data.agent_id
        && c.round === data.round
        && c.index === data.index
        && (!data.source || c.source === data.source),
    )
    if (entry) {
      applySpeechAudio(entry, data)
    } else {
      queuedAudio.value[audioEntryKey(data.agent_id, data.round, data.index, data.source)] = data
      console.warn('[Social] Missing conversation entry for audio update', data)
    }
  }

  function onMeetingStart(msg: WSMessage) {
    const data = msg.data as { proposal: string }
    meeting.value = {
      proposal: data.proposal,
      votes: {},
      speeches: [],
      result: null,
      active: true,
    }
  }

  function onMeetingSpeech(msg: WSMessage) {
    const data = msg.data as { agent_id: string; text: string }
    if (meeting.value) {
      meeting.value.speeches.push({
        agentId: data.agent_id,
        text: data.text,
      })
    }
  }

  function onMeetingVote(msg: WSMessage) {
    const data = msg.data as { agent_id: string; vote: string }
    if (meeting.value) {
      meeting.value.votes[data.agent_id] = data.vote
    }
  }

  function onMeetingResult(msg: WSMessage) {
    const data = msg.data as { summary: string; votes: Record<string, string> }
    if (meeting.value) {
      meeting.value.result = data.summary
      meeting.value.votes = data.votes
      meeting.value.active = false
    }
  }

  // Faction, cult, and exile events
  const factionUpdates = ref<Array<Record<string, unknown>>>([])
  const exileEvents = ref<Array<Record<string, unknown>>>([])

  function onFactionUpdate(msg: WSMessage) {
    factionUpdates.value.push(msg.data as Record<string, unknown>)
  }

  function onCultActivity(msg: WSMessage) {
    factionUpdates.value.push({ ...msg.data as Record<string, unknown>, type: 'cult_activity' })
  }

  function onExileVote(msg: WSMessage) {
    exileEvents.value.push({ ...msg.data as Record<string, unknown>, phase: 'vote' })
  }

  function onExileResult(msg: WSMessage) {
    exileEvents.value.push({ ...msg.data as Record<string, unknown>, phase: 'result' })
  }

  function dismissMeeting() {
    if (meeting.value) {
      meeting.value.active = false
    }
  }

  function $reset() {
    conversations.value = []
    meeting.value = null
    queuedAudio.value = {}
    factionUpdates.value = []
    exileEvents.value = []
    msgCounter = 0
  }

  return {
    conversations, meeting, recentConversations, isMeetingActive,
    factionUpdates, exileEvents,
    onSpeak, addConversation, onSpeechAudio,
    onMeetingStart, onMeetingSpeech, onMeetingVote, onMeetingResult,
    onFactionUpdate, onCultActivity, onExileVote, onExileResult,
    dismissMeeting, $reset,
  }
})
