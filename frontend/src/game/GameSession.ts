/**
 * GameSession — owns the lifecycle of a single game instance.
 *
 * Manages: bitECS world, game loop, entity registries, pending callbacks,
 * session-scoped abort token, performance monitoring.
 *
 * Child: useRenderer (PixiJS rendering backend).
 *
 * Session lifecycle:
 * - mount()  → init PixiJS, ECS, game loop
 * - dispose() → deterministic teardown in correct order
 * - tick()   → fixed timestep accumulator (Gaffer on Games pattern)
 *
 * Session token pattern: every async callback captures sessionId at creation.
 * Before executing, it checks isActive. If the session has been disposed,
 * the callback is silently discarded.
 */

import type { MapTheme, MapData } from '@/types/world'
import type { CharacterSprite } from '@/config/character-sprites'
import type { RoundPhase } from '@/types/websocket'
import type { World } from 'bitecs'
import { addEntity, removeEntity, addComponent, removeComponent, hasComponent, observe, onRemove, onAdd, query } from 'bitecs'
import { createGameWorld } from '@/ecs/world'
import {
  Position, PathState, AnimState, AgentId, SpriteRef, StatusEffect,
  TileRef, WaterState, WATER_VARIANTS,
} from '@/ecs/components'
import { pathfindingSystem, setEntityPath, clearEntityPath, type PathDataMap } from '@/ecs/systems/pathfindingSystem'
import { movementSystem } from '@/ecs/systems/movementSystem'
import { animationSystem, AnimationRegistry } from '@/ecs/systems/animationSystem'
import { renderSyncSystem, type RenderBridge, type PrevPositions } from '@/ecs/systems/renderSyncSystem'
import { waterSystem, computeWaterPhaseOffset, OCEAN_FRAME_DURATION, CODE_RIVER_FRAME_DURATION, WATER_FRAME_COUNT } from '@/ecs/systems/waterSystem'
import { useRenderer, type UseRenderer } from '@/composables/useRenderer'
import { usePerformanceMonitor, type PerformanceMonitor } from '@/composables/usePerformanceMonitor'
import { tileToScreen } from '@/components/world/pixi/isometric-utils'
import { getHDAnimationForAction, getHDAnimation, HD_SILLY_ANIMATIONS } from '@/config/sprites/hd/animations'
import type { HDAnimationDef } from '@/config/sprites/hd/types'
import type { AgentSpriteObject } from '@/components/world/pixi/AgentSprite'
import { isDevMode } from '@/utils/env'

// ─── Fixed Timestep Constants ───

const FIXED_DT = 1 / 60       // 16.67ms simulation step
const MAX_ACCUMULATOR = FIXED_DT * 5  // safety cap: max 5 catch-up steps

export class GameSession {
  private world: World | null = null
  private renderer: UseRenderer
  private perfMonitor: PerformanceMonitor
  private renderBridge: RenderBridge | null = null

  // Entity registries
  private agentEntityMap = new Map<string, number>()
  private agentIdTable: string[] = []
  private tileEntityMap = new Map<string, number>()

  // Pending callbacks for path/anim completion
  private pendingCallbacks = new Map<string, () => void>()

  // Session-owned ECS data — passed to systems as parameters (no module-level state)
  private lastTileFrame = new Map<number, number>()
  private pathData: PathDataMap = new Map()
  private animRegistry = new AnimationRegistry()

  // Demo mode timers
  private demoTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Fixed timestep state
  private accumulator = 0
  private prevPositions: PrevPositions | null = null

  // Observer cleanup functions returned by bitECS observe()
  private observerCleanups: (() => void)[] = []

  // Session lifecycle
  private sessionId = 0
  private disposed = true

  constructor() {
    this.renderer = useRenderer()
    this.perfMonitor = usePerformanceMonitor()
  }

  /** Whether this session is currently active (mounted and not disposed) */
  get isActive(): boolean {
    return !this.disposed
  }

  /** Current session ID — incremented on each mount */
  get currentSessionId(): number {
    return this.sessionId
  }

  // ─── Lifecycle ───

