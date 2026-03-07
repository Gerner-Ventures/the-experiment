import { MAP_THEMES } from '@/config/map-themes'
import { DEFAULT_TOWN } from '@/config/default-town'
import type { MapTheme, TilePalette, MapData } from '@/types/world'

describe('world type contracts', () => {
  describe('MapTheme satisfies interface', () => {
    it.each(MAP_THEMES.map(t => [t.id, t] as [string, MapTheme]))(
      'theme "%s" matches MapTheme interface shape',
      (_id, theme) => {
        // Required string fields
        expect(typeof theme.id).toBe('string')
        expect(typeof theme.name).toBe('string')
        expect(typeof theme.description).toBe('string')
        expect(typeof theme.buildingStyle).toBe('string')

        // tilePalette is an object with arrays of 3 strings
        expect(typeof theme.tilePalette).toBe('object')

        // ambient is an object
        expect(typeof theme.ambient).toBe('object')

        // preview is array of strings
        expect(Array.isArray(theme.preview)).toBe(true)
      },
    )
  })

  describe('MapData satisfies interface', () => {
    it('DEFAULT_TOWN has required MapData fields', () => {
      const map: MapData = DEFAULT_TOWN
      expect(typeof map.name).toBe('string')
      expect(typeof map.width).toBe('number')
      expect(typeof map.height).toBe('number')
      expect(Array.isArray(map.tiles)).toBe(true)
      expect(Array.isArray(map.locations)).toBe(true)
    })

    it('tiles have required TileDef fields', () => {
      const tile = DEFAULT_TOWN.tiles[0]
      expect(typeof tile.x).toBe('number')
      expect(typeof tile.y).toBe('number')
      expect(typeof tile.tileType).toBe('string')
      expect(typeof tile.walkable).toBe('boolean')
    })

    it('locations have required LocationDef fields', () => {
      const loc = DEFAULT_TOWN.locations[0]
      expect(typeof loc.id).toBe('string')
      expect(typeof loc.name).toBe('string')
      expect(typeof loc.type).toBe('string')
      expect(typeof loc.x).toBe('number')
      expect(typeof loc.y).toBe('number')
      expect(typeof loc.width).toBe('number')
      expect(typeof loc.height).toBe('number')
      expect(typeof loc.capacity).toBe('number')
      expect(typeof loc.description).toBe('string')
    })
  })

  describe('theme-to-map compatibility', () => {
    it('every tile type in the map has a matching palette key in every theme', () => {
      const tileTypes = [...new Set(DEFAULT_TOWN.tiles.map(t => t.tileType))]
      for (const theme of MAP_THEMES) {
        for (const type of tileTypes) {
          const paletteEntry = theme.tilePalette[type as keyof TilePalette]
          expect(paletteEntry).toBeDefined()
          expect(paletteEntry).toHaveLength(3)
        }
      }
    })
  })
})
