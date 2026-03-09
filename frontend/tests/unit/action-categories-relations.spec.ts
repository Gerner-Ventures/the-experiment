/**
 * Tests for action category set relationships and completeness.
 * Verifies cross-set invariants that the individual set tests don't cover.
 */
import {
  SPOKEN_ACTIONS,
  SPEECH_ONLY_ACTIONS,
  SKIP_ACTION_PHASE,
  AGGRESSIVE_ACTIONS,
} from '@/config/action-categories'

describe('action category set relationships', () => {
  it('SPEECH_ONLY_ACTIONS is a subset of SPOKEN_ACTIONS', () => {
    for (const action of SPEECH_ONLY_ACTIONS) {
      expect(SPOKEN_ACTIONS.has(action)).toBe(true)
    }
  })

  it('all meeting actions are in SPOKEN_ACTIONS', () => {
    const meetingActions = ['meeting_speech', 'meeting_vote']
    for (const action of meetingActions) {
      expect(SPOKEN_ACTIONS.has(action)).toBe(true)
    }
  })

  it('all meeting actions are in SPEECH_ONLY_ACTIONS', () => {
    const meetingActions = ['meeting_speech', 'meeting_vote']
    for (const action of meetingActions) {
      expect(SPEECH_ONLY_ACTIONS.has(action)).toBe(true)
    }
  })

  it('SPEECH_ONLY_ACTIONS and AGGRESSIVE_ACTIONS have no overlap', () => {
    for (const action of SPEECH_ONLY_ACTIONS) {
      expect(AGGRESSIVE_ACTIONS.has(action)).toBe(false)
    }
  })

  it('SKIP_ACTION_PHASE and SPOKEN_ACTIONS have no overlap', () => {
    for (const action of SKIP_ACTION_PHASE) {
      expect(SPOKEN_ACTIONS.has(action)).toBe(false)
    }
  })

  it('threaten is in both SPOKEN_ACTIONS and AGGRESSIVE_ACTIONS', () => {
    // Threaten is verbal aggression — both spoken and aggressive
    expect(SPOKEN_ACTIONS.has('threaten')).toBe(true)
    expect(AGGRESSIVE_ACTIONS.has('threaten')).toBe(true)
  })
})