  async mount(container: HTMLElement): Promise<void> {
    // Double-mount guard: clean up previous session first
    if (!this.disposed) {
      console.warn('[GameSession] mount() called while already mounted — disposing previous session')
      this.dispose()
    }

    this.sessionId++
    this.disposed = false
    const mountSessionId = this.sessionId

    try {
      await this.renderer.mount(container)

      // Verify session wasn't disposed during async mount
      if (this.sessionId !== mountSessionId || this.disposed) {
        console.warn('[GameSession] Session disposed during async mount — aborting')
        return
      }

      this.initECS()
      this.renderBridge = this.renderer.getRenderBridge()

      this.renderer.onTick((dt: number) => {
        this.tick(dt)
      })

      // Expose dev panel in development only
      if (typeof window !== 'undefined' && isDevMode()) {
        // Guard against multiple mount clobber
        if ((window as unknown as Record<string, unknown>).__devWorld) {
          console.warn('[GameSession] __devWorld already exists — overwriting with new session')
        }
        (window as unknown as Record<string, unknown>).__devWorld = {
          perf: {
            getPercentiles: () => this.perfMonitor.getPercentiles(),
            getSystemBreakdown: () => this.perfMonitor.getSystemBreakdown(),
            exportLast: (n?: number) => this.perfMonitor.exportMetrics(n),
          },
          getAgentCount: () => this.agentEntityMap.size,
          getTileCount: () => this.tileEntityMap.size,
          getEntityCount: () => this.agentEntityMap.size + this.tileEntityMap.size,
        }
      }
    } catch (err) {
      console.error('[GameSession] mount() failed — disposing:', err)
      this.dispose()
      throw err
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // 1. Stop demo timers (no more scheduled actions)
    for (const timer of this.demoTimers.values()) {
      clearTimeout(timer)
    }
    this.demoTimers.clear()

    // 2. Clean up ECS observers (prevents world memory leaks)
    this.observerCleanups.forEach(fn => fn())
    this.observerCleanups = []

    // 3. Clear pending callbacks (prevents stale firings)
    this.pendingCallbacks.clear()

    // 4. Clear session-owned ECS data
    this.lastTileFrame.clear()
    this.pathData.clear()
    this.animRegistry.reset()

    // 5. Destroy tile entities
    this.destroyTileEntities()

    // 6. Clear entity registries
    this.agentEntityMap.clear()
    this.agentIdTable.length = 0

    // 7. Null ECS references
    this.renderBridge = null
    this.world = null
    this.accumulator = 0
    this.prevPositions = null

    // 8. Clean up dev panel
    if (typeof window !== 'undefined' && isDevMode()) {
      delete (window as unknown as Record<string, unknown>).__devWorld
    }

    // 9. Destroy renderer (last — GPU resources)
    this.renderer.destroy()
  }

  // ─── ECS ───

  private initECS(): void {
    this.world = createGameWorld()

    // Path complete → stop walk animation, fire callback
    this.observerCleanups.push(observe(this.world, onRemove(PathState), (eid: number) => {
      if (this.disposed) return
      if (!hasComponent(this.world!, eid, AgentId)) return
      const idIndex = AgentId.idIndex[eid] as number
      const agentId = this.agentIdTable[idIndex]
      if (!agentId) return

      // Stop the walk animation that was auto-started by onAdd(PathState)
      if (!this.pendingCallbacks.has(agentId + ':anim') && hasComponent(this.world!, eid, AnimState)) {
        removeComponent(this.world!, eid, AnimState)
      }

      const cb = this.pendingCallbacks.get(agentId + ':path')
      if (cb) {
        this.pendingCallbacks.delete(agentId + ':path')
        cb()
      }
    }))

    // Animation complete → fire callback
    this.observerCleanups.push(observe(this.world, onRemove(AnimState), (eid: number) => {
      if (this.disposed) return
      if (!hasComponent(this.world!, eid, AgentId)) return
      const idIndex = AgentId.idIndex[eid] as number
      const agentId = this.agentIdTable[idIndex]
      if (!agentId) return
      const cb = this.pendingCallbacks.get(agentId + ':anim')
      if (cb) {
        this.pendingCallbacks.delete(agentId + ':anim')
        cb()
      }
    }))

    // Path starts → auto-start walk animation
    this.observerCleanups.push(observe(this.world, onAdd(PathState), (eid: number) => {
      if (this.disposed || !this.world) return
      const walkAnim = getHDAnimation('walk')
      const animIdx = this.animRegistry.register(walkAnim)
      addComponent(this.world, eid, AnimState)
      AnimState.frameIndex[eid] = 0
      AnimState.elapsed[eid] = 0
      AnimState.loop[eid] = 1
      AnimState.animIndex[eid] = animIdx
    }))

    // StatusEffect lifecycle — no-op observers (wired when visual effects are implemented)
    this.observerCleanups.push(observe(this.world, onAdd(StatusEffect), () => {}))
    this.observerCleanups.push(observe(this.world, onRemove(StatusEffect), () => {}))
  }

  // ─── Tick Loop ───

  private tick(dt: number): void {
    if (this.disposed || !this.world) return

    this.perfMonitor.beginFrame()

    // Fixed timestep accumulator — clamp to prevent spiral of death
    this.accumulator = Math.min(this.accumulator + dt, MAX_ACCUMULATOR)

    // Snapshot positions once before simulation for render interpolation
    this.prevPositions = this.snapshotPositions(this.world)

    while (this.accumulator >= FIXED_DT) {
      // --- Simulation systems (fixed dt) ---

      this.perfMonitor.beginSystem('water')
      waterSystem(this.world, FIXED_DT)
      this.perfMonitor.endSystem()

      this.perfMonitor.beginSystem('pathfinding')
      pathfindingSystem(this.world, FIXED_DT, this.pathData)
      this.perfMonitor.endSystem()

      this.perfMonitor.beginSystem('movement')
      movementSystem(this.world)
      this.perfMonitor.endSystem()

      this.perfMonitor.beginSystem('animation')
      animationSystem(this.world, FIXED_DT, this.animRegistry)
      this.perfMonitor.endSystem()

      this.accumulator -= FIXED_DT
    }

    // Render with interpolation alpha
    const alpha = this.accumulator / FIXED_DT

    this.perfMonitor.beginSystem('renderSync')
    if (this.renderBridge) {
      renderSyncSystem(this.world, dt, this.renderBridge, alpha, this.prevPositions, this.lastTileFrame, this.animRegistry)
    }
    this.perfMonitor.endSystem()

    this.renderer.updateVisuals(dt)

    this.perfMonitor.endFrame(this.agentEntityMap.size + this.tileEntityMap.size)
  }

  /** Snapshot positions of all entities with Position + SpriteRef for render interpolation */
  private snapshotPositions(w: World): PrevPositions {
    // Always create fresh Map to avoid aliasing between frames
    const snapshot: PrevPositions = new Map()

    const entities = query(w, [Position, SpriteRef])
    for (const eid of entities) {
      snapshot.set(eid, {
        x: Position.x[eid] as number,
        y: Position.y[eid] as number,
        screenX: Position.screenX[eid] as number,
        screenY: Position.screenY[eid] as number,
      })
    }
    return snapshot
  }

  // ─── Map ───

  loadMap(theme: MapTheme, mapData: MapData): void {
    this.destroyTileEntities()
    this.renderer.loadMap(theme, mapData)

    if (this.world) {
      const isoMap = this.renderer.getIsoMap()
      if (isoMap) {
        const waterPositions = isoMap.getWaterPositions()
        for (const pos of waterPositions) {
          this.spawnWaterEntity(pos.x, pos.y, pos.variant)
        }
      }
    }
  }

  private spawnWaterEntity(tileX: number, tileY: number, variant: 'ocean' | 'code_river'): void {
    if (!this.world) {
      console.warn('[GameSession] spawnWaterEntity() called with no world')
      return
    }

    const variantNum = variant === 'code_river' ? WATER_VARIANTS.CODE_RIVER : WATER_VARIANTS.OCEAN
    const frameKey = variant === 'code_river' ? 'code_river_0' : 'ocean_0'
    const tileSpriteIndex = this.renderer.createTileSprite(tileX, tileY, frameKey)
    if (tileSpriteIndex < 0) return

    const eid = addEntity(this.world)

    addComponent(this.world, eid, TileRef)
    TileRef.tileX[eid] = tileX
    TileRef.tileY[eid] = tileY
    TileRef.tileSpriteIndex[eid] = tileSpriteIndex

    addComponent(this.world, eid, WaterState)
    WaterState.variant[eid] = variantNum
    const frameDuration = variantNum === WATER_VARIANTS.CODE_RIVER
      ? CODE_RIVER_FRAME_DURATION
      : OCEAN_FRAME_DURATION
    const totalOffset = computeWaterPhaseOffset(tileX, tileY, frameDuration)
    WaterState.frame[eid] = Math.floor(totalOffset / frameDuration) % WATER_FRAME_COUNT
    WaterState.elapsed[eid] = totalOffset % frameDuration

    this.tileEntityMap.set(`${tileX},${tileY}`, eid)
  }

  private destroyTileEntities(): void {
    if (!this.world) return
    for (const eid of this.tileEntityMap.values()) {
      removeEntity(this.world, eid)
    }
    this.tileEntityMap.clear()
    this.lastTileFrame.clear()
    this.renderer.removeAllTileSprites()
  }

  // ─── Agents ───

  spawnAgent(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }): void {
    if (!this.world) {
      console.warn('[GameSession] spawnAgent() called with no world')
      return
    }

    const spriteIndex = this.renderer.createSprite(id, name, sprite, tile)
    if (spriteIndex < 0) return

    const eid = addEntity(this.world)
    const idIndex = this.agentIdTable.length
    this.agentIdTable.push(id)

    const screen = tileToScreen(tile.x, tile.y)
    addComponent(this.world, eid, Position)
    Position.x[eid] = tile.x
    Position.y[eid] = tile.y
    Position.screenX[eid] = screen.x
    Position.screenY[eid] = screen.y

    addComponent(this.world, eid, AgentId)
    AgentId.idIndex[eid] = idIndex

    addComponent(this.world, eid, SpriteRef)
    SpriteRef.spriteIndex[eid] = spriteIndex

    this.agentEntityMap.set(id, eid)
  }

