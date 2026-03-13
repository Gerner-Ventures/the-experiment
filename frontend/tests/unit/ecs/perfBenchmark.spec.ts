/**
 * ECS Performance Benchmark Tests
 *
 * Ensures simulation systems stay within budget as entity count grows.
 * These run in CI on every PR — regressions fail before merge.
 *
 * Note: These test pure ECS computation only (no PixiJS, no GPU).
 */

import { createGameWorld } from '@/ecs/world'
import { addEntity, addComponent } from 'bitecs'
import { Position, PathState, AnimState, SpriteRef } from '@/ecs/components'
import { pathfindingSystem, setEntityPath } from '@/ecs/systems/pathfindingSystem'
import { movementSystem } from '@/ecs/systems/movementSystem'
import { animationSystem, registerAnimation, resetAnimationRegistry } from '@/ecs/systems/animationSystem'
import { createDevMonitor } from '@/composables/usePerformanceMonitor'
import { renderSyncSystem } from '@/ecs/systems/renderSyncSystem'

const FIXED_DT = 1 / 60

// Mock tileToScreen since it's used by movementSystem
jest.mock('@/components/world/pixi/isometric-utils', () => ({
  tileToScreen: (x: number, y: number) => ({
    x: (x - y) * 32,
    y: (x + y) * 16,
  }),
}))

function spawnTestEntity(world: ReturnType<typeof createGameWorld>, index: number) {
  const eid = addEntity(world)

  addComponent(world, eid, Position)
  Position.x[eid] = index % 20
  Position.y[eid] = Math.floor(index / 20)
  Position.screenX[eid] = 0
  Position.screenY[eid] = 0

  addComponent(world, eid, SpriteRef)
  SpriteRef.spriteIndex[eid] = index

  // Give half the entities paths to exercise pathfinding + movement
  if (index % 2 === 0) {
    const targetX = (index + 3) % 20
    const targetY = Math.floor(index / 20)
    const path = [{ x: targetX, y: targetY }]
    setEntityPath(eid, path)

    addComponent(world, eid, PathState)
    PathState.waypointIndex[eid] = 0
    PathState.waypointCount[eid] = 1
    PathState.progress[eid] = 0
    PathState.fromX[eid] = index % 20
    PathState.fromY[eid] = Math.floor(index / 20)
    PathState.toX[eid] = targetX
    PathState.toY[eid] = targetY
  }

  // Give a third of entities animations
  if (index % 3 === 0) {
    addComponent(world, eid, AnimState)
    AnimState.frameIndex[eid] = 0
    AnimState.elapsed[eid] = 0
    AnimState.loop[eid] = 1
    AnimState.animIndex[eid] = 0
  }

  return eid
}

describe('ECS performance benchmarks', () => {
  beforeEach(() => {
    resetAnimationRegistry()
    // Register a test animation
    registerAnimation({
      name: 'test-walk',
      poses: ['idle', 'walk1', 'walk2', 'walk3'],
      speed: 0.1,
      loop: true,
    })
  })

  it('ticks 150 entities in under 2ms average', () => {
    const world = createGameWorld()

    for (let i = 0; i < 150; i++) {
      spawnTestEntity(world, i)
    }

    // Warm up
    for (let f = 0; f < 10; f++) {
      pathfindingSystem(world, FIXED_DT)
      movementSystem(world)
      animationSystem(world, FIXED_DT)
    }

    const FRAMES = 1000
    const start = performance.now()
    for (let frame = 0; frame < FRAMES; frame++) {
      pathfindingSystem(world, FIXED_DT)
      movementSystem(world)
      animationSystem(world, FIXED_DT)
    }
    const totalMs = performance.now() - start
    const avgMs = totalMs / FRAMES

    console.log(`150 entities: avg ${avgMs.toFixed(3)}ms per tick (${FRAMES} frames)`)
    expect(avgMs).toBeLessThan(2)
  })

  it('maintains p99 under 4ms with 200 entities', () => {
    const world = createGameWorld()

    for (let i = 0; i < 200; i++) {
      spawnTestEntity(world, i)
    }

    // Warm up
    for (let f = 0; f < 10; f++) {
      pathfindingSystem(world, FIXED_DT)
      movementSystem(world)
      animationSystem(world, FIXED_DT)
    }

    const FRAMES = 1000
    const frameTimes: number[] = []

    for (let frame = 0; frame < FRAMES; frame++) {
      const frameStart = performance.now()
      pathfindingSystem(world, FIXED_DT)
      movementSystem(world)
      animationSystem(world, FIXED_DT)
      frameTimes.push(performance.now() - frameStart)
    }

    const sorted = [...frameTimes].sort((a, b) => a - b)
    const p99 = sorted[Math.floor(sorted.length * 0.99)]
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length

    console.log(`200 entities: avg ${avg.toFixed(3)}ms, p99 ${p99.toFixed(3)}ms`)
    expect(p99).toBeLessThan(4)
  })
})

