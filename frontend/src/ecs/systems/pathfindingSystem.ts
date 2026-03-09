/**
 * Pathfinding System — advances entities along their path waypoints.
 *
 * Each tick, advances progress by MOVE_SPEED * dt. When progress >= 1,
 * snaps to waypoint and advances to the next one. When all waypoints
 * are consumed, removes PathState (which fires the completion observer).
 */

import type { World } from 'bitecs'
import { query, removeComponent } from 'bitecs'
import { Position, PathState } from '../components'
import { MOVE_SPEED } from '@/config/sprites/hd/theme'

/** Path data stored per entity (indexed by entity ID) */
const pathDataMap = new Map<number, { x: number; y: number }[]>()

/** Store a path for an entity. Called by useGameWorld when initiating movement. */
export function setEntityPath(eid: number, path: { x: number; y: number }[]): void {
  pathDataMap.set(eid, path)
}

/** Clean up path data for a destroyed entity. */
export function clearEntityPath(eid: number): void {
  pathDataMap.delete(eid)
}

export function pathfindingSystem(world: World, dt: number): void {
  const entities = query(world, [Position, PathState])

  for (const eid of entities) {
    const path = pathDataMap.get(eid)
    if (!path || path.length === 0) {
      removeComponent(world, eid, PathState)
      pathDataMap.delete(eid)
      continue
    }

    // Advance progress
    PathState.progress[eid] = ((PathState.progress[eid] as number) || 0) + dt * MOVE_SPEED

    if ((PathState.progress[eid] as number) >= 1) {
      // Snap to current waypoint
      const wpIndex = PathState.waypointIndex[eid] as number
      const wp = path[wpIndex]
      Position.x[eid] = wp.x
      Position.y[eid] = wp.y

      const nextIndex = wpIndex + 1
      if (nextIndex >= path.length) {
        // Path complete — remove PathState (fires onRemove observer)
        removeComponent(world, eid, PathState)
        pathDataMap.delete(eid)
      } else {
        // Advance to next waypoint
        PathState.waypointIndex[eid] = nextIndex
        PathState.progress[eid] = 0
        PathState.fromX[eid] = wp.x
        PathState.fromY[eid] = wp.y
        PathState.toX[eid] = path[nextIndex].x
        PathState.toY[eid] = path[nextIndex].y
      }
    }
  }
}
