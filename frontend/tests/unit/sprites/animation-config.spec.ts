/**
 * Tests for animation registry configuration beyond meeting mappings.
 * Covers: think animation details, vote animation details, talk animation cycle,
 * fallback behavior, and getHDAnimation / getHDAnimationForAction.
 */
import {
  HD_ANIMATION_REGISTRY,
  HD_ACTION_TO_ANIMATION,
  HD_FALLBACK_ANIMATION,
  getHDAnimation,
  getHDAnimationForAction,
} from '@/config/sprites/hd/animations'

describe('HD animation registry config', () => {
  describe('think animation', () => {
    const think = HD_ANIMATION_REGISTRY['think']

    it('exists in registry', () => {
      expect(think).toBeDefined()
    })

    it('includes the think pose', () => {
      expect(think.poses).toContain('think')
    })

    it('starts and ends with idle', () => {
      expect(think.poses[0]).toBe('idle')
      expect(think.poses[think.poses.length - 1]).toBe('idle')
    })

    it('is non-looping', () => {
      expect(think.loop).toBe(false)
    })

    it('has slow speed (deliberate)', () => {
      expect(think.speed).toBeLessThanOrEqual(0.08)
    })
  })

  describe('vote animation', () => {
    const vote = HD_ANIMATION_REGISTRY['vote']

    it('exists in registry', () => {
      expect(vote).toBeDefined()
    })

    it('includes the vote pose', () => {
      expect(vote.poses).toContain('vote')
    })

    it('is non-looping', () => {
      expect(vote.loop).toBe(false)
    })

    it('starts with idle', () => {
      expect(vote.poses[0]).toBe('idle')
    })
  })

  describe('talk animation', () => {
    const talk = HD_ANIMATION_REGISTRY['talk']

    it('exists in registry', () => {
      expect(talk).toBeDefined()
    })

    it('cycles through talk1 and talk2 poses', () => {
      expect(talk.poses).toContain('talk1')
      expect(talk.poses).toContain('talk2')
    })

    it('is non-looping', () => {
      expect(talk.loop).toBe(false)
    })
  })

  describe('dead animation', () => {
    const dead = HD_ANIMATION_REGISTRY['dead']

    it('exists in registry', () => {
      expect(dead).toBeDefined()
    })

    it('includes the dead pose', () => {
      expect(dead.poses).toContain('dead')
    })

    it('ends on dead (does not return to idle)', () => {
      expect(dead.poses[dead.poses.length - 1]).toBe('dead')
    })
  })

  describe('getHDAnimation', () => {
    it('returns named animation when it exists', () => {
      const result = getHDAnimation('think')
      expect(result.name).toBe('think')
    })

    it('returns fallback for unknown animation name', () => {
      const result = getHDAnimation('nonexistent_anim')
      expect(result).toBe(HD_FALLBACK_ANIMATION)
    })
  })

  describe('getHDAnimationForAction', () => {
    it('maps action type through ACTION_TO_ANIMATION then REGISTRY', () => {
      const result = getHDAnimationForAction('gather')
      expect(result.name).toBe('gather')
    })

    it('returns fallback for unmapped action type', () => {
      const result = getHDAnimationForAction('totally_unknown_action')
      expect(result).toBe(HD_FALLBACK_ANIMATION)
    })

    it('meeting_speech maps to talk animation', () => {
      expect(HD_ACTION_TO_ANIMATION['meeting_speech']).toBe('talk')
      const result = getHDAnimationForAction('meeting_speech')
      expect(result.name).toBe('talk')
    })

    it('meeting_vote maps to vote animation', () => {
      expect(HD_ACTION_TO_ANIMATION['meeting_vote']).toBe('vote')
      const result = getHDAnimationForAction('meeting_vote')
      expect(result.name).toBe('vote')
    })
  })

  describe('HD_FALLBACK_ANIMATION', () => {
    it('is non-looping', () => {
      expect(HD_FALLBACK_ANIMATION.loop).toBe(false)
    })

    it('has poses', () => {
      expect(HD_FALLBACK_ANIMATION.poses.length).toBeGreaterThan(0)
    })
  })

  describe('all registered animations have valid structure', () => {
    const entries = Object.entries(HD_ANIMATION_REGISTRY)

    it.each(entries)('%s has at least one pose', (name, anim) => {
      expect(anim.poses.length).toBeGreaterThan(0)
    })

    it.each(entries)('%s has positive speed', (name, anim) => {
      expect(anim.speed).toBeGreaterThan(0)
    })

    it.each(entries)('%s has boolean loop', (name, anim) => {
      expect(typeof anim.loop).toBe('boolean')
    })

    it.each(entries)('%s name matches registry key', (name, anim) => {
      expect(anim.name).toBe(name)
    })
  })

  describe('ACTION_TO_ANIMATION completeness', () => {
    it('every mapped animation name exists in the registry', () => {
      for (const [, animName] of Object.entries(HD_ACTION_TO_ANIMATION)) {
        expect(HD_ANIMATION_REGISTRY[animName]).toBeDefined()
      }
    })
  })
})
