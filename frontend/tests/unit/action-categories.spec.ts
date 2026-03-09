import {
  SPOKEN_ACTIONS,
  SPEECH_ONLY_ACTIONS,
  SKIP_ACTION_PHASE,
  AGGRESSIVE_ACTIONS,
} from '@/config/action-categories'

describe('action-categories', () => {
  describe('SPOKEN_ACTIONS', () => {
    it.each([
      'talk', 'argue', 'accuse', 'threaten', 'rally', 'monologue',
      'meeting_speech', 'meeting_vote',
    ])('contains "%s"', (action) => {
      expect(SPOKEN_ACTIONS.has(action)).toBe(true)
    })

    it.each(['gather', 'move', 'observe'])(
      'does not contain "%s"',
      (action) => {
        expect(SPOKEN_ACTIONS.has(action)).toBe(false)
      },
    )
  })

  describe('SPEECH_ONLY_ACTIONS', () => {
    it('contains exactly meeting_speech and meeting_vote', () => {
      expect(SPEECH_ONLY_ACTIONS.size).toBe(2)
      expect(SPEECH_ONLY_ACTIONS.has('meeting_speech')).toBe(true)
      expect(SPEECH_ONLY_ACTIONS.has('meeting_vote')).toBe(true)
    })

    it.each(['talk', 'argue'])(
      'does not contain "%s"',
      (action) => {
        expect(SPEECH_ONLY_ACTIONS.has(action)).toBe(false)
      },
    )
  })

  describe('SKIP_ACTION_PHASE', () => {
    it.each(['move', 'rest', 'explore'])('contains "%s"', (action) => {
      expect(SKIP_ACTION_PHASE.has(action)).toBe(true)
    })
  })

  describe('AGGRESSIVE_ACTIONS', () => {
    it.each(['attack', 'stab', 'shoot', 'threaten', 'poison'])(
      'contains "%s"',
      (action) => {
        expect(AGGRESSIVE_ACTIONS.has(action)).toBe(true)
      },
    )
  })

  it('SPEECH_ONLY_ACTIONS and SKIP_ACTION_PHASE have no overlap', () => {
    for (const action of SPEECH_ONLY_ACTIONS) {
      expect(SKIP_ACTION_PHASE.has(action)).toBe(false)
    }
  })
})
