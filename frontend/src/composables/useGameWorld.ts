/**
 * useGameWorld — Simulation owner and public API.
 *
 * Owns: bitECS world, entities, systems, tick loop, entity registry.
 * Child: useRenderer (PixiJS rendering backend).
 *
 * Replaces usePixiWorld as the single entry point for all game world operations.
 */

import type { MapTheme, MapData } from '@/types/world'
import type { CharacterSprite } from '@/config/character-sprites'
import type { RoundPhase } from '@/types/websocket'
import type { World } from 'bitecs'
import { addEntity, removeEntity, addComponent, removeComponent, hasComponent, observe, onRemove, onAdd } from 'bitecs'
import { createGameWorld } from '@/ecs/world'
import {
  Position, PathState, AnimState, AgentId, SpriteRef, StatusEffect,
} from '@/ecs/components'
import { pathfindingSystem, setEntityPath, clearEntityPath } from '@/ecs/systems/pathfindingSystem'
import { movementSystem } from '@/ecs/systems/movementSystem'
import { animationSystem, registerAnimation } from '@/ecs/systems/animationSystem'
import { renderSyncSystem, type RenderBridge } from '@/ecs/systems/renderSyncSystem'
import { useRenderer, type UseRenderer } from './useRenderer'
import { tileToScreen } from '@/components/world/pixi/isometric-utils'
import { getHDAnimationForAction, getHDAnimation, HD_SILLY_ANIMATIONS } from '@/config/sprites/hd/animations'
import type { HDAnimationDef } from '@/config/sprites/hd/types'
import type { AgentSpriteObject } from '@/components/world/pixi/AgentSprite'

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

  async function mount(container: HTMLElement): Promise<void> {
    await renderer.mount(container)
    initECS()
    renderBridge = renderer.getRenderBridge()

    renderer.onTick((dt: number) => {
      tick(dt)
    })
  }

  function tick(dt: number): void {
    if (!world) return

    pathfindingSystem(world, dt)
    movementSystem(world)
    animationSystem(world, dt)

    if (renderBridge) {
      renderSyncSystem(world, dt, renderBridge)
    }

    renderer.updateVisuals(dt)
  }

  function loadMap(theme: MapTheme, mapData: MapData): void {
    renderer.loadMap(theme, mapData)
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

    for (const eid of agentEntityMap.values()) {
      clearEntityPath(eid)
    }

    agentEntityMap.clear()
    agentIdTable.length = 0
    renderBridge = null
    world = null

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