  moveAgentTo(id: string, tileX: number, tileY: number): void {
    this.moveAgentAlongPath(id, [{ x: tileX, y: tileY }])
  }

  moveAgentAlongPath(id: string, path: { x: number; y: number }[], onComplete?: () => void): void {
    if (!this.world) {
      console.warn('[GameSession] moveAgentAlongPath() called with no world')
      onComplete?.()
      return
    }

    const eid = this.agentEntityMap.get(id)
    if (eid === undefined) {
      console.warn(`[GameSession] moveAgentAlongPath() — unknown agent "${id}"`)
      onComplete?.()
      return
    }

    if (path.length === 0) {
      onComplete?.()
      return
    }

    // Stop existing animation (walk anim will be auto-set by PathState onAdd observer)
    this.pendingCallbacks.delete(id + ':anim')
    if (hasComponent(this.world, eid, AnimState)) {
      removeComponent(this.world, eid, AnimState)
    }

    if (onComplete) {
      // Capture session ID for stale callback detection
      const capturedSessionId = this.sessionId
      this.pendingCallbacks.set(id + ':path', () => {
        if (this.sessionId === capturedSessionId) {
          onComplete()
        }
      })
    }

    setEntityPath(this.pathData, eid, path)

    const currentX = (Position.x[eid] as number) || 0
    const currentY = (Position.y[eid] as number) || 0

    addComponent(this.world, eid, PathState)
    PathState.waypointIndex[eid] = 0
    PathState.waypointCount[eid] = path.length
    PathState.progress[eid] = 0
    PathState.fromX[eid] = currentX
    PathState.fromY[eid] = currentY
    PathState.toX[eid] = path[0].x
    PathState.toY[eid] = path[0].y
  }

