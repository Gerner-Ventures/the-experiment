/**
 * useGameWorld — Simulation owner and public API.
 *
 * Owns: bitECS world, entities, systems, tick loop, entity registry.
 * Child: useRenderer (PixiJS rendering backend).
 *
 * Tick loop uses fixed timestep accumulator (Gaffer on Games pattern):
 * - Simulation runs at fixed 60Hz (FIXED_DT = 1/60s)
 * - Rendering interpolates between previous/current Position for smooth visuals
 * - usePerformanceMonitor instruments every system
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
import { pathfindingSystem, setEntityPath, clearEntityPath } from '@/ecs/systems/pathfindingSystem'
import { movementSystem } from '@/ecs/systems/movementSystem'
import { animationSystem, registerAnimation, resetAnimationRegistry } from '@/ecs/systems/animationSystem'
import { renderSyncSystem, type RenderBridge, type PrevPositions } from '@/ecs/systems/renderSyncSystem'
import { waterSystem, computeWaterPhaseOffset, OCEAN_FRAME_DURATION, CODE_RIVER_FRAME_DURATION, WATER_FRAME_COUNT } from '@/ecs/systems/waterSystem'
import { useRenderer, type UseRenderer } from './useRenderer'
import { usePerformanceMonitor, type PerformanceMonitor } from './usePerformanceMonitor'
import { tileToScreen } from '@/components/world/pixi/isometric-utils'
import { getHDAnimationForAction, getHDAnimation, HD_SILLY_ANIMATIONS } from '@/config/sprites/hd/animations'
import type { HDAnimationDef } from '@/config/sprites/hd/types'
import type { AgentSpriteObject } from '@/components/world/pixi/AgentSprite'

// ─── Fixed Timestep Constants ───

const FIXED_DT = 1 / 60       // 16.67ms simulation step
const MAX_ACCUMULATOR = FIXED_DT * 5  // safety cap: max 5 catch-up steps

export interface UseGameWorld {
  mount(container: HTMLElement): Promise<void>
  destroy(): void
  loadMap(theme: MapTheme, mapData: MapData): void

  spawnAgent(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }): void
  startDemo(): void

  centerOn(tileX: number, tileY: number): void
  setZoom(level: number): void

  /** Get agent sprite objects by ID (for pathfinding/position reads) */
  getAgents(): Map<string, AgentSpriteObject>
  moveAgentTo(id: string, tileX: number, tileY: number): void
  moveAgentAlongPath(id: string, path: { x: number; y: number }[], onComplete?: () => void): void
  playAction(id: string, animationName: string, onComplete: () => void): void

  highlightAgent(id: string, color: string): void
  clearHighlight(id: string): void
  onAgentClick(callback: (agentId: string) => void): void
  getAgentScreenPosition(id: string): { x: number; y: number } | null

  removeAgent(id: string): void

  setPhase(phase: RoundPhase): void
  startDemoCycle(): void
}

