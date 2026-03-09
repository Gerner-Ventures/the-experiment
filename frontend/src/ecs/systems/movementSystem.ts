/**
 * Movement System — interpolates entity positions between tiles.
 *
 * Reads: PathState (progress, from/to positions)
 * Writes: Position (screenX, screenY via lerp)
 */

import type { World } from 'bitecs'
import { query } from 'bitecs'
import { Position, PathState } from '../components'
import { tileToScreen } from '@/components/world/pixi/isometric-utils'

export function movementSystem(world: World): void {
  const entities = query(world, [Position, PathState])

  for (const eid of entities) {
    const progress = PathState.progress[eid] as number
    const fromX = PathState.fromX[eid] as number
    const fromY = PathState.fromY[eid] as number
    const toX = PathState.toX[eid] as number
    const toY = PathState.toY[eid] as number

    // Lerp tile position
    const lerpX = fromX + (toX - fromX) * progress
    const lerpY = fromY + (toY - fromY) * progress

    // Update screen position
    const screen = tileToScreen(lerpX, lerpY)
    Position.screenX[eid] = screen.x
    Position.screenY[eid] = screen.y

    // Update logical position (snaps to target tile when progress = 1)
    if (progress >= 1) {
      Position.x[eid] = toX
      Position.y[eid] = toY
    }
  }
}
