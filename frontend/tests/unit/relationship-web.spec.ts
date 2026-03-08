import {
  ARCHETYPE_COLORS,
  FORCE_CONFIG,
  trustToColor,
  interactionThickness,
} from '@/config/relationship-web'
import type { GoalArchetype } from '@/types/agent'

describe('relationship-web config', () => {
  describe('ARCHETYPE_COLORS', () => {
    const allArchetypes: GoalArchetype[] = [
      'communal_survival',
      'protective_attachment',
      'status_power',
      'resource_control',
      'escape_exit',
      'truth_revelation',
      'social_disruption',
      'belief_transformation',
      'personal_redemption',
      'obsession_desire',
    ]

    it('has a color for every GoalArchetype', () => {
      for (const arch of allArchetypes) {
        expect(ARCHETYPE_COLORS[arch]).toBeDefined()
        expect(ARCHETYPE_COLORS[arch]).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    })

    it('has exactly 10 archetype colors', () => {
      expect(Object.keys(ARCHETYPE_COLORS)).toHaveLength(10)
    })

    it('all colors are unique', () => {
      const colors = Object.values(ARCHETYPE_COLORS)
      expect(new Set(colors).size).toBe(colors.length)
    })
  })

  describe('FORCE_CONFIG', () => {
    it('has negative charge strength (repulsive)', () => {
      expect(FORCE_CONFIG.chargeStrength).toBeLessThan(0)
    })

    it('has positive link distance', () => {
      expect(FORCE_CONFIG.linkDistance).toBeGreaterThan(0)
    })

    it('has alpha decay between 0 and 1', () => {
      expect(FORCE_CONFIG.alphaDecay).toBeGreaterThan(0)
      expect(FORCE_CONFIG.alphaDecay).toBeLessThan(1)
    })
  })

  describe('trustToColor', () => {
    it('returns bright green for high trust (>50)', () => {
      expect(trustToColor(80)).toBe('#00e5a0')
      expect(trustToColor(51)).toBe('#00e5a0')
      expect(trustToColor(100)).toBe('#00e5a0')
    })

    it('returns teal for moderate trust (21-50)', () => {
      expect(trustToColor(50)).toBe('#34d399')
      expect(trustToColor(21)).toBe('#34d399')
    })

    it('returns gray for neutral trust (-19 to 20)', () => {
      expect(trustToColor(0)).toBe('#555863')
      expect(trustToColor(20)).toBe('#555863')
      expect(trustToColor(-19)).toBe('#555863')
    })

    it('returns orange for low trust (-49 to -20)', () => {
      expect(trustToColor(-20)).toBe('#f57542')
      expect(trustToColor(-49)).toBe('#f57542')
    })

    it('returns red for very low trust (<-50)', () => {
      expect(trustToColor(-51)).toBe('#f54242')
      expect(trustToColor(-100)).toBe('#f54242')
    })

    it('handles boundary values correctly', () => {
      // Exactly at boundaries — uses strict > comparison
      expect(trustToColor(50)).toBe('#34d399')   // 50 is not > 50, falls to next tier
      expect(trustToColor(20)).toBe('#555863')   // 20 is not > 20, falls to neutral
      expect(trustToColor(-20)).toBe('#f57542')  // -20 is not > -20, falls to orange
      expect(trustToColor(-50)).toBe('#f54242')   // -50 is not > -50, falls to red
    })
  })

  describe('interactionThickness', () => {
    it('returns 1 for 0 interactions', () => {
      expect(interactionThickness(0)).toBe(1)
    })

    it('returns 1 for 1 interaction', () => {
      expect(interactionThickness(1)).toBe(1)
    })

    it('returns 1 for 2 interactions', () => {
      expect(interactionThickness(2)).toBe(1)
    })

    it('returns 2 for 3 interactions', () => {
      expect(interactionThickness(3)).toBe(2)
    })

    it('caps at 5 for many interactions', () => {
      expect(interactionThickness(100)).toBe(5)
      expect(interactionThickness(50)).toBe(5)
    })

    it('is monotonically non-decreasing', () => {
      let prev = interactionThickness(0)
      for (let i = 1; i <= 20; i++) {
        const curr = interactionThickness(i)
        expect(curr).toBeGreaterThanOrEqual(prev)
        prev = curr
      }
    })
  })
})