  playAction(id: string, animationName: string, onComplete: () => void): void {
    const anim = getHDAnimationForAction(animationName) ?? getHDAnimation(animationName)
    this.playAnimationInternal(id, anim, onComplete)
  }

  private playAnimationInternal(id: string, anim: HDAnimationDef, onComplete?: () => void): void {
    if (!this.world) {
      console.warn('[GameSession] playAnimationInternal() called with no world')
      onComplete?.()
      return
    }

    const eid = this.agentEntityMap.get(id)
    if (eid === undefined) {
      console.warn(`[GameSession] playAnimationInternal() — unknown agent "${id}"`)
      onComplete?.()
      return
    }

    const animIdx = this.animRegistry.register(anim)

    this.pendingCallbacks.delete(id + ':anim')
    if (hasComponent(this.world, eid, AnimState)) {
      removeComponent(this.world, eid, AnimState)
    }

    if (onComplete && !anim.loop) {
      const capturedSessionId = this.sessionId
      this.pendingCallbacks.set(id + ':anim', () => {
        if (this.sessionId === capturedSessionId) {
          onComplete()
        }
      })
    }

    addComponent(this.world, eid, AnimState)
    AnimState.frameIndex[eid] = 0
    AnimState.elapsed[eid] = 0
    AnimState.loop[eid] = anim.loop ? 1 : 0
    AnimState.animIndex[eid] = animIdx

    if (anim.loop && onComplete) {
      onComplete()
    }
  }

