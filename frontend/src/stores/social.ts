import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WSMessage } from '@/types/websocket'
import type { AgentSpeechAudioData } from '@/types/websocket'

export type AudioStatus = 'idle' | 'pending' | 'ready' | 'error' | 'unavailable'

export interface ConversationMessage {
  id: number
  agentId: string
  agentName: string
  target: string
  message: string
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

let msgCounter = 0

export const useSocialStore = defineStore('social', () => {
  const conversations = ref<ConversationMessage[]>([])
  const meeting = ref<MeetingState | null>(null)

  const recentConversations = computed(() =>
    conversations.value.slice(-20)
  )

  const isMeetingActive = computed(() => meeting.value?.active ?? false)

  function onSpeak(msg: WSMessage) {
    const data = msg.data as {
      agent_id: string
      agent_name: string
      target: string
      message: string
    }
    // Compute index: count of messages from the same agent in the same round
    const round = msg.round
    const index = conversations.value.filter(
      (c) => c.agentId === data.agent_id && c.round === round,
    ).length
    conversations.value.push({
      id: ++msgCounter,
      agentId: data.agent_id,
      agentName: data.agent_name,
      target: data.target,
      message: data.message,
      timestamp: msg.timestamp,
      round,
      index,
      audioStatus: 'idle',
      audioUrl: null,
    })
    if (conversations.value.length > 100) {
      conversations.value = conversations.value.slice(-100)
    }
  }

  function onSpeechAudio(msg: WSMessage<AgentSpeechAudioData>) {
    const data = msg.data
    const entry = conversations.value.find(
      (c) => c.agentId === data.agent_id && c.round === data.round && c.index === data.index,
    )
    if (entry) {
      entry.audioStatus = data.status === 'ready' ? 'ready' : data.status === 'pending' ? 'pending' : data.status === 'error' ? 'error' : 'unavailable'
      entry.audioUrl = data.audio_url ?? null
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

  // Faction, cult, and exile events — stored as events for now, UI in future tickets
  const factionUpdates = ref<Array<Record<string, unknown>>>([])
  const exileEvents = ref<Array<Record<string, unknown>>>([])

  function onFactionUpdate(msg: WSMessage) {
    factionUpdates.value.push(msg.data as Record<string, unknown>)
  }

  function onCultActivity(msg: WSMessage) {
    // Cult activity is a subset of faction events
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
    factionUpdates.value = []
    exileEvents.value = []
    msgCounter = 0
  }

  return {
    conversations, meeting, recentConversations, isMeetingActive,
    factionUpdates, exileEvents,
    onSpeak, onSpeechAudio, onMeetingStart, onMeetingSpeech, onMeetingVote, onMeetingResult,
    onFactionUpdate, onCultActivity, onExileVote, onExileResult,
    dismissMeeting, $reset,
  }
})