describe('usePerformanceMonitor', () => {
  it('tracks frame timing and returns valid percentiles', () => {
    const monitor = createDevMonitor()

    // Simulate 100 frames
    for (let i = 0; i < 100; i++) {
      monitor.beginFrame()
      monitor.beginSystem('pathfinding')
      // Simulate some work
      const end = performance.now() + 0.01
      while (performance.now() < end) { /* spin */ }
      monitor.endSystem()
      monitor.beginSystem('movement')
      monitor.endSystem()
      monitor.endFrame(50, 10)
    }

    const percentiles = monitor.getPercentiles()
    expect(percentiles.p50).toBeGreaterThan(0)
    expect(percentiles.p95).toBeGreaterThanOrEqual(percentiles.p50)
    expect(percentiles.p99).toBeGreaterThanOrEqual(percentiles.p95)

    const breakdown = monitor.getSystemBreakdown()
    expect(breakdown).toHaveProperty('pathfinding')
    expect(breakdown).toHaveProperty('movement')
    expect(breakdown.pathfinding).toBeGreaterThan(0)

    const exported = monitor.exportMetrics(10)
    expect(exported).toHaveLength(10)
    expect(exported[0]).toHaveProperty('totalMs')
    expect(exported[0]).toHaveProperty('systems')
    expect(exported[0]).toHaveProperty('entityCount')
  })
})

describe('renderSyncSystem interpolation', () => {
  it('interpolates between previous and current positions', () => {
    const world = createGameWorld()

    const eid = addEntity(world)
    addComponent(world, eid, Position)
    Position.screenX[eid] = 100
    Position.screenY[eid] = 200
    Position.x[eid] = 5
    Position.y[eid] = 5

    addComponent(world, eid, SpriteRef)
    SpriteRef.spriteIndex[eid] = 0

    const prevPositions = new Map<number, { x: number; y: number; screenX: number; screenY: number }>()
    prevPositions.set(eid, { x: 4, y: 4, screenX: 50, screenY: 100 })

    const updates: { screenX: number; screenY: number }[] = []
    const bridge = {
      updateSpritePosition(_idx: number, screenX: number, screenY: number) {
        updates.push({ screenX, screenY })
      },
      updateSpriteTexture() {},
      queueTileUpdate() {},
      flushTileUpdates() {},
    }

    // alpha=0.5 should lerp halfway between prev and current
    renderSyncSystem(world, 0.016, bridge, 0.5, prevPositions)

    expect(updates).toHaveLength(1)
    expect(updates[0].screenX).toBeCloseTo(75, 0)  // midpoint of 50..100
    expect(updates[0].screenY).toBeCloseTo(150, 0) // midpoint of 100..200
  })

  it('uses current position when alpha=1 (no interpolation)', () => {
    const world = createGameWorld()

    const eid = addEntity(world)
    addComponent(world, eid, Position)
    Position.screenX[eid] = 100
    Position.screenY[eid] = 200
    Position.x[eid] = 5
    Position.y[eid] = 5

    addComponent(world, eid, SpriteRef)
    SpriteRef.spriteIndex[eid] = 0

    const updates: { screenX: number; screenY: number }[] = []
    const bridge = {
      updateSpritePosition(_idx: number, screenX: number, screenY: number) {
        updates.push({ screenX, screenY })
      },
      updateSpriteTexture() {},
      queueTileUpdate() {},
      flushTileUpdates() {},
    }

    renderSyncSystem(world, 0.016, bridge, 1, null)

    expect(updates).toHaveLength(1)
    expect(updates[0].screenX).toBe(100)
    expect(updates[0].screenY).toBe(200)
  })
})
