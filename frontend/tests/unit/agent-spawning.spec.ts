import { DEFAULT_TOWN } from '@/config/default-town'
import { CHARACTER_SPRITES, getSpriteById } from '@/config/character-sprites'
import type { AgentConfig } from '@/types/agent'
import { DEFAULT_PERSONALITY_AXES } from '@/config/agent-options'

describe('agent spawning logic', () => {
  const walkableTiles = DEFAULT_TOWN.tiles.filter(t => t.walkable && t.tileType !== 'building')

  it('there are enough walkable non-building tiles for 12 agents', () => {
    expect(walkableTiles.length).toBeGreaterThanOrEqual(12)
  })

  it('walkable tiles are all interior (not fence)', () => {
    for (const tile of walkableTiles) {
      expect(tile.tileType).not.toBe('fence')
    }
  })

  it('shuffled assignment gives each agent a unique tile when agents < walkable tiles', () => {
    const shuffled = [...walkableTiles].sort(() => Math.random() - 0.5)
    const agentCount = 6
    const assigned = shuffled.slice(0, agentCount)
    const positions = new Set(assigned.map(t => `${t.x},${t.y}`))
    expect(positions.size).toBe(agentCount)
  })

  it('all character sprites referenced by default agents exist', () => {
    const testAgents: AgentConfig[] = CHARACTER_SPRITES.slice(0, 6).map((char, i) => ({
      id: String(i + 1),
      name: `Agent ${i + 1}`,
      characterId: char.id,
      personality: [],
      personalityAxes: { ...DEFAULT_PERSONALITY_AXES },
      secretGoal: 'test goal',
      goalArchetype: '',
      llmModel: 'claude-sonnet-4-6',
    }))

    for (const agent of testAgents) {
      const sprite = getSpriteById(agent.characterId)
      expect(sprite).toBeDefined()
      expect(sprite!.id).toBe(agent.characterId)
    }
  })

  it('walkable neighbor lookup returns valid adjacent tiles', () => {
    // Simulate neighbor lookup logic from IsometricMap
    const tileGrid: Map<string, typeof DEFAULT_TOWN.tiles[0]> = new Map()
    for (const tile of DEFAULT_TOWN.tiles) {
      tileGrid.set(`${tile.x},${tile.y}`, tile)
    }

    function getWalkableNeighbors(x: number, y: number) {
      const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]]
      const neighbors = []
      for (const [dx, dy] of offsets) {
        const tile = tileGrid.get(`${x + dx},${y + dy}`)
        if (tile?.walkable) neighbors.push(tile)
      }
      return neighbors
    }

    // Interior grass tile (5, 5) should have walkable neighbors
    const neighbors = getWalkableNeighbors(5, 5)
    expect(neighbors.length).toBeGreaterThan(0)
    for (const n of neighbors) {
      expect(n.walkable).toBe(true)
      expect(Math.abs(n.x - 5) + Math.abs(n.y - 5)).toBe(1)
    }
  })

  it('fence tiles have no walkable neighbors outside the grid', () => {
    const tileGrid: Map<string, typeof DEFAULT_TOWN.tiles[0]> = new Map()
    for (const tile of DEFAULT_TOWN.tiles) {
      tileGrid.set(`${tile.x},${tile.y}`, tile)
    }

    // Corner tile (0, 0) is fence — neighbors outside grid should not exist
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    for (const [dx, dy] of offsets) {
      const key = `${dx},${dy}`
      const tile = tileGrid.get(key)
      if (tile) {
        // If it exists, it's a fence (border row)
        expect(tile.tileType).toBe('fence')
      }
    }
  })
})
