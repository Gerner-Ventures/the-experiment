import { HD_ACTION_TO_ANIMATION, HD_ANIMATION_REGISTRY, HD_SILLY_ANIMATIONS } from '@/config/sprites/hd/animations'
import { SKIP_ACTION_PHASE, AGGRESSIVE_ACTIONS } from '@/config/action-categories'

describe('HD_ACTION_TO_ANIMATION → HD_ANIMATION_REGISTRY integration', () => {
  it('maps every non-skip action to a valid animation registry key', () => {
    for (const [action, animName] of Object.entries(HD_ACTION_TO_ANIMATION)) {
      expect(typeof animName).toBe('string')
      expect(animName.length).toBeGreaterThan(0)
      expect(HD_ANIMATION_REGISTRY[animName]).toBeDefined()
      expect(action).toBeTruthy()
    }
  })

  it('has HD_SILLY_ANIMATIONS entries for key action animations', () => {
    const sillyNames = new Set(HD_SILLY_ANIMATIONS.map(a => a.name))
    const actionsWithAnimations = [
      'stab', 'shoot', 'dance', 'panic', 'pee', 'poop', 'vomit', 'sleep',
    ]
    for (const action of actionsWithAnimations) {
      const animName = HD_ACTION_TO_ANIMATION[action]
      expect(animName).toBeDefined()
      expect(sillyNames.has(animName)).toBe(true)
    }
  })

  it('skip actions all have animation mappings', () => {
    for (const action of SKIP_ACTION_PHASE) {
      const animName = HD_ACTION_TO_ANIMATION[action]
      expect(animName).toBeDefined()
      expect(HD_ANIMATION_REGISTRY[animName]).toBeDefined()
    }
  })

  it('all HD_SILLY_ANIMATIONS have valid pose sequences', () => {
    for (const anim of HD_SILLY_ANIMATIONS) {
      expect(anim.name).toBeTruthy()
      expect(anim.poses.length).toBeGreaterThan(0)
      expect(anim.speed).toBeGreaterThan(0)
    }
  })

  it('aggressive actions all have HD_ACTION_TO_ANIMATION mappings', () => {
    for (const action of AGGRESSIVE_ACTIONS) {
      expect(HD_ACTION_TO_ANIMATION[action]).toBeDefined()
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
