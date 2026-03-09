/**
 * Tests for social store meeting handlers.
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
    },
  }),
}))

function makeMsg(type: string, data: Record<string, unknown>, round = 1): WSMessage {
  return { type: type as WSMessage['type'], round, timestamp: '2026-03-07T00:00:00Z', data }
}

describe('Social store meeting handlers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ─── onMeetingStart ───

  it('onMeetingStart initializes meeting state', () => {
    const store = useSocialStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Ban nighttime foraging' }))

    expect(store.meeting).not.toBeNull()
    expect(store.meeting!.proposal).toBe('Ban nighttime foraging')
    expect(store.meeting!.votes).toEqual({})
    expect(store.meeting!.speeches).toEqual([])
    expect(store.meeting!.result).toBeNull()
    expect(store.meeting!.tally).toBeNull()
    expect(store.meeting!.passed).toBeNull()
    expect(store.meeting!.active).toBe(true)
    expect(store.meeting!.scenePhase).toBe('entering')
  })

  // ─── onMeetingSpeech ───

  it('onMeetingSpeech buffers speech into meeting.speeches', () => {
    const store = useSocialStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Build a shelter' }))

    store.onMeetingSpeech(makeMsg('meeting_speech', {
      agent_id: 'a1',
      agent_name: 'Alice',
      content: 'We need shelter before the storm.',
      stance: 'support',
    }, 2))

    expect(store.meeting!.speeches).toHaveLength(1)
    expect(store.meeting!.speeches[0]).toEqual({
      agentId: 'a1',
      agentName: 'Alice',
      text: 'We need shelter before the storm.',
      stance: 'support',
    })
  })

  it('onMeetingSpeech enqueues a turn with correct fields', () => {
    const store = useSocialStore()
    const turnStore = useTurnStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Build a shelter' }))

    store.onMeetingSpeech(makeMsg('meeting_speech', {
      agent_id: 'a1',
      agent_name: 'Alice',
      content: 'We need shelter before the storm.',
      stance: 'support',
    }, 3))

    // First enqueue auto-processes, so the turn is activeTurn not queue[0]
    const turn = turnStore.activeTurn!
    expect(turn.actionType).toBe('meeting_speech')
    expect(turn.round).toBe(3)
    expect(turn.thoughtSource).toBe('dialogue')
    expect(turn.thought).toBe('We need shelter before the storm.')
  })

  it('onMeetingSpeech falls back to stance text when content is empty', () => {
    const store = useSocialStore()
    const turnStore = useTurnStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Ration water' }))

    store.onMeetingSpeech(makeMsg('meeting_speech', {
      agent_id: 'a1',
      agent_name: 'Alice',
      content: '',
      stance: 'support',
    }))

    expect(turnStore.activeTurn!.thought).toBe('I support this.')
  })

  it('onMeetingSpeech falls back to oppose stance text', () => {
    const store = useSocialStore()
    const turnStore = useTurnStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Ration water' }))

    store.onMeetingSpeech(makeMsg('meeting_speech', {
      agent_id: 'a1',
      agent_name: 'Alice',
      content: '',
      stance: 'oppose',
    }))

    expect(turnStore.activeTurn!.thought).toBe('I oppose this.')
  })

  it('onMeetingSpeech falls back to abstain stance text', () => {
    const store = useSocialStore()
    const turnStore = useTurnStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Ration water' }))

    store.onMeetingSpeech(makeMsg('meeting_speech', {
      agent_id: 'a1',
      agent_name: 'Alice',
      content: '',
      stance: 'abstain',
    }))

    expect(turnStore.activeTurn!.thought).toBe('I abstain.')
  })

  it('onMeetingSpeech uses agent_id as name when agent_name is missing', () => {
    const store = useSocialStore()
    const turnStore = useTurnStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Forage together' }))

    store.onMeetingSpeech(makeMsg('meeting_speech', {
      agent_id: 'a1',
      content: 'Good idea.',
    }))

    expect(store.meeting!.speeches[0].agentName).toBe('a1')
    expect(turnStore.activeTurn!.agentName).toBe('a1')
  })

  // ─── onMeetingVote ───

  it('onMeetingVote records vote in meeting.votes', () => {
    const store = useSocialStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Share food' }))

    store.onMeetingVote(makeMsg('meeting_vote', {
      agent_id: 'a1',
      agent_name: 'Alice',
      vote: 'support',
    }))

    expect(store.meeting!.votes).toEqual({ a1: 'support' })
  })

  it('onMeetingVote enqueues a turn with correct fields', () => {
    const store = useSocialStore()
    const turnStore = useTurnStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Share food' }))

    store.onMeetingVote(makeMsg('meeting_vote', {
      agent_id: 'a1',
      agent_name: 'Alice',
      vote: 'support',
    }, 4))

    const turn = turnStore.activeTurn!
    expect(turn.actionType).toBe('meeting_vote')
    expect(turn.round).toBe(4)
    expect(turn.thoughtSource).toBe('dialogue')
    expect(turn.thought).toBe('Vote: support')
  })

  it('onMeetingVote uses agent_id as name when agent_name is missing', () => {
    const store = useSocialStore()
    const turnStore = useTurnStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Share food' }))

    store.onMeetingVote(makeMsg('meeting_vote', {
      agent_id: 'a2',
      vote: 'oppose',
    }))

    expect(turnStore.activeTurn!.agentName).toBe('a2')
    expect(turnStore.activeTurn!.thought).toBe('Vote: oppose')
  })

  // ─── onMeetingResult ───

  it('onMeetingResult sets result, votes, tally, and passed', () => {
    const store = useSocialStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Build walls' }))

    store.onMeetingResult(makeMsg('meeting_result', {
      summary: 'The motion passed with 3 votes in favor.',
      votes: { a1: 'support', a2: 'support', a3: 'oppose' },
      tally: { support: 2, oppose: 1 },
      passed: true,
    }))

    expect(store.meeting!.result).toBe('The motion passed with 3 votes in favor.')
    expect(store.meeting!.votes).toEqual({ a1: 'support', a2: 'support', a3: 'oppose' })
    expect(store.meeting!.tally).toEqual({ support: 2, oppose: 1 })
    expect(store.meeting!.passed).toBe(true)
  })

  it('onMeetingResult defaults tally and passed to null when absent', () => {
    const store = useSocialStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Build walls' }))

    store.onMeetingResult(makeMsg('meeting_result', {
      summary: 'Inconclusive.',
      votes: { a1: 'abstain' },
    }))

    expect(store.meeting!.result).toBe('Inconclusive.')
    expect(store.meeting!.tally).toBeNull()
    expect(store.meeting!.passed).toBeNull()
  })

  // ─── dismissMeeting ───

  it('dismissMeeting sets meeting active to false', () => {
    const store = useSocialStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Rest day' }))

    expect(store.meeting!.active).toBe(true)
    store.dismissMeeting()
    expect(store.meeting!.active).toBe(false)
  })

  it('dismissMeeting is safe when meeting is null', () => {
    const store = useSocialStore()
    expect(store.meeting).toBeNull()
    expect(() => store.dismissMeeting()).not.toThrow()
  })

  // ─── advanceMeetingPhase ───

  it('advanceMeetingPhase updates scenePhase', () => {
    const store = useSocialStore()
    store.onMeetingStart(makeMsg('meeting_start', { proposal: 'Elect leader' }))

    expect(store.meeting!.scenePhase).toBe('entering')

    store.advanceMeetingPhase('proposal')
    expect(store.meeting!.scenePhase).toBe('proposal')

    store.advanceMeetingPhase('speeches')
    expect(store.meeting!.scenePhase).toBe('speeches')

    store.advanceMeetingPhase('voting')
    expect(store.meeting!.scenePhase).toBe('voting')

    store.advanceMeetingPhase('result')
    expect(store.meeting!.scenePhase).toBe('result')
  })

  it('advanceMeetingPhase is safe when meeting is null', () => {
    const store = useSocialStore()
    expect(store.meeting).toBeNull()
    expect(() => store.advanceMeetingPhase('proposal')).not.toThrow()
  })
})
