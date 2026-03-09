import type { MapData } from '@/types/world'
import type { UseGameWorld } from '@/composables/useGameWorld'
import { findPath } from '@/components/world/pixi/pathfinding'

/**
 * Composable that manages pathfinding, location indexing, and agent movement.
 * Extracts business logic from PixiWorld.vue so the component stays thin.
 */

/**
 * Backend location IDs that don't match map tile locationId values.
 * Kept at module scope to avoid re-creation per composable call.
 */
const LOCATION_ALIASES: Record<string, string> = {
  town_square: 'town_hall',
  community_hall: 'town_hall',
  meeting_hall: 'town_hall',
}

export function usePathfinding() {
  // Location → walkable tiles index for fast lookup
  const locationTilesMap = new Map<string, { x: number; y: number }[]>()

  // Walkability lookup for BFS pathfinding
  const walkableSet = new Set<string>()

  let mapData: MapData | null = null

  /** Build the location and walkability indexes from map data. */
  function buildIndex(data: MapData) {
    mapData = data
    locationTilesMap.clear()
    walkableSet.clear()

    for (const tile of data.tiles) {
      const k = `${tile.x},${tile.y}`

      // Buildings are obstacles for pathfinding — agents walk around them
      if (tile.walkable && tile.tileType !== 'building') {
        walkableSet.add(k)
      }

      // Location index: only non-building walkable tiles (agents stand next to buildings)
      if (tile.locationId && tile.walkable && tile.tileType !== 'building') {
        let tiles = locationTilesMap.get(tile.locationId)
        if (!tiles) {
          tiles = []
          locationTilesMap.set(tile.locationId, tiles)
        }
        tiles.push({ x: tile.x, y: tile.y })
      }
    }

    // For locations with no pathable tiles (buildings, perimeter_fence, etc.),
    // use nearby non-building walkable tiles so agents stand adjacent
    for (const loc of data.locations) {
      if (!locationTilesMap.has(loc.id)) {
        const nearby = findNearbyPathableTiles(loc.x, loc.y, 3)
        if (nearby.length > 0) {
          locationTilesMap.set(loc.id, nearby)
          console.debug(`[Pathfinding] ${loc.id}: using ${nearby.length} adjacent tiles`)
        }
      }
    }

    console.debug('[Pathfinding] Index built:', locationTilesMap.size, 'locations,', walkableSet.size, 'pathable tiles')
  }

  /** Find non-building walkable tiles near a coordinate. */
  function findNearbyPathableTiles(cx: number, cy: number, radius: number): { x: number; y: number }[] {
    if (!mapData) return []
    const results: { x: number; y: number }[] = []
    for (const tile of mapData.tiles) {
      if (tile.walkable && tile.tileType !== 'building'
        && Math.abs(tile.x - cx) <= radius && Math.abs(tile.y - cy) <= radius) {
        results.push({ x: tile.x, y: tile.y })
      }
    }
    return results
  }

  function isWalkable(x: number, y: number): boolean {
    return walkableSet.has(`${x},${y}`)
  }

  /** Resolve a location ID to walkable tiles, with alias fallback. */
  function resolveLocationTiles(locationId: string): { x: number; y: number }[] | null {
    let tiles = locationTilesMap.get(locationId)
    if (!tiles || tiles.length === 0) {
      const alias = LOCATION_ALIASES[locationId]
      if (alias) {
        tiles = locationTilesMap.get(alias)
        if (tiles && tiles.length > 0) {
          console.debug(`[Pathfinding] Resolved alias "${locationId}" → "${alias}"`)
        }
      }
    }
    return tiles && tiles.length > 0 ? tiles : null
  }

  /**
   * Move an agent to a named location using BFS pathfinding (tile-by-tile).
   * Calls onComplete when the agent arrives (or immediately if no path found).
   */
  function moveAgentToLocation(
    world: UseGameWorld,
    agentId: string,
    locationId: string,
    onComplete?: () => void,
  ) {
    const tiles = resolveLocationTiles(locationId)
    if (!tiles) {
      console.debug(`[Pathfinding] No walkable tiles for location "${locationId}", skipping move for ${agentId}`)
      onComplete?.()
      return
    }

    const agentSprite = world.getAgents().get(agentId)
    if (!agentSprite) {
      console.debug(`[Pathfinding] Agent ${agentId} not found in sprite map`)
      onComplete?.()
      return
    }

    const startTile = { x: agentSprite.tileX, y: agentSprite.tileY }

    // If agent is on a non-pathable tile (building, fence, etc.), snap to nearest pathable tile
    let effectiveStart = startTile
    if (!isWalkable(startTile.x, startTile.y)) {
      const nearby = findNearbyPathableTiles(startTile.x, startTile.y, 2)
      if (nearby.length > 0) {
        effectiveStart = nearby[0]
        console.debug(`[Pathfinding] Agent at non-walkable (${startTile.x},${startTile.y}), snapping to (${effectiveStart.x},${effectiveStart.y})`)
      }
    }

    // Pick a random walkable tile within the destination location
    const destTile = tiles[Math.floor(Math.random() * tiles.length)]

    // BFS pathfinding from current tile to destination
    const path = findPath(effectiveStart, destTile, isWalkable)

    if (path && path.length > 0) {
      const fullPath = effectiveStart !== startTile
        ? [effectiveStart, ...path]
        : path
      console.debug(`[Pathfinding] ${agentSprite.name} → ${locationId}: ${fullPath.length} steps (${startTile.x},${startTile.y}) → (${destTile.x},${destTile.y})`)
      world.moveAgentAlongPath(agentId, fullPath, onComplete)
    } else if (path && path.length === 0) {
      console.debug(`[Pathfinding] ${agentSprite.name} already at ${locationId}`)
      onComplete?.()
    } else {
      // No path found — walk directly as last resort
      console.warn(`[Pathfinding] ${agentSprite.name} no path from (${startTile.x},${startTile.y}) to (${destTile.x},${destTile.y}), direct move`)
      world.moveAgentTo(agentId, destTile.x, destTile.y)
      onComplete?.()
    }
  }

  /** Get shuffled pathable tiles for spawning agents (excludes buildings). */
  function getSpawnTiles(data: MapData): { x: number; y: number }[] {
    const pathable = data.tiles.filter(t => t.walkable && t.tileType !== 'building')
    return shuffle(pathable).map(t => ({ x: t.x, y: t.y }))
  }

  return {
    buildIndex,
    isWalkable,
    resolveLocationTiles,
    moveAgentToLocation,
    getSpawnTiles,
  }
}

/** Fisher-Yates shuffle (unbiased) */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
