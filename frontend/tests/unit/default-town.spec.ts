import { DEFAULT_TOWN } from '@/config/default-town'

describe('default-town map data', () => {
  it('has correct dimensions', () => {
    expect(DEFAULT_TOWN.width).toBe(20)
    expect(DEFAULT_TOWN.height).toBe(20)
  })

  it('has 400 tiles (20x20)', () => {
    expect(DEFAULT_TOWN.tiles).toHaveLength(400)
  })

  it('tiles cover the full grid without gaps', () => {
    const seen = new Set<string>()
    for (const tile of DEFAULT_TOWN.tiles) {
      const key = `${tile.x},${tile.y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        expect(seen.has(`${x},${y}`)).toBe(true)
      }
    }
  })

  it('all tiles have valid tile types', () => {
    const validTypes = ['grass', 'path', 'building', 'fence', 'field']
    for (const tile of DEFAULT_TOWN.tiles) {
      expect(validTypes).toContain(tile.tileType)
    }
  })

  it('fence tiles form the perimeter border', () => {
    for (const tile of DEFAULT_TOWN.tiles) {
      if (tile.x === 0 || tile.x === 19 || tile.y === 0 || tile.y === 19) {
        expect(tile.tileType).toBe('fence')
        expect(tile.walkable).toBe(false)
      }
    }
  })

  it('fence tiles are not walkable', () => {
    const fenceTiles = DEFAULT_TOWN.tiles.filter(t => t.tileType === 'fence')
    for (const tile of fenceTiles) {
      expect(tile.walkable).toBe(false)
    }
  })

  it('has walkable tiles in the interior', () => {
    const interiorWalkable = DEFAULT_TOWN.tiles.filter(
      t => t.walkable && t.x > 0 && t.x < 19 && t.y > 0 && t.y < 19
    )
    expect(interiorWalkable.length).toBeGreaterThan(100)
  })

  it('has at least 10 locations', () => {
    expect(DEFAULT_TOWN.locations.length).toBeGreaterThanOrEqual(10)
  })

  it('each location has required fields', () => {
    for (const loc of DEFAULT_TOWN.locations) {
      expect(loc.id).toBeTruthy()
      expect(loc.name).toBeTruthy()
      expect(loc.type).toBeTruthy()
      expect(typeof loc.x).toBe('number')
      expect(typeof loc.y).toBe('number')
      expect(typeof loc.width).toBe('number')
      expect(typeof loc.height).toBe('number')
      expect(typeof loc.capacity).toBe('number')
    }
  })

  it('location IDs are unique', () => {
    const ids = DEFAULT_TOWN.locations.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('town_hall location exists and has capacity for all agents', () => {
    const townHall = DEFAULT_TOWN.locations.find(l => l.id === 'town_hall')
    expect(townHall).toBeDefined()
    expect(townHall!.capacity).toBeGreaterThanOrEqual(12)
  })

  it('locked_building location exists', () => {
    const locked = DEFAULT_TOWN.locations.find(l => l.id === 'locked_building')
    expect(locked).toBeDefined()
    expect(locked!.type).toBe('mystery')
  })

  it('camelCase conversion from snake_case works for tiles', () => {
    const tile = DEFAULT_TOWN.tiles[0]
    expect(tile).toHaveProperty('tileType')
    expect(tile).toHaveProperty('locationId')
    // Should NOT have snake_case
    expect(tile).not.toHaveProperty('tile_type')
    expect(tile).not.toHaveProperty('location_id')
  })

  it('building tiles reference valid location IDs', () => {
    const locationIds = new Set(DEFAULT_TOWN.locations.map(l => l.id))
    const buildingTiles = DEFAULT_TOWN.tiles.filter(t => t.tileType === 'building' && t.locationId)
    for (const tile of buildingTiles) {
      expect(locationIds.has(tile.locationId!)).toBe(true)
    }
  })

  it('path tiles form a connected network', () => {
    const pathTiles = DEFAULT_TOWN.tiles.filter(t => t.tileType === 'path')
    expect(pathTiles.length).toBeGreaterThan(10)
  })
})
