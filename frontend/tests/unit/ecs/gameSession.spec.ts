/**
 * GameSession tests — lifecycle, tick loop, ECS observers, agent methods, mount failure.
 *
 * Uses a mock renderer that captures the onTick callback so tests can
 * drive the simulation loop and verify ECS state transitions end-to-end.
 */

import { GameSession } from '@/game/GameSession'

// ─── Mock Infrastructure ───

// Captured tick callback — lets tests drive the game loop
let capturedTickFn: ((dt: number) => void) | null = null
// Track renderer method calls
let rendererCalls: Record<string, unknown[][]> = {}
// Track bridge calls
let bridgeCalls: Record<string, unknown[][]> = {}

function resetMockState() {
  capturedTickFn = null
  rendererCalls = {
    mount: [], destroy: [], loadMap: [], createSprite: [], removeSprite: [],
    onTick: [], removeAllTileSprites: [], updateVisuals: [],
  }
  bridgeCalls = {
    updateSpritePosition: [], updateSpriteTexture: [],
    queueTileUpdate: [], flushTileUpdates: [],
  }
}

jest.mock('@/composables/useRenderer', () => ({
  useRenderer: () => {
    const bridge = {
      updateSpritePosition(...args: unknown[]) { bridgeCalls.updateSpritePosition.push(args) },
      updateSpriteTexture(...args: unknown[]) { bridgeCalls.updateSpriteTexture.push(args) },
      queueTileUpdate(...args: unknown[]) { bridgeCalls.queueTileUpdate.push(args) },
      flushTileUpdates() { bridgeCalls.flushTileUpdates.push([]) },
    }

    return {
      mount: jest.fn().mockImplementation(async () => { rendererCalls.mount.push([]) }),
      destroy: jest.fn().mockImplementation(() => { rendererCalls.destroy.push([]) }),
      loadMap: jest.fn(),
      createSprite: jest.fn().mockReturnValue(0),
      getSpriteByIndex: jest.fn(),
      getSpriteById: jest.fn(),
      removeSprite: jest.fn().mockImplementation((...args: unknown[]) => { rendererCalls.removeSprite.push(args) }),
      onTick: jest.fn().mockImplementation((cb: (dt: number) => void) => { capturedTickFn = cb }),
      centerOn: jest.fn(),
      setZoom: jest.fn(),
      highlightAgent: jest.fn(),
      clearHighlight: jest.fn(),
      onAgentClick: jest.fn(),
      getAgentScreenPosition: jest.fn(),
      setPhase: jest.fn(),
      startDemoCycle: jest.fn(),
      createTileSprite: jest.fn().mockReturnValue(0),
      removeTileSprite: jest.fn(),
      removeAllTileSprites: jest.fn(),
      getRenderBridge: jest.fn().mockReturnValue(bridge),
      getIsoMap: jest.fn().mockReturnValue(null),
      updateVisuals: jest.fn(),
    }
  },
}))

jest.mock('@/components/world/pixi/isometric-utils', () => ({
  tileToScreen: (x: number, y: number) => ({
    x: (x - y) * 32,
    y: (x + y) * 16,
  }),
}))

jest.mock('@/config/sprites/hd/animations', () => ({
  getHDAnimationForAction: (name: string) => {
    if (name === 'wave') return { name: 'wave', poses: ['wave1', 'wave2', 'wave3'], speed: 0.5, loop: false }
    return null
  },
  getHDAnimation: (name: string) => {
    if (name === 'walk') return { name: 'walk', poses: ['idle', 'walk1', 'walk2', 'walk3'], speed: 0.1, loop: true }
    return { name, poses: ['idle'], speed: 0.1, loop: false }
  },
  HD_SILLY_ANIMATIONS: [{ name: 'wave', poses: ['wave1', 'wave2'], speed: 0.1, loop: false }],
}))

// ─── Helpers ───

const FIXED_DT = 1 / 60
const DUMMY_SPRITE = { spriteId: 'test', variant: 'default' } as never

/** Drive the tick loop for N individual fixed-timestep frames */
function tickN(n: number) {
  if (!capturedTickFn) throw new Error('No tick callback captured — was mount() called?')
  for (let i = 0; i < n; i++) {
    capturedTickFn(FIXED_DT)
  }
}

