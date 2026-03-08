import { usePathfinding } from '@/composables/usePathfinding'
import type { MapData, TileDef, LocationDef } from '@/types/world'
import type { UsePixiWorld } from '@/composables/usePixiWorld'

function makeTile(x: number, y: number, tileType: TileDef['tileType'] = 'grass', walkable = true, locationId: string | null = null): TileDef {
  return { x, y, tileType, walkable, locationId }
}

function makeLoc(id: string, x: number, y: number): LocationDef {
  return { id, name: id, type: 'generic', x, y, width: 1, height: 1, capacity: 10, description: '' }
}

function makeMapData(tiles: TileDef[], locations: LocationDef[] = []): MapData {
  return { name: 'test-map', width: 10, height: 10, tiles, locations }
}

describe('usePathfinding — extended', () => {
  describe('LOCATION_ALIASES resolution', () => {
    it('resolves town_square to town_hall tiles', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'grass', true, 'town_hall'),
        makeTile(1, 0, 'grass', true, 'town_hall'),
      ]))

      const tiles = pf.resolveLocationTiles('town_square')
      expect(tiles).not.toBeNull()
      expect(tiles).toHaveLength(2)
    })

    it('resolves community_hall to town_hall tiles', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(3, 3, 'grass', true, 'town_hall'),
      ]))

      const tiles = pf.resolveLocationTiles('community_hall')
      expect(tiles).not.toBeNull()
      expect(tiles).toHaveLength(1)
    })

    it('resolves meeting_hall to town_hall tiles', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(2, 2, 'path', true, 'town_hall'),
      ]))

      const tiles = pf.resolveLocationTiles('meeting_hall')
      expect(tiles).not.toBeNull()
    })

    it('prefers direct match over alias', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'grass', true, 'town_square'),
        makeTile(5, 5, 'grass', true, 'town_hall'),
      ]))

      // town_square exists directly, should not fall back to alias
      const tiles = pf.resolveLocationTiles('town_square')
      expect(tiles).not.toBeNull()
      expect(tiles).toHaveLength(1)
      expect(tiles![0]).toEqual({ x: 0, y: 0 })
    })
  })

  describe('getSpawnTiles', () => {
    it('excludes building tiles from spawn', () => {
      const pf = usePathfinding()
      const data = makeMapData([
        makeTile(0, 0, 'grass', true),
        makeTile(1, 0, 'building', true),
        makeTile(2, 0, 'path', true),
        makeTile(3, 0, 'fence', false),
      ])

      const tiles = pf.getSpawnTiles(data)
      expect(tiles).toHaveLength(2) // grass + path
      for (const t of tiles) {
        expect(t.x).not.toBe(1) // no building
        expect(t.x).not.toBe(3) // no fence (non-walkable)
      }
    })

    it('returns only x,y coordinates (no extra tile properties)', () => {
      const pf = usePathfinding()
      const data = makeMapData([
        makeTile(5, 7, 'grass', true, 'some_loc'),
      ])

      const tiles = pf.getSpawnTiles(data)
      expect(tiles).toHaveLength(1)
      expect(tiles[0]).toEqual({ x: 5, y: 7 })
      // Should not have tileType, walkable, locationId etc.
      expect(Object.keys(tiles[0]).sort()).toEqual(['x', 'y'])
    })

    it('returns shuffled order (not always identical to input)', () => {
      const pf = usePathfinding()
      const tileCount = 50
      const tileList: TileDef[] = []
      for (let i = 0; i < tileCount; i++) {
        tileList.push(makeTile(i, 0, 'grass', true))
      }
      const data = makeMapData(tileList)

      // Run multiple times — at least one should differ from input order
      const results = Array.from({ length: 5 }, () => pf.getSpawnTiles(data))
      const inputOrder = tileList.map(t => t.x).join(',')
      const allSame = results.every(r => r.map(t => t.x).join(',') === inputOrder)

      // With 50 tiles and 5 runs, probability of all being identical is astronomically low
      expect(allSame).toBe(false)
    })
  })

  describe('moveAgentToLocation', () => {
    function makeMockWorld(agents: Map<string, { tileX: number; tileY: number; name: string }>): UsePixiWorld {
      return {
        getAgents: () => agents,
        moveAgentAlongPath: jest.fn((_id, _path, cb) => cb?.()),
        moveAgentTo: jest.fn(),
      } as unknown as UsePixiWorld
    }

    it('calls onComplete when location has no walkable tiles', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([]))

      const world = makeMockWorld(new Map())
      const onComplete = jest.fn()

      pf.moveAgentToLocation(world, 'agent-1', 'nonexistent_place', onComplete)

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('calls onComplete when agent sprite is not found', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'grass', true, 'camp'),
      ]))

      const world = makeMockWorld(new Map()) // empty agent map
      const onComplete = jest.fn()

      pf.moveAgentToLocation(world, 'missing-agent', 'camp', onComplete)

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('calls onComplete without error when callback is undefined', () => {
      const pf = usePathfinding()
      pf.buildIndex(makeMapData([]))
      const world = makeMockWorld(new Map())

      // Should not throw even without onComplete
      expect(() => {
        pf.moveAgentToLocation(world, 'agent-1', 'nowhere')
      }).not.toThrow()
    })

    it('moves agent along path when valid path exists', () => {
      const pf = usePathfinding()
      // Create a simple line of walkable tiles
      pf.buildIndex(makeMapData([
        makeTile(0, 0, 'grass', true, 'start'),
        makeTile(1, 0, 'grass', true),
        makeTile(2, 0, 'grass', true),
        makeTile(3, 0, 'grass', true, 'end'),
      ]))

      const agents = new Map([
        ['agent-1', { tileX: 0, tileY: 0, name: 'Alice' }],
      ])
      const world = makeMockWorld(agents)
      const onComplete = jest.fn()

      pf.moveAgentToLocation(world, 'agent-1', 'end', onComplete)

      // Should have called moveAgentAlongPath (or moveAgentTo as fallback)
      const moveAlongPath = world.moveAgentAlongPath as jest.Mock
      const moveTo = world.moveAgentTo as jest.Mock
      expect(moveAlongPath.mock.calls.length + moveTo.mock.calls.length).toBeGreaterThan(0)
    })
  })
})