export function useGameWorld(): UseGameWorld {
  let world: World | null = null
  const renderer: UseRenderer = useRenderer()
  const perfMonitor: PerformanceMonitor = usePerformanceMonitor()

  // Entity registry: agentId string → ECS entity ID
  const agentEntityMap = new Map<string, number>()

  // Reverse lookup table: index → agentId string
  const agentIdTable: string[] = []

  // Pending callbacks for path/anim completion
  const pendingCallbacks = new Map<string, () => void>()

  // Render bridge (lazy-initialized after mount)
  let renderBridge: RenderBridge | null = null

  // Demo mode timers
  const demoTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Fixed timestep state
  let accumulator = 0
  let prevPositions: PrevPositions | null = null

  // Tile entity registry: "x,y" → ECS entity ID
  const tileEntityMap = new Map<string, number>()

  function initECS(): void {
    world = createGameWorld()

    // Path complete → stop walk animation, fire callback
    observe(world, onRemove(PathState), (eid: number) => {
      const idIndex = AgentId.idIndex[eid] as number
      const agentId = agentIdTable[idIndex]
      if (!agentId) return

      // Stop the walk animation that was auto-started by onAdd(PathState)
      // Delete anim callback first to prevent it firing during removal
      if (!pendingCallbacks.has(agentId + ':anim') && hasComponent(world!, eid, AnimState)) {
        removeComponent(world!, eid, AnimState)
      }

      const cb = pendingCallbacks.get(agentId + ':path')
      if (cb) {
        pendingCallbacks.delete(agentId + ':path')
        cb()
      }
    })

    // Animation complete → fire callback
    observe(world, onRemove(AnimState), (eid: number) => {
      const idIndex = AgentId.idIndex[eid] as number
      const agentId = agentIdTable[idIndex]
      if (!agentId) return
      const cb = pendingCallbacks.get(agentId + ':anim')
      if (cb) {
        pendingCallbacks.delete(agentId + ':anim')
        cb()
      }
    })

    // Path starts → auto-start walk animation
    observe(world, onAdd(PathState), (eid: number) => {
      if (!world) return
      const walkAnim = getHDAnimation('walk')
      const animIdx = registerAnimation(walkAnim)
      addComponent(world, eid, AnimState)
      AnimState.frameIndex[eid] = 0
      AnimState.elapsed[eid] = 0
      AnimState.loop[eid] = 1
      AnimState.animIndex[eid] = animIdx
    })

    // StatusEffect lifecycle (stubs — visual overlays added later)
    observe(world, onAdd(StatusEffect), (eid: number) => {
      console.debug('[ECS] StatusEffect added to entity', eid)
    })

    observe(world, onRemove(StatusEffect), (eid: number) => {
      console.debug('[ECS] StatusEffect removed from entity', eid)
    })
  }

  /** Snapshot positions of all entities with Position + SpriteRef for render interpolation */
  function snapshotPositions(w: World): PrevPositions {
    const snapshot: PrevPositions = prevPositions ?? new Map()
    snapshot.clear()

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

  async function mount(container: HTMLElement): Promise<void> {
    await renderer.mount(container)
    initECS()
    renderBridge = renderer.getRenderBridge()

    renderer.onTick((dt: number) => {
      tick(dt)
    })

    // Expose dev panel in development only
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__devWorld = {
        perf: {
          getPercentiles: () => perfMonitor.getPercentiles(),
          getSystemBreakdown: () => perfMonitor.getSystemBreakdown(),
          exportLast: (n?: number) => perfMonitor.exportMetrics(n),
        },
        getEntityCount: () => agentEntityMap.size,
        getTileEntityCount: () => tileEntityMap.size,
      }
    }
  }

  function tick(dt: number): void {
    if (!world) return

    perfMonitor.beginFrame()

    // Fixed timestep accumulator — clamp to prevent spiral of death
    accumulator += Math.min(dt, MAX_ACCUMULATOR)

    while (accumulator >= FIXED_DT) {
      // Snapshot current positions for render interpolation
      prevPositions = snapshotPositions(world)

      // --- Simulation systems (fixed dt) ---

      perfMonitor.beginSystem('water')
      waterSystem(world, FIXED_DT)
      perfMonitor.endSystem()

      perfMonitor.beginSystem('pathfinding')
      pathfindingSystem(world, FIXED_DT)
      perfMonitor.endSystem()

      perfMonitor.beginSystem('movement')
      movementSystem(world)
      perfMonitor.endSystem()

      perfMonitor.beginSystem('animation')
      animationSystem(world, FIXED_DT)
      perfMonitor.endSystem()

      accumulator -= FIXED_DT
    }

    // Render with interpolation alpha
    const alpha = accumulator / FIXED_DT

    perfMonitor.beginSystem('renderSync')
    if (renderBridge) {
      renderSyncSystem(world, dt, renderBridge, alpha, prevPositions)
    }
    perfMonitor.endSystem()

    renderer.updateVisuals(dt)

    perfMonitor.endFrame(agentEntityMap.size, 0)
  }

  function loadMap(theme: MapTheme, mapData: MapData): void {
    // Clean up previous tile entities before loading new map
    destroyTileEntities()

    renderer.loadMap(theme, mapData)

    // Spawn water tile entities
    if (world) {
      const isoMap = renderer.getIsoMap()
      if (isoMap) {
        const waterPositions = isoMap.getWaterPositions()
        for (const pos of waterPositions) {
          spawnWaterEntity(pos.x, pos.y, pos.variant)
        }
      }
    }
  }

  function spawnWaterEntity(tileX: number, tileY: number, variant: 'ocean' | 'code_river'): void {
    if (!world) return

    const variantNum = variant === 'code_river' ? WATER_VARIANTS.CODE_RIVER : WATER_VARIANTS.OCEAN
    const frameKey = variant === 'code_river' ? 'code_river_0' : 'ocean_0'
    const tileSpriteIndex = renderer.createTileSprite(tileX, tileY, frameKey)
    if (tileSpriteIndex < 0) return

    const eid = addEntity(world)

    addComponent(world, eid, TileRef)
    TileRef.tileX[eid] = tileX
    TileRef.tileY[eid] = tileY
    TileRef.tileSpriteIndex[eid] = tileSpriteIndex

    addComponent(world, eid, WaterState)
    WaterState.variant[eid] = variantNum
    // Set phase offset for staggered ripple animation — decompose into
    // initial frame index + intra-frame remainder to avoid frame-skipping on spawn
    const frameDuration = variantNum === WATER_VARIANTS.CODE_RIVER
      ? CODE_RIVER_FRAME_DURATION
      : OCEAN_FRAME_DURATION
    const totalOffset = computeWaterPhaseOffset(tileX, tileY, frameDuration)
    WaterState.frame[eid] = Math.floor(totalOffset / frameDuration) % WATER_FRAME_COUNT
    WaterState.elapsed[eid] = totalOffset % frameDuration

    tileEntityMap.set(`${tileX},${tileY}`, eid)
  }

  function destroyTileEntities(): void {
    if (!world) return
    for (const eid of tileEntityMap.values()) {
      removeEntity(world, eid)
    }
    tileEntityMap.clear()
    renderer.removeAllTileSprites()
  }

  function spawnAgent(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }): void {
    if (!world) return

    const spriteIndex = renderer.createSprite(id, name, sprite, tile)
    if (spriteIndex < 0) return

    const eid = addEntity(world)
    const idIndex = agentIdTable.length
    agentIdTable.push(id)

    const screen = tileToScreen(tile.x, tile.y)
    addComponent(world, eid, Position)
    Position.x[eid] = tile.x
    Position.y[eid] = tile.y
    Position.screenX[eid] = screen.x
    Position.screenY[eid] = screen.y

    addComponent(world, eid, AgentId)
    AgentId.idIndex[eid] = idIndex

    addComponent(world, eid, SpriteRef)
    SpriteRef.spriteIndex[eid] = spriteIndex

    agentEntityMap.set(id, eid)
  }

  function startDemo(): void {
    const isoMap = renderer.getIsoMap()
    if (!isoMap) return

    for (const [agentId, eid] of agentEntityMap) {
      startDemoBehavior(agentId, eid, isoMap)
    }

    renderer.startDemoCycle()
  }

  function startDemoBehavior(
    agentId: string,
    eid: number,
    isoMap: { getWalkableNeighbors(x: number, y: number): { x: number; y: number }[] },
  ): void {
    const doAction = () => {
      if (!world || !hasComponent(world, eid, Position)) return

      if (hasComponent(world, eid, PathState) || hasComponent(world, eid, AnimState)) {
        demoTimers.set(agentId, setTimeout(doAction, 500))
        return
      }

      const roll = Math.random()
      if (roll < 0.5) {
        const tileX = Position.x[eid] as number
        const tileY = Position.y[eid] as number
        const neighbors = isoMap.getWalkableNeighbors(tileX, tileY)
        if (neighbors.length > 0) {
          const target = neighbors[Math.floor(Math.random() * neighbors.length)]
          moveAgentTo(agentId, target.x, target.y)
        }
      } else {
        const hdAnim = HD_SILLY_ANIMATIONS[Math.floor(Math.random() * HD_SILLY_ANIMATIONS.length)]
        playAnimationInternal(agentId, hdAnim)
      }

      const delay = 1000 + Math.random() * 3000
      demoTimers.set(agentId, setTimeout(doAction, delay))
    }

    demoTimers.set(agentId, setTimeout(doAction, Math.random() * 2000))
  }

  function centerOn(tileX: number, tileY: number): void {
    renderer.centerOn(tileX, tileY)
  }

  function setZoom(level: number): void {
    renderer.setZoom(level)
  }

  function getAgents(): Map<string, AgentSpriteObject> {
    const result = new Map<string, AgentSpriteObject>()
    for (const [agentId] of agentEntityMap) {
      const sprite = renderer.getSpriteById(agentId)
      if (sprite) result.set(agentId, sprite)
    }
    return result
  }

  function moveAgentTo(id: string, tileX: number, tileY: number): void {
    moveAgentAlongPath(id, [{ x: tileX, y: tileY }])
  }

  function moveAgentAlongPath(id: string, path: { x: number; y: number }[], onComplete?: () => void): void {
    if (!world) {
      onComplete?.()
      return
    }

    const eid = agentEntityMap.get(id)
    if (eid === undefined) {
      onComplete?.()
      return
    }

    if (path.length === 0) {
      onComplete?.()
      return
    }

    // Stop existing animation (walk anim will be auto-set by PathState onAdd observer)
    // Delete any pending anim callback BEFORE removing AnimState to prevent premature firing
    pendingCallbacks.delete(id + ':anim')
    if (hasComponent(world, eid, AnimState)) {
      removeComponent(world, eid, AnimState)
    }

    if (onComplete) {
      pendingCallbacks.set(id + ':path', onComplete)
    }

    setEntityPath(eid, path)

    const currentX = (Position.x[eid] as number) || 0
    const currentY = (Position.y[eid] as number) || 0

    addComponent(world, eid, PathState)
    PathState.waypointIndex[eid] = 0
    PathState.waypointCount[eid] = path.length
    PathState.progress[eid] = 0
    PathState.fromX[eid] = currentX
    PathState.fromY[eid] = currentY
    PathState.toX[eid] = path[0].x
    PathState.toY[eid] = path[0].y
  }

  function playAction(id: string, animationName: string, onComplete: () => void): void {
    const anim = getHDAnimationForAction(animationName) ?? getHDAnimation(animationName)
    playAnimationInternal(id, anim, onComplete)
  }

  function playAnimationInternal(id: string, anim: HDAnimationDef, onComplete?: () => void): void {
    if (!world) {
      onComplete?.()
      return
    }

    const eid = agentEntityMap.get(id)
    if (eid === undefined) {
      onComplete?.()
      return
    }

    const animIdx = registerAnimation(anim)

    // Delete any pending anim callback BEFORE removing AnimState to prevent premature firing
    pendingCallbacks.delete(id + ':anim')
    if (hasComponent(world, eid, AnimState)) {
      removeComponent(world, eid, AnimState)
    }

    // Set callback AFTER removing old AnimState so the observer doesn't fire it
    if (onComplete && !anim.loop) {
      pendingCallbacks.set(id + ':anim', onComplete)
    }

    addComponent(world, eid, AnimState)
    AnimState.frameIndex[eid] = 0
    AnimState.elapsed[eid] = 0
    AnimState.loop[eid] = anim.loop ? 1 : 0
    AnimState.animIndex[eid] = animIdx

    if (anim.loop && onComplete) {
      onComplete()
    }
  }

  function highlightAgent(id: string, color: string): void {
    renderer.highlightAgent(id, color)
  }

  function clearHighlight(id: string): void {
    renderer.clearHighlight(id)
  }

  function onAgentClick(callback: (agentId: string) => void): void {
    renderer.onAgentClick(callback)
  }

  function getAgentScreenPosition(id: string): { x: number; y: number } | null {
    return renderer.getAgentScreenPosition(id)
  }

  function setPhase(phase: RoundPhase): void {
    renderer.setPhase(phase)
  }

  function startDemoCycle(): void {
    renderer.startDemoCycle()
  }

  function removeAgent(id: string): void {
    if (!world) return

    const eid = agentEntityMap.get(id)
    if (eid === undefined) return

    // Clean up pending callbacks
    pendingCallbacks.delete(id + ':path')
    pendingCallbacks.delete(id + ':anim')

    // Clean up demo timer
    const timer = demoTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      demoTimers.delete(id)
    }

    // Clear ECS path data
    clearEntityPath(eid)

    // Remove ECS components then entity
    if (hasComponent(world, eid, PathState)) removeComponent(world, eid, PathState)
    if (hasComponent(world, eid, AnimState)) removeComponent(world, eid, AnimState)
    if (hasComponent(world, eid, StatusEffect)) removeComponent(world, eid, StatusEffect)
    if (hasComponent(world, eid, Position)) removeComponent(world, eid, Position)
    if (hasComponent(world, eid, SpriteRef)) removeComponent(world, eid, SpriteRef)
    if (hasComponent(world, eid, AgentId)) removeComponent(world, eid, AgentId)
    removeEntity(world, eid)

    agentEntityMap.delete(id)

    // Null out the ID table slot to prevent stale lookups if entity IDs are reused
    const idIdx = agentIdTable.indexOf(id)
    if (idIdx >= 0) agentIdTable[idIdx] = ''

    // Remove from renderer
    renderer.removeSprite(id)

    console.debug(`[GameWorld] Removed agent: ${id}`)
  }

  function destroy(): void {
    for (const timer of demoTimers.values()) {
      clearTimeout(timer)
    }
    demoTimers.clear()
    pendingCallbacks.clear()

    destroyTileEntities()

    for (const eid of agentEntityMap.values()) {
      clearEntityPath(eid)
    }

    agentEntityMap.clear()
    agentIdTable.length = 0
    resetAnimationRegistry()
    renderBridge = null
    world = null
    accumulator = 0
    prevPositions = null

    // Clean up dev panel
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      delete (window as unknown as Record<string, unknown>).__devWorld
    }

    renderer.destroy()
  }

  return {
    mount,
    destroy,
    loadMap,
    spawnAgent,
    startDemo,
    centerOn,
    setZoom,
    getAgents,
    moveAgentTo,
    moveAgentAlongPath,
    playAction,
    removeAgent,
    highlightAgent,
    clearHighlight,
    onAgentClick,
    getAgentScreenPosition,
    setPhase,
    startDemoCycle,
  }
}