  removeAgent(id: string): void {
    if (!this.world) {
      console.warn('[GameSession] removeAgent() called with no world')
      return
    }

    const eid = this.agentEntityMap.get(id)
    if (eid === undefined) return

    // Clean up pending callbacks
    this.pendingCallbacks.delete(id + ':path')
    this.pendingCallbacks.delete(id + ':anim')

    // Clean up demo timer
    const timer = this.demoTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.demoTimers.delete(id)
    }

    // Clear ECS path data
    clearEntityPath(this.pathData, eid)

    // Remove ECS components then entity
    if (hasComponent(this.world, eid, PathState)) removeComponent(this.world, eid, PathState)
    if (hasComponent(this.world, eid, AnimState)) removeComponent(this.world, eid, AnimState)
    if (hasComponent(this.world, eid, StatusEffect)) removeComponent(this.world, eid, StatusEffect)
    if (hasComponent(this.world, eid, Position)) removeComponent(this.world, eid, Position)
    if (hasComponent(this.world, eid, SpriteRef)) removeComponent(this.world, eid, SpriteRef)
    if (hasComponent(this.world, eid, AgentId)) removeComponent(this.world, eid, AgentId)
    removeEntity(this.world, eid)

    this.agentEntityMap.delete(id)

    // Null out the ID table slot to prevent stale lookups
    const idIdx = this.agentIdTable.indexOf(id)
    if (idIdx >= 0) this.agentIdTable[idIdx] = ''

    this.renderer.removeSprite(id)

    console.debug(`[GameSession] Removed agent: ${id}`)
  }

  // ─── Delegated Renderer Methods ───

  getAgents(): Map<string, AgentSpriteObject> {
    const result = new Map<string, AgentSpriteObject>()
    for (const [agentId] of this.agentEntityMap) {
      const sprite = this.renderer.getSpriteById(agentId)
      if (sprite) result.set(agentId, sprite)
    }
    return result
  }

  startDemo(): void {
    const isoMap = this.renderer.getIsoMap()
    if (!isoMap) return

    for (const [agentId, eid] of this.agentEntityMap) {
      this.startDemoBehavior(agentId, eid, isoMap)
    }

    this.renderer.startDemoCycle()
  }

  private startDemoBehavior(
    agentId: string,
    eid: number,
    isoMap: { getWalkableNeighbors(x: number, y: number): { x: number; y: number }[] },
  ): void {
    const capturedSessionId = this.sessionId

    const doAction = () => {
      // Stale session check
      if (this.sessionId !== capturedSessionId || this.disposed) return
      if (!this.world || !hasComponent(this.world, eid, Position)) return

      if (hasComponent(this.world, eid, PathState) || hasComponent(this.world, eid, AnimState)) {
        this.demoTimers.set(agentId, setTimeout(doAction, 500))
        return
      }

      const roll = Math.random()
      if (roll < 0.5) {
        const tileX = Position.x[eid] as number
        const tileY = Position.y[eid] as number
        const neighbors = isoMap.getWalkableNeighbors(tileX, tileY)
        if (neighbors.length > 0) {
          const target = neighbors[Math.floor(Math.random() * neighbors.length)]
          this.moveAgentTo(agentId, target.x, target.y)
        }
      } else {
        const hdAnim = HD_SILLY_ANIMATIONS[Math.floor(Math.random() * HD_SILLY_ANIMATIONS.length)]
        this.playAnimationInternal(agentId, hdAnim)
      }

      const delay = 1000 + Math.random() * 3000
      this.demoTimers.set(agentId, setTimeout(doAction, delay))
    }

    this.demoTimers.set(agentId, setTimeout(doAction, Math.random() * 2000))
  }

  centerOn(tileX: number, tileY: number): void {
    this.renderer.centerOn(tileX, tileY)
  }

  setZoom(level: number): void {
    this.renderer.setZoom(level)
  }

  highlightAgent(id: string, color: string): void {
    this.renderer.highlightAgent(id, color)
  }

  clearHighlight(id: string): void {
    this.renderer.clearHighlight(id)
  }

  onAgentClick(callback: (agentId: string) => void): void {
    this.renderer.onAgentClick(callback)
  }

  getAgentScreenPosition(id: string): { x: number; y: number } | null {
    return this.renderer.getAgentScreenPosition(id)
  }

  setPhase(phase: RoundPhase): void {
    this.renderer.setPhase(phase)
  }

  startDemoCycle(): void {
    this.renderer.startDemoCycle()
  }
}
