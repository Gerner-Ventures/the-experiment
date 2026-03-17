import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  AgentSpeakData,
  AgentSpeechAudioData,
  AgentSpeechSource,
  ExileResultData,
  MeetingResultData,
  MeetingSpeechData,
  MeetingStartData,
  MeetingVoteData,
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
  const locale = useLocale()
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

  // ─── Meeting handlers ───
  // Meeting events are routed through the turn queue so they sequence
  // properly with agent actions. The social store still tracks meeting
  // state (proposal, speeches, votes, result) for the MeetingScene overlay,
  // but each speech/vote also becomes a turn so animations and bubbles
  // are paced correctly.

  function onMeetingStart(msg: WSMessage<MeetingStartData>) {
    const data = msg.data

    // Phase gate warning: check if turn queue still has pre-meeting turns
    const turnStore = useTurnStore()
    const pendingNonMeeting = turnStore.queue.filter(
      t => t.actionType !== 'meeting_speech' && t.actionType !== 'meeting_vote',
    ).length
    const activeTurnAction = turnStore.activeTurn?.actionType
    if (pendingNonMeeting > 0 || (activeTurnAction && activeTurnAction !== 'meeting_speech' && activeTurnAction !== 'meeting_vote')) {
      console.warn(
        `[Social] meeting_start arrived with ${pendingNonMeeting} non-meeting turns queued` +
        (activeTurnAction ? ` | active: ${turnStore.activeTurn?.agentName} → ${activeTurnAction}` : ''),
      )
    }

    // Stage meeting data but DON'T activate yet — the turn store will activate
    // when it reaches the first meeting_speech turn. This prevents the meeting
    // scene from interrupting queued morning/afternoon turns.
    meeting.value = {
      proposal: data.proposal,
      votes: {},
      speeches: [],
      result: null,
      tally: null,
      passed: null,
      active: false,
      scenePhase: 'entering',
      exileTarget: null,
      exileOutcome: null,
    }
    console.debug('[Social] Meeting staged (pending activation):', data.proposal)
  }

  function onMeetingSpeech(msg: WSMessage<MeetingSpeechData>) {
    const data = msg.data
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
      phase: msg.phase,
      actionType: 'meeting_speech',
      thought: bubbleText,
      thoughtSource: 'dialogue',
      fromSpeakEvent: false,
    })
  }

  function onMeetingVote(msg: WSMessage<MeetingVoteData>) {
    const data = msg.data
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
      phase: msg.phase,
      actionType: 'meeting_vote',
      thought: locale.social.meetingScene.votePrefix.replace('{vote}', data.vote),
      thoughtSource: 'dialogue',
      fromSpeakEvent: false,
    })
  }

  function onMeetingResult(msg: WSMessage<MeetingResultData>) {
    const data = msg.data
    if (meeting.value) {
      meeting.value.result = data.summary
      meeting.value.votes = data.votes
      meeting.value.tally = data.tally ?? null
      meeting.value.passed = data.passed ?? null
      // Scene phase is NOT advanced here — MeetingScene advances to 'result'
      // once the turn queue drains all speech/vote turns
    }

    // meeting_result may embed exile data (backend sends MeetingOutcome.exile inline)
    const raw = data as unknown as Record<string, unknown>
    const exile = raw.exile as Record<string, unknown> | undefined
    if (exile?.enacted) {
      const agentId = extractExiledAgentId(exile)
      if (agentId) {
        applyExile(agentId, (exile.reason as string) ?? undefined)
      }
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

  /**
   * Extract the exiled agent ID from exile data.
   * Backend sends `target_agent_id`; frontend type also has `exiled_agent_id` as alias.
   */
  function extractExiledAgentId(data: Record<string, unknown>): string | null {
    return (data.target_agent_id as string)
      ?? (data.exiled_agent_id as string)
      ?? null
  }

  /**
   * Record the exile target on meeting state.
   * Does NOT mark agent status or change scene phase — the exile animation
   * plays after the result phase, and status is set on animation completion.
   */
  function applyExile(agentId: string, outcome?: string) {
    if (meeting.value && !meeting.value.exileTarget) {
      meeting.value.exileTarget = agentId
      meeting.value.exileOutcome = outcome ?? 'exiled'
    }
  }

  function onExileResult(msg: WSMessage<ExileResultData>) {
    const data = msg.data
    exileEvents.value.push({ ...data, phase: 'result' })

    const agentId = extractExiledAgentId(data as Record<string, unknown>)
    if (agentId) {
      applyExile(agentId, data.outcome)
    }
  }

  function advanceMeetingPhase(phase: MeetingScenePhase) {
    if (meeting.value) {
      meeting.value.scenePhase = phase
    }
  }

  /** Called by the turn store when it reaches the first meeting turn */
  function activateMeeting() {
    if (meeting.value && !meeting.value.active) {
      meeting.value.active = true
      console.debug('[Social] Meeting activated (turn store reached meeting turn)')
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
    advanceMeetingPhase, activateMeeting, dismissMeeting, $reset,
  }
})