/** Tick enough frames for pathfinding to complete a 1-tile move (MOVE_SPEED * dt accumulates to >= 1) */
function tickUntilPathComplete(maxTicks = 200) {
  if (!capturedTickFn) throw new Error('No tick callback captured')
  for (let i = 0; i < maxTicks; i++) {
    capturedTickFn(FIXED_DT)
  }
}

// ─── Tests ───

describe('GameSession lifecycle', () => {
  beforeEach(resetMockState)

  it('starts in disposed state', () => {
    const session = new GameSession()
    expect(session.isActive).toBe(false)
  })

  it('becomes active after mount', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))
    expect(session.isActive).toBe(true)
    expect(session.currentSessionId).toBe(1)
    session.dispose()
  })

  it('becomes inactive after dispose', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))
    session.dispose()
    expect(session.isActive).toBe(false)
  })

  it('increments sessionId on each mount', async () => {
    const session = new GameSession()
    const el = document.createElement('div')

    await session.mount(el)
    expect(session.currentSessionId).toBe(1)
    session.dispose()

    await session.mount(el)
    expect(session.currentSessionId).toBe(2)
    session.dispose()
  })

  it('dispose is idempotent', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))
    session.dispose()
    expect(() => session.dispose()).not.toThrow()
  })
})

describe('GameSession double-mount guard', () => {
  beforeEach(resetMockState)

  it('auto-disposes previous session on re-mount', async () => {
    const session = new GameSession()
    const el = document.createElement('div')

    await session.mount(el)
    expect(session.currentSessionId).toBe(1)

    await session.mount(el)
    expect(session.currentSessionId).toBe(2)
    expect(session.isActive).toBe(true)

    // Renderer.destroy should have been called once (from first dispose)
    expect(rendererCalls.destroy.length).toBe(1)

    session.dispose()
  })
})

describe('GameSession mount failure', () => {
  it('disposes and re-throws on renderer.mount failure', async () => {
    // Create a session with a renderer that fails
    const failRenderer = jest.requireMock('@/composables/useRenderer')
    const origUseRenderer = failRenderer.useRenderer
    failRenderer.useRenderer = () => {
      const r = origUseRenderer()
      r.mount = jest.fn().mockRejectedValue(new Error('WebGL context lost'))
      return r
    }

    const session = new GameSession()
    await expect(session.mount(document.createElement('div'))).rejects.toThrow('WebGL context lost')
    expect(session.isActive).toBe(false)

    // Restore
    failRenderer.useRenderer = origUseRenderer
  })
})

describe('GameSession tick loop', () => {
  beforeEach(resetMockState)

  it('registers tick callback on mount', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))
    expect(capturedTickFn).toBeDefined()
    session.dispose()
  })

  it('does not crash when tick called on disposed session', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))
    const tickFn = capturedTickFn!
    session.dispose()

    // Tick after dispose — should be a no-op, not throw
    expect(() => tickFn(FIXED_DT)).not.toThrow()
  })

  it('runs simulation systems and produces render bridge calls', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    // Spawn an agent so there's something to render
    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 5, y: 5 })

    // Run one tick
    tickN(1)

    // renderSyncSystem should have pushed position to bridge
    expect(bridgeCalls.updateSpritePosition.length).toBeGreaterThan(0)
    // Should have set idle pose (no animation)
    expect(bridgeCalls.updateSpriteTexture.length).toBeGreaterThan(0)
    const lastTexture = bridgeCalls.updateSpriteTexture[bridgeCalls.updateSpriteTexture.length - 1]
    expect(lastTexture[1]).toBe('idle') // idle pose for stationary agent

    // flushTileUpdates not called (no water tile entities spawned)
    expect(bridgeCalls.flushTileUpdates.length).toBe(0)

    session.dispose()
  })

  it('clamps accumulator to prevent spiral of death', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))
    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    // Feed a huge dt (simulating a tab that was backgrounded for 10 seconds)
    // MAX_ACCUMULATOR = FIXED_DT * 5, so at most 5 simulation steps should run
    bridgeCalls.updateSpritePosition = []
    capturedTickFn!(10.0) // 10 seconds

    // Should still complete without hanging — the accumulator is clamped
    // Position updates should have happened (5 sim steps + 1 render)
    expect(bridgeCalls.updateSpritePosition.length).toBeGreaterThan(0)

    session.dispose()
  })
})

