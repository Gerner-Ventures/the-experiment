/**
 * Water System — animates water tile frames with staggered ripple patterns.
 *
 * Reads/Writes: WaterState (frame, elapsed)
 * Reads: TileRef (for phase offset computation at spawn)
 *
 * Each water tile has a phase offset computed from its grid position,
 * creating organic stagger so adjacent tiles don't animate in lockstep.
 */

import type { World } from 'bitecs'
import { query } from 'bitecs'
import { TileRef, WaterState, WATER_VARIANTS } from '../components'

/** Seconds per frame for ocean water tiles */
export const OCEAN_FRAME_DURATION = 0.4

/** Seconds per frame for code river tiles (slower pulse) */
export const CODE_RIVER_FRAME_DURATION = 0.6

/** Number of animation frames per water variant */
export const WATER_FRAME_COUNT = 4

export function waterSystem(world: World, dt: number): void {
  const entities = query(world, [TileRef, WaterState])

  for (const eid of entities) {
    const variant = WaterState.variant[eid] as number
    const frameDuration = variant === WATER_VARIANTS.CODE_RIVER
      ? CODE_RIVER_FRAME_DURATION
      : OCEAN_FRAME_DURATION

    // Accumulate time (phase offset is baked into elapsed at spawn)
    WaterState.elapsed[eid] = (WaterState.elapsed[eid] as number) + dt

    // Advance frame when elapsed exceeds duration
    if ((WaterState.elapsed[eid] as number) >= frameDuration) {
      WaterState.elapsed[eid] = (WaterState.elapsed[eid] as number) - frameDuration
      const nextFrame = ((WaterState.frame[eid] as number) + 1) % WATER_FRAME_COUNT
      WaterState.frame[eid] = nextFrame
    }
  }
}

/**
 * Compute initial phase offset for a water tile at (tileX, tileY).
 * Returns a fractional elapsed time to stagger animation start.
 */
export function computeWaterPhaseOffset(tileX: number, tileY: number, frameDuration: number): number {
  // Deterministic offset based on position — creates wave-like stagger
  const raw = (tileX * 0.3 + tileY * 0.2) * Math.PI * 2
  // Ensure positive modulo (JS % can return negative for negative inputs)
  const phase = ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  // Convert phase to a time offset within the frame duration cycle
  return (phase / (Math.PI * 2)) * frameDuration * WATER_FRAME_COUNT
}
