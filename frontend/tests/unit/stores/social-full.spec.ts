/**
 * Comprehensive tests for the social store beyond meeting basics.
 * Covers: advanceMeetingPhase, exile events, faction updates,
 * turn enqueue field verification, thoughtSource/fromSpeakEvent on meeting turns,
 * onSpeak / addConversation / onSpeechAudio, $reset.
 */
import { setActivePinia, createPinia } from 'pinia'
import { useSocialStore } from '@/stores/social'
import { useTurnStore } from '@/stores/turn'
import type { WSMessage } from '@/types/websocket'

jest.mock('@/locales', () => ({
  useLocale: () => ({
    hud: { steppingAgent: '{name}: {action}' },
    social: {
      meetingScene: {
        stanceSupport: 'I support this.',
        stanceOppose: 'I oppose this.',
        stanceAbstain: 'I abstain.',
        votePrefix: 'Vote: {vote}',
      },
      speech: {
        thoughtLabel: 'thinking',
        dialogueLabel: 'says',
        tapToPlay: '🔊',
      },
    },
  }),
}))

function makeMsg(type: string, data: Record<string, unknown>, round = 1): WSMessage {
  return { type: type as WSMessage['type'], round, timestamp: '2026-03-07T00:00:00Z', data }
}

describe('Social store – comprehensive', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ─── advanceMeetingPhase ───

  describe('advanceMeetingPhase', () => {
    it('sets scenePhase to exiting', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
      expect(store.meeting!.scenePhase).toBe('entering')

      store.advanceMeetingPhase('exiting')
      expect(store.meeting!.scenePhase).toBe('exiting')
    })

    it('is safe when meeting is null', () => {
      const store = useSocialStore()
      expect(() => store.advanceMeetingPhase('exiting')).not.toThrow()
    })
  })

  // ─── Meeting turn enqueue fields ───

  describe('meeting turn enqueue fields', () => {
    it('onMeetingSpeech sets thoughtSource to dialogue', () => {
      const store = useSocialStore()
      const turnStore = useTurnStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingSpeech(makeMsg('meeting_speech', {
        agent_id: 'a1',
        agent_name: 'Alice',
        content: 'I agree.',
      }))

      expect(turnStore.activeTurn!.thoughtSource).toBe('dialogue')
    })

    it('onMeetingSpeech sets fromSpeakEvent to false', () => {
      const store = useSocialStore()
      const turnStore = useTurnStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingSpeech(makeMsg('meeting_speech', {
        agent_id: 'a1',
        agent_name: 'Alice',
        content: 'I agree.',
      }))

      expect(turnStore.activeTurn!.fromSpeakEvent).toBe(false)
    })

    it('onMeetingVote sets thoughtSource to dialogue', () => {
      const store = useSocialStore()
      const turnStore = useTurnStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingVote(makeMsg('meeting_vote', {
        agent_id: 'a1',
        agent_name: 'Alice',
        vote: 'support',
      }))

      expect(turnStore.activeTurn!.thoughtSource).toBe('dialogue')
    })

    it('onMeetingVote sets fromSpeakEvent to false', () => {
      const store = useSocialStore()
      const turnStore = useTurnStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingVote(makeMsg('meeting_vote', {
        agent_id: 'a1',
        agent_name: 'Alice',
        vote: 'oppose',
      }))

      expect(turnStore.activeTurn!.fromSpeakEvent).toBe(false)
    })

    it('onMeetingSpeech passes round from message', () => {
      const store = useSocialStore()
      const turnStore = useTurnStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingSpeech(makeMsg('meeting_speech', {
        agent_id: 'a1',
        agent_name: 'Alice',
        content: 'Round 7.',
      }, 7))

      expect(turnStore.activeTurn!.round).toBe(7)
    })

    it('onMeetingVote passes round from message', () => {
      const store = useSocialStore()
      const turnStore = useTurnStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingVote(makeMsg('meeting_vote', {
        agent_id: 'a1',
        agent_name: 'Alice',
        vote: 'support',
      }, 9))

      expect(turnStore.activeTurn!.round).toBe(9)
    })
  })

  // ─── onMeetingSpeech content/text fallback ───

  describe('onMeetingSpeech content/text fallback', () => {
    it('prefers content field over text field', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingSpeech(makeMsg('meeting_speech', {
        agent_id: 'a1',
        agent_name: 'Alice',
        content: 'From content.',
        text: 'From text.',
      }))

      expect(store.meeting!.speeches[0].text).toBe('From content.')
    })

    it('falls back to text field when content is empty', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      store.onMeetingSpeech(makeMsg('meeting_speech', {
        agent_id: 'a1',
        agent_name: 'Alice',
        content: '',
        text: 'Legacy text.',
      }))

      expect(store.meeting!.speeches[0].text).toBe('Legacy text.')
    })
  })

  // ─── onMeetingResult scene phase ───

  describe('onMeetingResult', () => {
    it('does NOT advance scenePhase (MeetingScene owns phase)', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
      store.advanceMeetingPhase('voting')

      store.onMeetingResult(makeMsg('meeting_result', {
        summary: 'Passed.',
        votes: { a1: 'support' },
        tally: { support: 1 },
        passed: true,
      }))

      // Phase should still be voting — MeetingScene watcher handles result advancement
      expect(store.meeting!.scenePhase).toBe('voting')
    })
  })

  // ─── Exile events ───

  describe('exile events', () => {
    it('onExileVote pushes to exileEvents with vote phase', () => {
      const store = useSocialStore()
      store.onExileVote(makeMsg('exile_vote', {
        agent_id: 'a1',
        vote: 'exile',
      }))

      expect(store.exileEvents).toHaveLength(1)
      expect(store.exileEvents[0]).toMatchObject({ agent_id: 'a1', phase: 'vote' })
    })

    it('onExileResult pushes to exileEvents with result phase', () => {
      const store = useSocialStore()
      store.onExileResult(makeMsg('exile_result', {
        outcome: 'exiled',
        exiled_agent_id: 'a1',
      }))

      expect(store.exileEvents).toHaveLength(1)
      expect(store.exileEvents[0]).toMatchObject({ outcome: 'exiled', phase: 'result' })
    })

    it('onExileResult transitions meeting to exile phase when exiled_agent_id present', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Exile vote' }))
      store.advanceMeetingPhase('result')

      store.onExileResult(makeMsg('exile_result', {
        outcome: 'exiled',
        exiled_agent_id: 'a1',
      }))

      expect(store.meeting!.scenePhase).toBe('exile')
      expect(store.meeting!.exileTarget).toBe('a1')
      expect(store.meeting!.exileOutcome).toBe('exiled')
    })

    it('onExileResult does NOT transition when exiled_agent_id is missing', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Exile vote' }))
      store.advanceMeetingPhase('result')

      store.onExileResult(makeMsg('exile_result', {
        outcome: 'spared',
      }))

      // Phase should remain at result
      expect(store.meeting!.scenePhase).toBe('result')
      expect(store.meeting!.exileTarget).toBeNull()
    })
  })

  // ─── Faction events ───

  describe('faction events', () => {
    it('onFactionUpdate pushes to factionUpdates', () => {
      const store = useSocialStore()
      store.onFactionUpdate(makeMsg('faction_update', {
        faction_id: 'f1',
        name: 'Rebels',
      }))

      expect(store.factionUpdates).toHaveLength(1)
      expect(store.factionUpdates[0]).toMatchObject({ faction_id: 'f1', name: 'Rebels' })
    })

    it('onCultActivity pushes with type marker', () => {
      const store = useSocialStore()
      store.onCultActivity(makeMsg('cult_activity', {
        cult_name: 'Dark Order',
        ritual: 'initiation',
      }))

      expect(store.factionUpdates).toHaveLength(1)
      expect(store.factionUpdates[0]).toMatchObject({
        cult_name: 'Dark Order',
        type: 'cult_activity',
      })
    })
  })

  // ─── Conversation management ───

  describe('conversations', () => {
    it('onSpeak adds a conversation message', () => {
      const store = useSocialStore()
      store.onSpeak({
        type: 'agent_speak' as WSMessage['type'],
        round: 2,
        timestamp: '2026-03-07T00:00:00Z',
        data: {
          agent_id: 'a1',
          agent_name: 'Alice',
          message: 'Hello.',
          target: 'Bob',
          source: 'dialogue',
        },
      })

      expect(store.conversations).toHaveLength(1)
      expect(store.conversations[0]).toMatchObject({
        agentId: 'a1',
        agentName: 'Alice',
        message: 'Hello.',
        target: 'Bob',
        source: 'dialogue',
        round: 2,
      })
    })

    it('caps conversations at 100', () => {
      const store = useSocialStore()
      for (let i = 0; i < 105; i++) {
        store.addConversation(`a${i}`, `Agent ${i}`, `Message ${i}`)
      }
      expect(store.conversations).toHaveLength(100)
    })

    it('recentConversations returns last 20', () => {
      const store = useSocialStore()
      for (let i = 0; i < 30; i++) {
        store.addConversation(`a${i}`, `Agent ${i}`, `Message ${i}`)
      }
      expect(store.recentConversations).toHaveLength(20)
      expect(store.recentConversations[0].agentId).toBe('a10')
    })

    it('tracks index per agent per round', () => {
      const store = useSocialStore()
      store.addConversation('a1', 'Alice', 'First', '', undefined, 1)
      store.addConversation('a1', 'Alice', 'Second', '', undefined, 1)
      store.addConversation('a2', 'Bob', 'Bob first', '', undefined, 1)

      expect(store.conversations[0].index).toBe(0) // Alice round 1, first
      expect(store.conversations[1].index).toBe(1) // Alice round 1, second
      expect(store.conversations[2].index).toBe(0) // Bob round 1, first
    })

    it('onSpeechAudio updates matching conversation', () => {
      const store = useSocialStore()
      store.addConversation('a1', 'Alice', 'Hello', '', undefined, 1, 'dialogue')

      store.onSpeechAudio({
        type: 'speech_audio' as WSMessage['type'],
        round: 1,
        timestamp: '2026-03-07T00:00:00Z',
        data: {
          agent_id: 'a1',
          round: 1,
          index: 0,
          source: 'dialogue',
          status: 'ready',
          audio_url: 'https://example.com/audio.mp3',
        },
      })

      expect(store.conversations[0].audioStatus).toBe('ready')
      expect(store.conversations[0].audioUrl).toBe('https://example.com/audio.mp3')
    })

    it('onSpeechAudio handles missing conversation gracefully', () => {
      const store = useSocialStore()
      const spy = jest.spyOn(console, 'warn').mockImplementation()

      store.onSpeechAudio({
        type: 'speech_audio' as WSMessage['type'],
        round: 1,
        timestamp: '2026-03-07T00:00:00Z',
        data: {
          agent_id: 'nonexistent',
          round: 1,
          index: 0,
          status: 'ready',
          audio_url: null,
        },
      })

      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  // ─── isMeetingActive computed ───

  describe('isMeetingActive', () => {
    it('is false when meeting is null', () => {
      const store = useSocialStore()
      expect(store.isMeetingActive).toBe(false)
    })

    it('is true when meeting is active', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
      expect(store.isMeetingActive).toBe(true)
    })

    it('is false after dismissMeeting', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
      store.dismissMeeting()
      expect(store.isMeetingActive).toBe(false)
    })

    it('stays true after onMeetingResult (until dismissed)', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
      store.onMeetingResult(makeMsg('meeting_result', {
        summary: 'Passed.',
        votes: { a1: 'support' },
      }))
      expect(store.isMeetingActive).toBe(true)
    })
  })

  // ─── MeetingState initialization ───

  describe('meeting state initialization', () => {
    it('initializes exile fields to null', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))

      expect(store.meeting!.exileTarget).toBeNull()
      expect(store.meeting!.exileOutcome).toBeNull()
    })
  })

  // ─── $reset ───

  describe('$reset', () => {
    it('clears all state', () => {
      const store = useSocialStore()
      store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Test' }))
      store.addConversation('a1', 'Alice', 'Hello')
      store.onFactionUpdate(makeMsg('faction_update', { faction_id: 'f1' }))
      store.onExileVote(makeMsg('exile_vote', { agent_id: 'a1' }))

      store.$reset()

      expect(store.conversations).toEqual([])
      expect(store.meeting).toBeNull()
      expect(store.factionUpdates).toEqual([])
      expect(store.exileEvents).toEqual([])
    })
  })
})