describe('GameSession ECS observers', () => {
  beforeEach(resetMockState)

  it('auto-starts walk animation when PathState is added', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })
    session.moveAgentAlongPath('a1', [{ x: 1, y: 0 }])

    // After moveAgentAlongPath, the onAdd(PathState) observer should have
    // added AnimState with walk animation. Tick once to let systems process.
    tickN(1)

    // The bridge should have received a walk pose (not idle)
    const textureCalls = bridgeCalls.updateSpriteTexture
    const poses = textureCalls.map(c => c[1])
    // At least one pose should be from walk animation ('idle', 'walk1', 'walk2', 'walk3')
    expect(poses.some(p => typeof p === 'string' && p !== 'idle')).toBe(false) // frame 0 is 'idle' in walk anim
    // But the animation should exist — not the idle fallback (which only fires if no AnimState)
    // The agent has AnimState now, so it should NOT get the standalone 'idle' from renderSync line 73
    // Instead it gets anim.poses[0] which is 'idle' from the walk animation
    // This is correct — verify AnimState is present by checking we don't get idle from the "not moving" branch
    // Best way: tick a few more frames and check we get walk1
    bridgeCalls.updateSpriteTexture = []
    tickN(15) // enough for animation to advance a frame
    const laterPoses = bridgeCalls.updateSpriteTexture.map(c => c[1])
    expect(laterPoses).toContain('walk1')

    session.dispose()
  })

  it('fires path callback and stops walk when path completes', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    const pathDone = jest.fn()
    session.moveAgentAlongPath('a1', [{ x: 1, y: 0 }], pathDone)

    // Tick enough for pathfinding system to complete the 1-tile move
    tickUntilPathComplete()

    // Path callback should have fired
    expect(pathDone).toHaveBeenCalledTimes(1)

    session.dispose()
  })

  it('fires animation callback when non-looping animation completes', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    const animDone = jest.fn()
    session.playAction('a1', 'wave', animDone)

    // Tick enough frames for the 3-frame animation to complete
    // wave has speed: 0.5, so frameDuration = 1/(60*0.5) = 1/30 ≈ 0.033s per frame
    // 3 frames × 0.033s = ~0.1s = ~6 ticks
    tickN(30) // plenty of headroom

    expect(animDone).toHaveBeenCalledTimes(1)

    session.dispose()
  })

  it('fires looping animation callback immediately', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    const loopDone = jest.fn()
    // Walk is looping — onComplete should fire immediately
    session.playAction('a1', 'walk', loopDone)

    expect(loopDone).toHaveBeenCalledTimes(1)

    session.dispose()
  })

  it('observers do not fire after dispose', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })
    const pathDone = jest.fn()
    session.moveAgentAlongPath('a1', [{ x: 1, y: 0 }], pathDone)

    // Dispose before path completes
    session.dispose()

    expect(pathDone).not.toHaveBeenCalled()
  })
})

