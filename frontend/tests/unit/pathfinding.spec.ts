import { usePathfinding } from '@/composables/usePathfinding'
import { findPath } from '@/components/world/pixi/pathfinding'
import type { MapData, TileDef, LocationDef } from '@/types/world'

function makeTile(x: number, y: number, tileType: TileDef['tileType'] = 'grass', walkable = true, locationId: string | null = null): TileDef {
  return { x, y, tileType, walkable, locationId }
}

function makeLoc(id: string, x: number, y: number): LocationDef {
  return { id, name: id, type: 'generic', x, y, width: 1, height: 1, capacity: 10, description: '' }
}

function makeMapData(tiles: TileDef[], locations: LocationDef[] = []): MapData {
  return {
    name: 'test-map',
    width: 10,
    height: 10,
    tiles,
    locations,
  }
}

describe('pathfinding (BFS)', () => {
  it('finds a straight-line path', () => {
    const isWalkable = (x: number, y: number) => x >= 0 && x <= 5 && y === 0
    const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, isWalkable)
    expect(path).not.toBeNull()
    expect(path).toHaveLength(3)
    expect(path![2]).toEqual({ x: 3, y: 0 })
  })

  it('returns empty array when already at destination', () => {
    const path = findPath({ x: 2, y: 2 }, { x: 2, y: 2 }, () => true)
    expect(path).toEqual([])
  })

  it('returns null when no path exists', () => {
    // Island: only (0,0) is walkable, dest is (2,2)
    const isWalkable = (x: number, y: number) => x === 0 && y === 0
    const path = findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, isWalkable)
    expect(path).toBeNull()
  })

  it('routes around obstacles', () => {
    // 3x3 grid, center blocked
    const blocked = new Set(['1,1'])
    const isWalkable = (x: number, y: number) =>
      x >= 0 && x <= 2 && y >= 0 && y <= 2 && !blocked.has(`${x},${y}`)
    const path = findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, isWalkable)
    expect(path).not.toBeNull()
    // Should not go through (1,1)
    for (const p of path!) {
      expect(`${p.x},${p.y}`).not.toBe('1,1')
    }
  })

  it('respects maxVisited limit', () => {
    const path = findPath({ x: 0, y: 0 }, { x: 50, y: 50 }, () => true, 10)
    expect(path).toBeNull()
  })
})

describe('usePathfinding', () => {
  describe('buildIndex', () => {
    it('excludes building tiles from walkable set', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'grass', true),
        makeTile(1, 0, 'building', true),
        makeTile(2, 0, 'path', true),
      ]))
      expect(pf.isWalkable(0, 0)).toBe(true)
      expect(pf.isWalkable(1, 0)).toBe(false) // building
      expect(pf.isWalkable(2, 0)).toBe(true)
    })

    it('excludes non-walkable tiles', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'fence', false),
        makeTile(1, 0, 'grass', true),
      ]))
      expect(pf.isWalkable(0, 0)).toBe(false)
      expect(pf.isWalkable(1, 0)).toBe(true)
    })

    it('indexes location tiles excluding buildings', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'building', true, 'town_hall'),
        makeTile(1, 0, 'grass', true, 'town_hall'),
        makeTile(2, 0, 'path', true, 'town_hall'),
      ]))
      const tiles = pf.resolveLocationTiles('town_hall')
      expect(tiles).not.toBeNull()
      expect(tiles).toHaveLength(2) // only grass and path
      expect(tiles!.every(t => !(t.x === 0 && t.y === 0))).toBe(true) // no building tile
    })

    it('falls back to nearby pathable tiles for building-only locations', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData(
        [
          makeTile(5, 5, 'building', true, 'store'),
          makeTile(4, 5, 'grass', true),
          makeTile(6, 5, 'grass', true),
        ],
        [makeLoc('store', 5, 5)],
      ))
      const tiles = pf.resolveLocationTiles('store')
      expect(tiles).not.toBeNull()
      // Should be nearby grass tiles, not the building itself
      expect(tiles!.every(t => !(t.x === 5 && t.y === 5))).toBe(true)
    })
  })

  describe('resolveLocationTiles', () => {
    it('resolves aliases', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'grass', true, 'town_hall'),
      ]))
      // town_square is an alias for town_hall
      const tiles = pf.resolveLocationTiles('town_square')
      expect(tiles).not.toBeNull()
      expect(tiles).toHaveLength(1)
    })

    it('returns null for unknown location', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'grass', true),
      ]))
      expect(pf.resolveLocationTiles('nonexistent')).toBeNull()
    })
  })

  describe('getSpawnTiles', () => {
    it('excludes building tiles', () => {
      const pf = usePathfinding()
      const data = makeMapData([
        makeTile(0, 0, 'grass', true),
        makeTile(1, 0, 'building', true),
        makeTile(2, 0, 'path', true),
        makeTile(3, 0, 'fence', false),
      ])
      const tiles = pf.getSpawnTiles(data)
      expect(tiles).toHaveLength(2) // grass + path only
      expect(tiles.some(t => t.x === 1)).toBe(false) // no building
      expect(tiles.some(t => t.x === 3)).toBe(false) // no fence
    })

    it('returns empty array when no pathable tiles', () => {
      const pf = usePathfinding()
      const data = makeMapData([
        makeTile(0, 0, 'building', true),
        makeTile(1, 0, 'fence', false),
      ])
      const tiles = pf.getSpawnTiles(data)
      expect(tiles).toHaveLength(0)
    })
  })
})
