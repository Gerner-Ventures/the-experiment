import { ACTION_TO_ANIMATION, ANIMATION_REGISTRY, SILLY_ANIMATIONS } from '@/config/sprites/animations'
import { SKIP_ACTION_PHASE, AGGRESSIVE_ACTIONS } from '@/config/action-categories'

describe('ACTION_TO_ANIMATION → ANIMATION_REGISTRY integration', () => {
  it('maps every non-skip action to a valid animation registry key', () => {
    for (const [action, animName] of Object.entries(ACTION_TO_ANIMATION)) {
      expect(typeof animName).toBe('string')
      expect(animName.length).toBeGreaterThan(0)
      expect(ANIMATION_REGISTRY[animName]).toBeDefined()
      expect(action).toBeTruthy()
    }
  })

  it('has SILLY_ANIMATIONS entries for key action animations', () => {
    const sillyNames = new Set(SILLY_ANIMATIONS.map(a => a.name))
    const actionsWithAnimations = [
      'stab', 'shoot', 'dance', 'panic', 'pee', 'poop', 'vomit', 'sleep',
    ]
    for (const action of actionsWithAnimations) {
      const animName = ACTION_TO_ANIMATION[action]
      expect(animName).toBeDefined()
      expect(sillyNames.has(animName)).toBe(true)
    }
  })

  it('skip actions have low-impact animations (walk, wave, or think)', () => {
    for (const action of SKIP_ACTION_PHASE) {
      const animName = ACTION_TO_ANIMATION[action]
      if (animName) {
        expect(['walk', 'wave', 'think']).toContain(animName)
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

  it('aggressive actions all have ACTION_TO_ANIMATION mappings', () => {
    for (const action of AGGRESSIVE_ACTIONS) {
      expect(ACTION_TO_ANIMATION[action]).toBeDefined()
    }
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
