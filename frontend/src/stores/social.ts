import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  AgentSpeakData,
  AgentSpeechAudioData,
  AgentSpeechSource,
  WSMessage,
} from '@/types/websocket'
import { useTurnStore } from '@/stores/turn'
import { useLocale } from '@/locales'

export type AudioStatus = 'idle' | 'pending' | 'ready' | 'error' | 'unavailable'

export type MeetingScenePhase =
  | 'entering'
  | 'proposal'
  | 'speeches'
  | 'voting'
  | 'result'
  | 'exile'
  | 'exiting'

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

export interface MeetingSpeech {
  agentId: string
  agentName: string
  text: string
  stance?: string
}

export interface MeetingState {
  proposal: string
  votes: Record<string, string>
  speeches: MeetingSpeech[]
  result: string | null
  tally: Record<string, number> | null
  passed: boolean | null
  active: boolean
  scenePhase: MeetingScenePhase
  exileTarget: string | null
  exileOutcome: string | null
}

let msgCounter = 0

export const useSocialStore = defineStore('social', () => {
  const locale = useLocale()
  const conversations = ref<ConversationMessage[]>([])
  const meeting = ref<MeetingState | null>(null)

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
  ) {
    // Compute index: count of messages from the same agent in the same round
    const index = conversations.value.filter(
      (c) => c.agentId === agentId && c.round === round,
    ).length
    conversations.value.push({
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
    })
    if (conversations.value.length > 100) {
      conversations.value = conversations.value.slice(-100)
    }
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
      entry.audioStatus = data.status
      entry.audioUrl = data.audio_url ?? null
    } else {
      console.warn('[Social] Missing conversation entry for audio update', data)
    }
  }

  // ─── Meeting handlers ───
  // Meeting events are routed through the turn queue so they sequence
  // properly with agent actions. The social store still tracks meeting
  // state (proposal, speeches, votes, result) for the MeetingScene overlay,
  // but each speech/vote also becomes a turn so animations and bubbles
  // are paced correctly.

  function onMeetingStart(msg: WSMessage) {
    const data = msg.data as { proposal: string }
    // Initialize meeting state — the MeetingScene reacts to this
    meeting.value = {
      proposal: data.proposal,
      votes: {},
      speeches: [],
      result: null,
      tally: null,
      passed: null,
      active: true,
      scenePhase: 'entering',
      exileTarget: null,
      exileOutcome: null,
    }
    console.debug('[Social] Meeting started:', data.proposal)
  }

  function onMeetingSpeech(msg: WSMessage) {
    const data = msg.data as { agent_id: string; agent_name?: string; content: string; text?: string; stance?: string }
    const agentName = data.agent_name ?? data.agent_id
    // Accept both 'content' (correct) and 'text' (legacy) field names
    const speechText = data.content || data.text || ''

    // Buffer the speech into meeting state (for panel display after turn processes)
    // Scene phase is NOT advanced here — MeetingScene owns phase progression
    if (meeting.value) {
      meeting.value.speeches.push({
        agentId: data.agent_id,
        agentName,
        text: speechText,
        stance: data.stance,
      })
    }

    // Enqueue as a turn — the turn pipeline will animate the agent and
    // show a speech bubble with the meeting speech text.
    // Fallback to stance description if content is empty.
    const bubbleText = speechText
      || (data.stance === 'support' ? locale.social.meetingScene.stanceSupport : '')
      || (data.stance === 'oppose' ? locale.social.meetingScene.stanceOppose : '')
      || locale.social.meetingScene.stanceAbstain

    useTurnStore().enqueue({
      agentId: data.agent_id,
      agentName,
      round: msg.round,
      actionType: 'meeting_speech',
      thought: bubbleText,
      thoughtSource: 'dialogue',
      fromSpeakEvent: false,
    })
  }

  function onMeetingVote(msg: WSMessage) {
    const data = msg.data as { agent_id: string; agent_name?: string; vote: string }
    const agentName = data.agent_name ?? data.agent_id

    // Record vote in meeting state
    // Scene phase is NOT advanced here — MeetingScene owns phase progression
    if (meeting.value) {
      meeting.value.votes[data.agent_id] = data.vote
    }

    // Enqueue as a turn so votes are paced visually
    useTurnStore().enqueue({
      agentId: data.agent_id,
      agentName,
      round: msg.round,
      actionType: 'meeting_vote',
      thought: `Vote: ${data.vote}`,
      thoughtSource: 'dialogue',
      fromSpeakEvent: false,
    })
  }

  function onMeetingResult(msg: WSMessage) {
    const data = msg.data as {
      summary: string
      votes: Record<string, string>
      tally?: Record<string, number>
      passed?: boolean
    }
    if (meeting.value) {
      meeting.value.result = data.summary
      meeting.value.votes = data.votes
      meeting.value.tally = data.tally ?? null
      meeting.value.passed = data.passed ?? null
      // Scene phase is NOT advanced here — MeetingScene advances to 'result'
      // once the turn queue drains all speech/vote turns
    }
    console.debug('[Social] Meeting result:', data.summary)
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
    const data = msg.data as Record<string, unknown>
    exileEvents.value.push({ ...data, phase: 'result' })

    // If meeting is in result phase, transition to exile
    if (meeting.value && data.exiled_agent_id) {
      meeting.value.exileTarget = data.exiled_agent_id as string
      meeting.value.exileOutcome = (data.outcome as string) ?? 'exiled'
      meeting.value.scenePhase = 'exile'
    }
  }

  function advanceMeetingPhase(phase: MeetingScenePhase) {
    if (meeting.value) {
      meeting.value.scenePhase = phase
    }
  }

  function closeMeetingScene() {
    if (meeting.value) {
      meeting.value.scenePhase = 'exiting'
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
    advanceMeetingPhase, closeMeetingScene, dismissMeeting, $reset,
  }
})
