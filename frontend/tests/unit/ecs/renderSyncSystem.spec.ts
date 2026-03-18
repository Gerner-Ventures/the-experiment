/**
 * renderSyncSystem unit tests — tile dirty-check, lastTileFrame parameter.
 */

import { createGameWorld } from '@/ecs/world'
import { addEntity, addComponent } from 'bitecs'
import { Position, SpriteRef, TileRef, WaterState, WATER_VARIANTS, AnimState } from '@/ecs/components'
import { renderSyncSystem } from '@/ecs/systems/renderSyncSystem'
import { AnimationRegistry } from '@/ecs/systems/animationSystem'

jest.mock('@/components/world/pixi/isometric-utils', () => ({
  tileToScreen: (x: number, y: number) => ({
    x: (x - y) * 32,
    y: (x + y) * 16,
  }),
}))

function createMockBridge() {
  const positionUpdates: { spriteIndex: number; screenX: number; screenY: number }[] = []
  const textureUpdates: { spriteIndex: number; pose: string }[] = []
  const tileUpdates: { index: number; frameKey: string }[] = []
  let flushCount = 0

  return {
    bridge: {
      updateSpritePosition(spriteIndex: number, screenX: number, screenY: number) {
        positionUpdates.push({ spriteIndex, screenX, screenY })
      },
      updateSpriteTexture(spriteIndex: number, pose: string) {
        textureUpdates.push({ spriteIndex, pose })
      },
      queueTileUpdate(tileSpriteIndex: number, frameKey: string) {
        tileUpdates.push({ index: tileSpriteIndex, frameKey })
      },
      flushTileUpdates() {
        flushCount++
      },
    },
    positionUpdates,
    textureUpdates,
    tileUpdates,
    getFlushCount: () => flushCount,
  }
}

describe('renderSyncSystem tile dirty-check', () => {
  beforeEach(() => {
    // no-op — registry is per-test now
  })

  it('skips tile texture update when frame has not changed', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, TileRef)
    TileRef.tileSpriteIndex[eid] = 0
    addComponent(world, eid, WaterState)
    WaterState.variant[eid] = WATER_VARIANTS.OCEAN
    WaterState.frame[eid] = 2

    const lastTileFrame = new Map<number, number>()
    lastTileFrame.set(eid, 2) // same frame as current

    const { bridge, tileUpdates } = createMockBridge()
    renderSyncSystem(world, 0.016, bridge, 1, null, lastTileFrame)

    expect(tileUpdates).toHaveLength(0) // skipped — no change
  })

  it('queues tile texture update when frame has changed', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, TileRef)
    TileRef.tileSpriteIndex[eid] = 5
    addComponent(world, eid, WaterState)
    WaterState.variant[eid] = WATER_VARIANTS.OCEAN
    WaterState.frame[eid] = 3

    const lastTileFrame = new Map<number, number>()
    lastTileFrame.set(eid, 1) // different from current frame 3

    const { bridge, tileUpdates } = createMockBridge()
    renderSyncSystem(world, 0.016, bridge, 1, null, lastTileFrame)

    expect(tileUpdates).toHaveLength(1)
    expect(tileUpdates[0].frameKey).toBe('ocean_3')
    expect(lastTileFrame.get(eid)).toBe(3) // updated
  })

  it('queues update for new tile entity not in lastTileFrame', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, TileRef)
    TileRef.tileSpriteIndex[eid] = 0
    addComponent(world, eid, WaterState)
    WaterState.variant[eid] = WATER_VARIANTS.CODE_RIVER
    WaterState.frame[eid] = 1

    const lastTileFrame = new Map<number, number>() // empty — entity is new

    const { bridge, tileUpdates } = createMockBridge()
    renderSyncSystem(world, 0.016, bridge, 1, null, lastTileFrame)

    expect(tileUpdates).toHaveLength(1)
    expect(tileUpdates[0].frameKey).toBe('code_river_1')
  })

  it('works without lastTileFrame parameter (null)', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, TileRef)
    TileRef.tileSpriteIndex[eid] = 0
    addComponent(world, eid, WaterState)
    WaterState.variant[eid] = WATER_VARIANTS.OCEAN
    WaterState.frame[eid] = 0

    const { bridge, tileUpdates } = createMockBridge()
    // null lastTileFrame — all updates pass through (no caching)
    renderSyncSystem(world, 0.016, bridge, 1, null, null)

    expect(tileUpdates).toHaveLength(1)
  })

  it('resets tracking after lastTileFrame.clear()', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, TileRef)
    TileRef.tileSpriteIndex[eid] = 0
    addComponent(world, eid, WaterState)
    WaterState.variant[eid] = WATER_VARIANTS.OCEAN
    WaterState.frame[eid] = 2

    const lastTileFrame = new Map<number, number>()

    const { bridge, tileUpdates } = createMockBridge()

    // First call — should queue update
    renderSyncSystem(world, 0.016, bridge, 1, null, lastTileFrame)
    expect(tileUpdates).toHaveLength(1)

    // Second call — same frame, should skip
    tileUpdates.length = 0
    renderSyncSystem(world, 0.016, bridge, 1, null, lastTileFrame)
    expect(tileUpdates).toHaveLength(0)

    // Clear and call again — should queue update again
    lastTileFrame.clear()
    tileUpdates.length = 0
    renderSyncSystem(world, 0.016, bridge, 1, null, lastTileFrame)
    expect(tileUpdates).toHaveLength(1)
  })
})

describe('renderSyncSystem animation sync', () => {
  beforeEach(() => {
    // no-op — registry is per-test now
  })

  it('syncs idle pose when entity has no AnimState', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    Position.screenX[eid] = 100
    Position.screenY[eid] = 200
    Position.x[eid] = 5
    Position.y[eid] = 5
    addComponent(world, eid, SpriteRef)
    SpriteRef.spriteIndex[eid] = 0

    const { bridge, textureUpdates } = createMockBridge()
    renderSyncSystem(world, 0.016, bridge, 1, null)

    expect(textureUpdates).toHaveLength(1)
    expect(textureUpdates[0].pose).toBe('idle')
  })

  it('syncs animation pose when entity has AnimState', () => {
    const world = createGameWorld()
    const registry = new AnimationRegistry()
    const animIdx = registry.register({
      name: 'test-walk',
      poses: ['idle', 'walk1', 'walk2'],
      speed: 0.1,
      loop: true,
    })

    const eid = addEntity(world)
    addComponent(world, eid, Position)
    Position.screenX[eid] = 0
    Position.screenY[eid] = 0
    Position.x[eid] = 0
    Position.y[eid] = 0
    addComponent(world, eid, SpriteRef)
    SpriteRef.spriteIndex[eid] = 0
    addComponent(world, eid, AnimState)
    AnimState.animIndex[eid] = animIdx
    AnimState.frameIndex[eid] = 1

    const { bridge, textureUpdates } = createMockBridge()
    renderSyncSystem(world, 0.016, bridge, 1, null, null, registry)

    expect(textureUpdates).toHaveLength(1)
    expect(textureUpdates[0].pose).toBe('walk1')
  })
})