describe('GameSession agent lifecycle', () => {
  beforeEach(resetMockState)

  it('spawnAgent creates ECS entity with correct components', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Alice', DUMMY_SPRITE, { x: 3, y: 7 })

    // Tick to verify the entity renders
    tickN(1)

    // Bridge should receive position update for the spawned agent
    expect(bridgeCalls.updateSpritePosition.length).toBeGreaterThan(0)
    const [spriteIdx, screenX, screenY] = bridgeCalls.updateSpritePosition[0] as number[]
    expect(spriteIdx).toBe(0)
    // tileToScreen(3, 7) = { x: (3-7)*32 = -128, y: (3+7)*16 = 160 }
    expect(screenX).toBe(-128)
    expect(screenY).toBe(160)

    session.dispose()
  })

  it('spawnAgent does nothing before mount', () => {
    const session = new GameSession()
    // No mount — spawnAgent should warn and exit
    expect(() => session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })).not.toThrow()
  })

  it('removeAgent cleans up ECS entity and renderer sprite', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })
    session.removeAgent('a1')

    // Tick — should not crash with removed entity
    tickN(1)

    // Bridge should NOT have position updates (entity removed)
    expect(bridgeCalls.updateSpritePosition.length).toBe(0)

    // Renderer.removeSprite should have been called
    expect(rendererCalls.removeSprite.length).toBe(1)
    expect(rendererCalls.removeSprite[0][0]).toBe('a1')

    session.dispose()
  })

  it('removeAgent while moving clears pending callback', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    const pathDone = jest.fn()
    session.moveAgentAlongPath('a1', [{ x: 5, y: 5 }], pathDone)

    // Remove agent mid-movement
    session.removeAgent('a1')

    // Tick remaining — callback should never fire
    tickUntilPathComplete()
    expect(pathDone).not.toHaveBeenCalled()

    session.dispose()
  })

  it('moveAgentAlongPath with empty path fires onComplete immediately', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    const done = jest.fn()
    session.moveAgentAlongPath('a1', [], done)
    expect(done).toHaveBeenCalledTimes(1)

    session.dispose()
  })

  it('moveAgentAlongPath with unknown agent fires onComplete', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    const done = jest.fn()
    session.moveAgentAlongPath('nonexistent', [{ x: 1, y: 1 }], done)
    expect(done).toHaveBeenCalledTimes(1)

    session.dispose()
  })

  it('playAction with unknown agent fires onComplete', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    const done = jest.fn()
    session.playAction('nonexistent', 'wave', done)
    expect(done).toHaveBeenCalledTimes(1)

    session.dispose()
  })
})

describe('GameSession stale callback — session token', () => {
  beforeEach(resetMockState)

  it('path callback with captured sessionId does not fire in new session', async () => {
    const session = new GameSession()
    const el = document.createElement('div')
    await session.mount(el)

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    const oldCallback = jest.fn()
    session.moveAgentAlongPath('a1', [{ x: 1, y: 0 }], oldCallback)

    // Dispose + remount (new session)
    session.dispose()
    await session.mount(el)

    // Old callback was cleared during dispose
    expect(oldCallback).not.toHaveBeenCalled()

    // New session should be clean
    session.spawnAgent('a2', 'Test2', DUMMY_SPRITE, { x: 0, y: 0 })
    const newCallback = jest.fn()
    session.moveAgentAlongPath('a2', [{ x: 1, y: 0 }], newCallback)
    tickUntilPathComplete()
    expect(newCallback).toHaveBeenCalledTimes(1)

    session.dispose()
  })

  it('animation callback with captured sessionId does not fire in new session', async () => {
    const session = new GameSession()
    const el = document.createElement('div')
    await session.mount(el)

    session.spawnAgent('a1', 'Test', DUMMY_SPRITE, { x: 0, y: 0 })

    const oldCallback = jest.fn()
    session.playAction('a1', 'wave', oldCallback)

    // Dispose + remount
    session.dispose()
    await session.mount(el)

    // Old callback cleared
    expect(oldCallback).not.toHaveBeenCalled()

    session.dispose()
  })
})

describe('GameSession dispose cleanup completeness', () => {
  beforeEach(resetMockState)

  it('clears all state on dispose', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    // Spawn agents, start movement
    session.spawnAgent('a1', 'Alice', DUMMY_SPRITE, { x: 0, y: 0 })
    session.spawnAgent('a2', 'Bob', DUMMY_SPRITE, { x: 5, y: 5 })
    session.moveAgentAlongPath('a1', [{ x: 1, y: 0 }])
    tickN(2) // partial movement

    session.dispose()

    // After dispose, remounting should start clean
    await session.mount(document.createElement('div'))

    // Tick should not crash — no stale entities or callbacks
    tickN(1)
    // No position updates — no entities exist
    bridgeCalls.updateSpritePosition = []
    tickN(1)
    expect(bridgeCalls.updateSpritePosition.length).toBe(0)

    session.dispose()
  })

  it('renderer.destroy called exactly once per dispose', async () => {
    const session = new GameSession()
    await session.mount(document.createElement('div'))

    rendererCalls.destroy = []
    session.dispose()
    expect(rendererCalls.destroy.length).toBe(1)

    // Second dispose should not call destroy again
    session.dispose()
    expect(rendererCalls.destroy.length).toBe(1)
  })
})
