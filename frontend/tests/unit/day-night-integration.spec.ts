/**
 * Integration tests for the day/night cycle wiring:
 * - map-themes.ts ↔ day-night-palettes.ts alignment
 * - DayNightConfig ↔ ThemeDayNightPalette consistency
 */

import { MAP_THEMES } from '@/config/map-themes'
import { getThemePalette, PHASE_ARC_POSITIONS } from '@/config/day-night-palettes'
import type { RoundPhase } from '@/types/websocket'

const VISUAL_PHASES: RoundPhase[] = ['dawn', 'morning', 'midday', 'afternoon', 'night']

describe('day/night config ↔ palette alignment', () => {
  it('every theme with dayNight.enabled has a matching palette', () => {
    for (const theme of MAP_THEMES) {
      if (theme.dayNight?.enabled) {
        const palette = getThemePalette(theme.id)
        expect(palette).toBeDefined()
        expect(palette!.themeId).toBe(theme.id)
      }
    }
  })

  it('every palette has a matching theme', () => {
    for (const theme of MAP_THEMES) {
      const palette = getThemePalette(theme.id)
      if (palette) {
        const matchingTheme = MAP_THEMES.find(t => t.id === palette.themeId)
        expect(matchingTheme).toBeDefined()
      }
    }
  })

  it('matrix theme config and palette agree on digital variant', () => {
    const theme = MAP_THEMES.find(t => t.id === 'matrix')!
    const palette = getThemePalette('matrix')!
    expect(theme.dayNight?.celestialVariant).toBe('digital')
    expect(palette.celestialVariant).toBe('digital')
  })

  it('non-digital themes have no celestialVariant set', () => {
    for (const theme of MAP_THEMES) {
      if (theme.id === 'matrix') continue
      const palette = getThemePalette(theme.id)!
      expect(palette.celestialVariant).toBeUndefined()
    }
  })
})

describe('phase arc positions are consistent with palettes', () => {
  it('every phase with arc position >= 0 has palettes in all themes', () => {
    for (const phase of VISUAL_PHASES) {
      const arcPos = PHASE_ARC_POSITIONS[phase]
      expect(arcPos).toBeGreaterThanOrEqual(0)

      for (const theme of MAP_THEMES) {
        if (!theme.dayNight?.enabled) continue
        const palette = getThemePalette(theme.id)!
        expect(palette.phases[phase]).toBeDefined()
      }
    }
  })

  it('gm_plan has no palette entry in any theme', () => {
    for (const theme of MAP_THEMES) {
      const palette = getThemePalette(theme.id)
      if (palette) {
        expect(palette.phases.gm_plan).toBeUndefined()
      }
    }
  })
})

describe('brightness progression makes physical sense', () => {
  it.each(MAP_THEMES.filter(t => t.dayNight?.enabled).map(t => t.id))(
    'theme "%s" brightness: dawn < midday and night < midday',
    (themeId) => {
      const palette = getThemePalette(themeId)!
      const dawn = palette.phases.dawn!
      const midday = palette.phases.midday!
      const night = palette.phases.night!

      expect(dawn.filterBrightness).toBeLessThanOrEqual(midday.filterBrightness)
      expect(night.filterBrightness).toBeLessThan(midday.filterBrightness)
    },
  )
})
