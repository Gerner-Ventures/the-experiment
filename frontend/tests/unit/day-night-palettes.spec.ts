import {
  PHASE_ARC_POSITIONS,
  getThemePalette,
  type ThemeDayNightPalette,
  type PhasePalette,
} from '@/config/day-night-palettes'
import type { RoundPhase } from '@/types/websocket'

const ALL_PHASES: RoundPhase[] = ['gm_plan', 'dawn', 'morning', 'midday', 'afternoon', 'night']
const VISUAL_PHASES: RoundPhase[] = ['dawn', 'morning', 'midday', 'afternoon', 'night']
const THEME_IDS = ['lord-of-the-flies', 'matrix', 'gladiator', '1984']

describe('day-night-palettes', () => {
  describe('PHASE_ARC_POSITIONS', () => {
    it('has an entry for every RoundPhase', () => {
      for (const phase of ALL_PHASES) {
        expect(PHASE_ARC_POSITIONS[phase]).toBeDefined()
      }
    })

    it('gm_plan is -1 (no transition sentinel)', () => {
      expect(PHASE_ARC_POSITIONS.gm_plan).toBe(-1)
    })

    it('visual phases are in ascending order (0-1)', () => {
      let prev = -1
      for (const phase of VISUAL_PHASES) {
        const pos = PHASE_ARC_POSITIONS[phase]
        expect(pos).toBeGreaterThan(prev)
        expect(pos).toBeGreaterThanOrEqual(0)
        expect(pos).toBeLessThanOrEqual(1)
        prev = pos
      }
    })

    it('dawn is near 0 and night is at 1', () => {
      expect(PHASE_ARC_POSITIONS.dawn).toBeLessThan(0.2)
      expect(PHASE_ARC_POSITIONS.night).toBe(1.0)
    })

    it('midday is at 0.5 (apex)', () => {
      expect(PHASE_ARC_POSITIONS.midday).toBe(0.5)
    })
  })

  describe('getThemePalette', () => {
    it('returns a palette for each known theme', () => {
      for (const id of THEME_IDS) {
        const palette = getThemePalette(id)
        expect(palette).toBeDefined()
        expect(palette!.themeId).toBe(id)
      }
    })

    it('returns undefined for unknown theme', () => {
      expect(getThemePalette('nonexistent')).toBeUndefined()
    })
  })

  describe('palette data integrity', () => {
    const palettes = THEME_IDS.map(id => [id, getThemePalette(id)!] as [string, ThemeDayNightPalette])

    it.each(palettes)(
      'theme "%s" has all visual phase palettes',
      (_id, palette) => {
        for (const phase of VISUAL_PHASES) {
          expect(palette.phases[phase]).toBeDefined()
        }
      },
    )

    it.each(palettes)(
      'theme "%s" has no gm_plan palette (meta-phase)',
      (_id, palette) => {
        expect(palette.phases.gm_plan).toBeUndefined()
      },
    )

    it.each(palettes)(
      'theme "%s" has valid hex colors for sun and moon',
      (_id, palette) => {
        const hexPattern = /^#[0-9a-fA-F]{6}$/
        expect(palette.sunColor).toMatch(hexPattern)
        expect(palette.sunGlowColor).toMatch(hexPattern)
        expect(palette.moonColor).toMatch(hexPattern)
        expect(palette.moonGlowColor).toMatch(hexPattern)
      },
    )

    it.each(palettes)(
      'theme "%s" phase palettes have valid brightness and alpha ranges',
      (_id, palette) => {
        for (const phase of VISUAL_PHASES) {
          const pp = palette.phases[phase] as PhasePalette
          expect(pp.filterBrightness).toBeGreaterThan(0)
          expect(pp.filterBrightness).toBeLessThanOrEqual(2)
          expect(pp.sunAlpha).toBeGreaterThanOrEqual(0)
          expect(pp.sunAlpha).toBeLessThanOrEqual(1)
          expect(pp.moonAlpha).toBeGreaterThanOrEqual(0)
          expect(pp.moonAlpha).toBeLessThanOrEqual(1)
          expect(pp.starOpacity).toBeGreaterThanOrEqual(0)
          expect(pp.starOpacity).toBeLessThanOrEqual(1)
        }
      },
    )

    it.each(palettes)(
      'theme "%s" phase palettes have valid sky hex colors',
      (_id, palette) => {
        const hexPattern = /^#[0-9a-fA-F]{6}$/
        for (const phase of VISUAL_PHASES) {
          const pp = palette.phases[phase] as PhasePalette
          expect(pp.skyTop).toMatch(hexPattern)
          expect(pp.skyBottom).toMatch(hexPattern)
        }
      },
    )

    it.each(palettes)(
      'theme "%s" night has moon visible and sun hidden',
      (_id, palette) => {
        const night = palette.phases.night!
        expect(night.sunAlpha).toBe(0)
        expect(night.moonAlpha).toBeGreaterThan(0)
      },
    )

    it.each(palettes)(
      'theme "%s" midday has sun visible and moon hidden',
      (_id, palette) => {
        const midday = palette.phases.midday!
        expect(midday.sunAlpha).toBeGreaterThan(0)
        expect(midday.moonAlpha).toBe(0)
      },
    )

    it.each(palettes)(
      'theme "%s" night is darker than midday',
      (_id, palette) => {
        const night = palette.phases.night!
        const midday = palette.phases.midday!
        expect(night.filterBrightness).toBeLessThan(midday.filterBrightness)
      },
    )
  })

  describe('matrix theme specifics', () => {
    it('uses digital celestial variant', () => {
      const matrix = getThemePalette('matrix')!
      expect(matrix.celestialVariant).toBe('digital')
    })

    it('has no stars in any phase', () => {
      const matrix = getThemePalette('matrix')!
      for (const phase of VISUAL_PHASES) {
        expect(matrix.phases[phase]!.starOpacity).toBe(0)
      }
    })
  })
})
