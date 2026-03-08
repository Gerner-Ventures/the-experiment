import {
  ANIMATION_REGISTRY,
  FALLBACK_ANIMATION,
  ACTION_TO_ANIMATION,
  SILLY_ANIMATIONS,
  WALK_ANIMATION,
  getAnimation,
  getAnimationForAction,
} from '@/config/sprites/animations'
import { POSES } from '@/config/sprites/poses'
import { AGGRESSIVE_ACTIONS } from '@/config/action-categories'

describe('animation-registry', () => {
  it('every ANIMATION_REGISTRY entry has non-empty frames array', () => {
    for (const [name, anim] of Object.entries(ANIMATION_REGISTRY)) {
      expect(anim.frames.length).toBeGreaterThan(0)
      expect(anim.name).toBe(name)
    }
  })

  it('every ANIMATION_REGISTRY entry has positive frameMs', () => {
    for (const anim of Object.values(ANIMATION_REGISTRY)) {
      expect(anim.frameMs).toBeGreaterThan(0)
    }
  })

  it('every frame in every animation references a valid PoseName that exists in POSES', () => {
    const validPoses = new Set(Object.keys(POSES))
    for (const [, anim] of Object.entries(ANIMATION_REGISTRY)) {
      for (const frame of anim.frames) {
        expect(validPoses.has(frame)).toBe(true)
      }
    }
  })

  it('every ACTION_TO_ANIMATION value maps to an existing ANIMATION_REGISTRY key', () => {
    for (const [, animName] of Object.entries(ACTION_TO_ANIMATION)) {
      expect(ANIMATION_REGISTRY[animName]).toBeDefined()
    }
  })

  it('getAnimation("stab") returns the stab animation', () => {
    const anim = getAnimation('stab')
    expect(anim.name).toBe('stab')
    expect(anim.frames.length).toBeGreaterThan(0)
  })

  it('getAnimation("nonexistent") returns FALLBACK_ANIMATION', () => {
    const anim = getAnimation('nonexistent')
    expect(anim).toBe(FALLBACK_ANIMATION)
  })

  it('getAnimationForAction("stab") returns stab animation', () => {
    const anim = getAnimationForAction('stab')
    expect(anim.name).toBe('stab')
  })

  it('getAnimationForAction("unknownAction") returns FALLBACK_ANIMATION', () => {
    const anim = getAnimationForAction('unknownAction')
    expect(anim).toBe(FALLBACK_ANIMATION)
  })

  it('SILLY_ANIMATIONS is derived correctly (no loop animations)', () => {
    for (const anim of SILLY_ANIMATIONS) {
      expect(anim.loop).not.toBe(true)
    }
    // walk is loop: true and should NOT be in SILLY_ANIMATIONS
    expect(SILLY_ANIMATIONS.find(a => a.name === 'walk')).toBeUndefined()
  })

  it('WALK_ANIMATION has loop: true', () => {
    expect(WALK_ANIMATION.loop).toBe(true)
    expect(WALK_ANIMATION.name).toBe('walk')
  })

  it('all AGGRESSIVE_ACTIONS entries have ACTION_TO_ANIMATION mappings', () => {
    for (const action of AGGRESSIVE_ACTIONS) {
      expect(ACTION_TO_ANIMATION[action]).toBeDefined()
      expect(ANIMATION_REGISTRY[ACTION_TO_ANIMATION[action]]).toBeDefined()
    }
  })

  it('FALLBACK_ANIMATION has valid frames', () => {
    const validPoses = new Set(Object.keys(POSES))
    expect(FALLBACK_ANIMATION.frames.length).toBeGreaterThan(0)
    expect(FALLBACK_ANIMATION.frameMs).toBeGreaterThan(0)
    for (const frame of FALLBACK_ANIMATION.frames) {
      expect(validPoses.has(frame)).toBe(true)
    }
  })
})
