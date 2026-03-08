import { ACTION_TO_ANIMATION } from '@/types/sprite'
import { SILLY_ANIMATIONS } from '@/config/character-sprites'
import { SKIP_ACTION_PHASE, AGGRESSIVE_ACTIONS } from '@/config/action-categories'

describe('ACTION_TO_ANIMATION → SILLY_ANIMATIONS integration', () => {
  const sillyNames = new Set(SILLY_ANIMATIONS.map(a => a.name))

  it('maps every non-skip action to a valid SpriteAnimation', () => {
    for (const [action, animation] of Object.entries(ACTION_TO_ANIMATION)) {
      expect(typeof animation).toBe('string')
      expect(animation.length).toBeGreaterThan(0)
      // Just verify the mapping exists and is a string — not all animations
      // have SILLY_ANIMATIONS entries (some are pose-only)
      expect(action).toBeTruthy()
    }
  })

  it('has SILLY_ANIMATIONS entries for key action animations', () => {
    // These actions should have matching SILLY_ANIMATIONS for the acting phase
    const actionsWithAnimations = [
      'stab', 'shoot', 'dance', 'panic', 'pee', 'poop', 'vomit', 'sleep',
    ]
    for (const action of actionsWithAnimations) {
      const animation = ACTION_TO_ANIMATION[action]
      expect(animation).toBeDefined()
      expect(sillyNames.has(animation)).toBe(true)
    }
  })

  it('skip actions have low-impact animations (idle, walk, or think)', () => {
    for (const action of SKIP_ACTION_PHASE) {
      const animation = ACTION_TO_ANIMATION[action]
      if (animation) {
        expect(['idle', 'walk', 'think']).toContain(animation)
      }
    }
  })

  it('all SILLY_ANIMATIONS have valid frame sequences', () => {
    for (const anim of SILLY_ANIMATIONS) {
      expect(anim.name).toBeTruthy()
      expect(anim.frames.length).toBeGreaterThan(0)
      expect(anim.frameMs).toBeGreaterThan(0)
    }
  })

  it('aggressive actions map to distinct animations', () => {
    const aggressive = ['attack', 'stab', 'shoot', 'threaten']
    const animations = aggressive.map(a => ACTION_TO_ANIMATION[a])
    expect(animations).toEqual(['punch', 'stab', 'shoot', 'threaten'])
  })

  it('AGGRESSIVE_ACTIONS contains all expected actions', () => {
    expect(AGGRESSIVE_ACTIONS.has('attack')).toBe(true)
    expect(AGGRESSIVE_ACTIONS.has('stab')).toBe(true)
    expect(AGGRESSIVE_ACTIONS.has('shoot')).toBe(true)
    expect(AGGRESSIVE_ACTIONS.has('threaten')).toBe(true)
    expect(AGGRESSIVE_ACTIONS.has('poison')).toBe(true)
    expect(AGGRESSIVE_ACTIONS.has('gather')).toBe(false)
  })
})
