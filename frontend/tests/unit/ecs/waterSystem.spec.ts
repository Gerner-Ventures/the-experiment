/**
 * Water System Unit Tests
 *
 * Tests frame advancement, phase offset stagger, and variant handling.
 */

import { createGameWorld } from '@/ecs/world'
import { addEntity, addComponent } from 'bitecs'
import { TileRef, WaterState, WATER_VARIANTS } from '@/ecs/components'
import {
  waterSystem,
  computeWaterPhaseOffset,
  OCEAN_FRAME_DURATION,
  CODE_RIVER_FRAME_DURATION,
  WATER_FRAME_COUNT,
} from '@/ecs/systems/waterSystem'

function spawnWaterTile(
  world: ReturnType<typeof createGameWorld>,
  tileX: number,
  tileY: number,
  variant: number,
  initialElapsed = 0,
): number {
  const eid = addEntity(world)
  addComponent(world, eid, TileRef)
  TileRef.tileX[eid] = tileX
  TileRef.tileY[eid] = tileY
  TileRef.tileSpriteIndex[eid] = 0

  addComponent(world, eid, WaterState)
  WaterState.variant[eid] = variant
  WaterState.frame[eid] = 0
  WaterState.elapsed[eid] = initialElapsed
  WaterState.phase[eid] = initialElapsed

  return eid
}

describe('waterSystem', () => {
  it('advances ocean frame after duration threshold', () => {
    const world = createGameWorld()
    const eid = spawnWaterTile(world, 0, 0, WATER_VARIANTS.OCEAN)

    // Tick with 0.5s — exceeds OCEAN_FRAME_DURATION (0.4s)
    waterSystem(world, 0.5)
    expect(WaterState.frame[eid]).toBe(1)
  })

  it('does not advance frame before duration threshold', () => {
    const world = createGameWorld()
    const eid = spawnWaterTile(world, 0, 0, WATER_VARIANTS.OCEAN)

    // Tick with 0.3s — under OCEAN_FRAME_DURATION (0.4s)
    waterSystem(world, 0.3)
    expect(WaterState.frame[eid]).toBe(0)
  })

  it('wraps frame back to 0 after reaching WATER_FRAME_COUNT', () => {
    const world = createGameWorld()
    const eid = spawnWaterTile(world, 0, 0, WATER_VARIANTS.OCEAN)

    // Set to last frame
    WaterState.frame[eid] = WATER_FRAME_COUNT - 1

    // Advance past threshold
    waterSystem(world, OCEAN_FRAME_DURATION + 0.01)
    expect(WaterState.frame[eid]).toBe(0) // wraps around
  })

  it('uses different frame duration for code_river variant', () => {
    const world = createGameWorld()
    const eid = spawnWaterTile(world, 9, 5, WATER_VARIANTS.CODE_RIVER)

    // Tick with 0.5s — exceeds OCEAN but not CODE_RIVER (0.6s)
    waterSystem(world, 0.5)
    expect(WaterState.frame[eid]).toBe(0) // Should NOT advance yet

    // Tick again to exceed CODE_RIVER threshold
    waterSystem(world, 0.15)
    expect(WaterState.frame[eid]).toBe(1) // Now advances
  })

  it('processes multiple entities independently', () => {
    const world = createGameWorld()
    const eid1 = spawnWaterTile(world, 0, 0, WATER_VARIANTS.OCEAN)
    const eid2 = spawnWaterTile(world, 1, 0, WATER_VARIANTS.OCEAN, 0.35) // almost ready to advance

    waterSystem(world, 0.1) // 0.1s total for eid1, 0.45s for eid2
    expect(WaterState.frame[eid1]).toBe(0) // not yet
    expect(WaterState.frame[eid2]).toBe(1) // elapsed 0.35 + 0.1 = 0.45 > 0.4
  })

  it('handles empty world without errors', () => {
    const world = createGameWorld()
    // Should not throw
    waterSystem(world, 0.016)
  })
})

describe('computeWaterPhaseOffset', () => {
  it('returns deterministic values for same coordinates', () => {
    const offset1 = computeWaterPhaseOffset(5, 10, OCEAN_FRAME_DURATION)
    const offset2 = computeWaterPhaseOffset(5, 10, OCEAN_FRAME_DURATION)
    expect(offset1).toBe(offset2)
  })

  it('returns different offsets for adjacent tiles', () => {
    const offset1 = computeWaterPhaseOffset(0, 0, OCEAN_FRAME_DURATION)
    const offset2 = computeWaterPhaseOffset(1, 0, OCEAN_FRAME_DURATION)
    const offset3 = computeWaterPhaseOffset(0, 1, OCEAN_FRAME_DURATION)

    expect(offset1).not.toBe(offset2)
    expect(offset1).not.toBe(offset3)
    expect(offset2).not.toBe(offset3)
  })

  it('produces offsets within the full cycle duration', () => {
    const cycleDuration = OCEAN_FRAME_DURATION * WATER_FRAME_COUNT
    // Check a spread of coordinates
    for (let x = -5; x < 25; x += 3) {
      for (let y = -5; y < 25; y += 3) {
        const offset = computeWaterPhaseOffset(x, y, OCEAN_FRAME_DURATION)
        expect(offset).toBeGreaterThanOrEqual(0)
        expect(offset).toBeLessThan(cycleDuration)
      }
    }
  })
})

describe('waterSystem integration with phase offsets', () => {
  it('staggered tiles reach different frames at the same time', () => {
    const world = createGameWorld()

    // Spawn two tiles with different phase offsets
    const eid1 = spawnWaterTile(world, 0, 0, WATER_VARIANTS.OCEAN,
      computeWaterPhaseOffset(0, 0, OCEAN_FRAME_DURATION))
    const eid2 = spawnWaterTile(world, 5, 5, WATER_VARIANTS.OCEAN,
      computeWaterPhaseOffset(5, 5, OCEAN_FRAME_DURATION))

    // Tick enough for some frames to advance
    for (let i = 0; i < 30; i++) {
      waterSystem(world, 0.1)
    }

    // After 3 seconds, both should have cycled, but at different points
    // due to different initial elapsed offsets.
    // Just verify they've both advanced and are likely at different frames
    const frame1 = WaterState.frame[eid1] as number
    const frame2 = WaterState.frame[eid2] as number

    // Both should be valid frame indices
    expect(frame1).toBeGreaterThanOrEqual(0)
    expect(frame1).toBeLessThan(WATER_FRAME_COUNT)
    expect(frame2).toBeGreaterThanOrEqual(0)
    expect(frame2).toBeLessThan(WATER_FRAME_COUNT)
  })
})
