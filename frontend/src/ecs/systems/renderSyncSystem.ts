/**
 * Render Sync System — pushes ECS state to the renderer.
 *
 * Reads: Position, SpriteRef, AnimState, PathState
 * Writes: nothing (side effects — updates renderer sprites)
 *
 * Supports render interpolation: when alpha + prevPositions are provided,
 * lerps between previous and current Position for smooth visuals during frame drops.
 *
 * Runs last in the system pipeline.
 */

import type { World } from 'bitecs'
import { query, hasComponent } from 'bitecs'
import { Position, SpriteRef, AnimState, PathState, TileRef, WaterState, WATER_VARIANTS } from '../components'
import { getAnimationByIndex } from './animationSystem'

/** Tracks last synced frame per tile entity — avoids redundant texture swaps */
const _lastTileFrame = new Map<number, number>()

/** Clear tile frame tracking (call on map reload/destroy) */
export function resetTileFrameTracking(): void {
  _lastTileFrame.clear()
}

export interface RenderBridge {
  /** Update sprite position and z-index */
  updateSpritePosition(spriteIndex: number, screenX: number, screenY: number, tileX: number, tileY: number): void
  /** Update sprite texture to a specific pose */
  updateSpriteTexture(spriteIndex: number, pose: string): void
  /** Queue a tile sprite texture update (batched, flushed once per frame) */
  queueTileUpdate(tileSpriteIndex: number, frameKey: string): void
  /** Flush all queued tile sprite texture updates */
  flushTileUpdates(): void
}

/** Snapshot of entity positions for render interpolation */
export type PrevPositions = Map<number, { x: number; y: number; screenX: number; screenY: number }>

export function renderSyncSystem(
  world: World,
  _dt: number,
  bridge: RenderBridge,
  alpha: number = 1,
  prevPositions: PrevPositions | null = null,
): void {
  const entities = query(world, [Position, SpriteRef])

  for (const eid of entities) {
    const spriteIndex = SpriteRef.spriteIndex[eid] as number
    const currentScreenX = Position.screenX[eid] as number
    const currentScreenY = Position.screenY[eid] as number
    const tileX = Position.x[eid] as number
    const tileY = Position.y[eid] as number

    // Interpolate between previous and current position for smooth rendering
    let screenX = currentScreenX
    let screenY = currentScreenY

    if (prevPositions && alpha < 1) {
      const prev = prevPositions.get(eid)
      if (prev) {
        screenX = prev.screenX + (currentScreenX - prev.screenX) * alpha
        screenY = prev.screenY + (currentScreenY - prev.screenY) * alpha
      }
    }

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

  // Batch tile updates (water, hazards) — only when frame has changed
  const tileEntities = query(world, [TileRef, WaterState])

  for (const eid of tileEntities) {
    const frame = WaterState.frame[eid] as number
    const lastFrame = _lastTileFrame.get(eid)
    if (lastFrame === frame) continue

    _lastTileFrame.set(eid, frame)
    const variant = WaterState.variant[eid] as number
    const prefix = variant === WATER_VARIANTS.CODE_RIVER ? 'code_river' : 'ocean'
    bridge.queueTileUpdate(TileRef.tileSpriteIndex[eid] as number, `${prefix}_${frame}`)
  }

  bridge.flushTileUpdates()
}
