import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WSMessage } from '@/types/websocket'

export interface ConversationMessage {
  id: number
  agentId: string
  agentName: string
  target: string
  message: string
  timestamp: string
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
    conversations.value.push({
      id: ++msgCounter,
      agentId: data.agent_id,
      agentName: data.agent_name,
      target: data.target,
      message: data.message,
      timestamp: msg.timestamp,
    })
    if (conversations.value.length > 100) {
      conversations.value = conversations.value.slice(-100)
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

  function dismissMeeting() {
    if (meeting.value) {
      meeting.value.active = false
    }
  }

  function $reset() {
    conversations.value = []
    meeting.value = null
    msgCounter = 0
  }

  return {
    conversations, meeting, recentConversations, isMeetingActive,
    onSpeak, onMeetingStart, onMeetingSpeech, onMeetingVote, onMeetingResult,
    dismissMeeting, $reset,
  }
})
