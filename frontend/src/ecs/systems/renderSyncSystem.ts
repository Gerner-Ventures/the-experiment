/**
 * Render Sync System — pushes ECS state to the renderer.
 *
 * Reads: Position, SpriteRef, AnimState, PathState
 * Writes: nothing (side effects — updates renderer sprites)
 *
 * Runs last in the system pipeline.
 */

import type { World } from 'bitecs'
import { query, hasComponent } from 'bitecs'
import { Position, SpriteRef, AnimState, PathState } from '../components'
import { getAnimationByIndex } from './animationSystem'

export interface RenderBridge {
  /** Update sprite position and z-index */
  updateSpritePosition(spriteIndex: number, screenX: number, screenY: number, tileX: number, tileY: number): void
  /** Update sprite texture to a specific pose */
  updateSpriteTexture(spriteIndex: number, pose: string): void
}

export function renderSyncSystem(world: World, _dt: number, bridge: RenderBridge): void {
  const entities = query(world, [Position, SpriteRef])

  for (const eid of entities) {
    const spriteIndex = SpriteRef.spriteIndex[eid] as number
    const screenX = Position.screenX[eid] as number
    const screenY = Position.screenY[eid] as number
    const tileX = Position.x[eid] as number
    const tileY = Position.y[eid] as number

    bridge.updateSpritePosition(spriteIndex, screenX, screenY, tileX, tileY)

    // Sync animation pose
    if (hasComponent(world, eid, AnimState)) {
      const animIndex = AnimState.animIndex[eid] as number
      const frameIndex = AnimState.frameIndex[eid] as number
      const anim = getAnimationByIndex(animIndex)
      if (anim && frameIndex < anim.poses.length) {
        bridge.updateSpriteTexture(spriteIndex, anim.poses[frameIndex])
      }
    } else if (!hasComponent(world, eid, PathState)) {
      // Not animating and not moving — idle pose
      bridge.updateSpriteTexture(spriteIndex, 'idle')
    }
  }
}
