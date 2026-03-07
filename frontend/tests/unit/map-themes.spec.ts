import { MAP_THEMES, getThemeById } from '@/config/map-themes'
import type { MapTheme, TilePalette } from '@/types/world'

describe('map-themes', () => {
  const expectedThemeIds = ['lord-of-the-flies', 'matrix', 'gladiator', '1984']
  const requiredPaletteKeys: (keyof TilePalette)[] = ['grass', 'path', 'building', 'fence', 'field']

  it('defines exactly 4 themes', () => {
    expect(MAP_THEMES).toHaveLength(4)
  })

  it('all expected theme IDs are present', () => {
    const ids = MAP_THEMES.map(t => t.id)
    for (const id of expectedThemeIds) {
      expect(ids).toContain(id)
    }
  })

  it('each theme has a unique id', () => {
    const ids = MAP_THEMES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(MAP_THEMES.map(t => [t.id, t] as [string, MapTheme]))(
    'theme "%s" has name, description, and preview colors',
    (_id, theme) => {
      expect(theme.name).toBeTruthy()
      expect(theme.description).toBeTruthy()
      expect(theme.preview.length).toBeGreaterThanOrEqual(3)
      for (const color of theme.preview) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    },
  )

  it.each(MAP_THEMES.map(t => [t.id, t] as [string, MapTheme]))(
    'theme "%s" has complete tile palette with all required keys',
    (_id, theme) => {
      for (const key of requiredPaletteKeys) {
        expect(theme.tilePalette[key]).toBeDefined()
        expect(theme.tilePalette[key]).toHaveLength(3)
        for (const color of theme.tilePalette[key]) {
          expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
        }
      }
    },
  )

  it.each(MAP_THEMES.map(t => [t.id, t] as [string, MapTheme]))(
    'theme "%s" has a valid buildingStyle',
    (_id, theme) => {
      expect(['huts', 'wireframe', 'roman', 'brutalist']).toContain(theme.buildingStyle)
    },
  )

  it('each theme has visually distinct palettes', () => {
    const grassColors = MAP_THEMES.map(t => t.tilePalette.grass[0])
    expect(new Set(grassColors).size).toBe(grassColors.length)
  })

  describe('getThemeById', () => {
    it('returns the correct theme for a valid ID', () => {
      const theme = getThemeById('matrix')
      expect(theme).toBeDefined()
      expect(theme!.name).toBe('The Construct')
    })

    it('returns undefined for an invalid ID', () => {
      expect(getThemeById('nonexistent')).toBeUndefined()
    })
  })

  describe('ambient config', () => {
    it('matrix theme has code overlay and scanlines', () => {
      const matrix = getThemeById('matrix')!
      expect(matrix.ambient.overlay).toBe('code')
      expect(matrix.ambient.scanlines).toBe(true)
    })

    it('1984 theme has smog overlay and scanlines', () => {
      const theme = getThemeById('1984')!
      expect(theme.ambient.overlay).toBe('smog')
      expect(theme.ambient.scanlines).toBe(true)
    })

    it('gladiator theme has dust overlay', () => {
      const theme = getThemeById('gladiator')!
      expect(theme.ambient.overlay).toBe('dust')
    })

    it('lord-of-the-flies theme has fog but no overlay', () => {
      const theme = getThemeById('lord-of-the-flies')!
      expect(theme.ambient.fogColor).toBeDefined()
      expect(theme.ambient.overlay).toBeUndefined()
    })
  })
})
