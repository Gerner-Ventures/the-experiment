/**
 * useRenderer — PixiJS rendering backend.
 *
 * Owns: PixiJS Application, display tree, camera, isoMap, ambient overlay, day/night.
 * Does NOT own: simulation state, entities, tick loop.
 *
 * This is the child composable — useGameWorld (parent) drives it.
 */

import { Application, Container, Sprite, Texture, Rectangle } from 'pixi.js'
import type { MapTheme, MapData } from '@/types/world'
import type { CharacterSprite } from '@/config/character-sprites'
import type { RoundPhase } from '@/types/websocket'
import { IsometricMap, tileToScreen } from '@/components/world/pixi/IsometricMap'
import { CameraController } from '@/components/world/pixi/CameraController'
import { AgentSpriteObject } from '@/components/world/pixi/AgentSprite'
import { AmbientOverlay } from '@/components/world/pixi/AmbientOverlay'
import { DayNightCycle } from '@/components/world/pixi/DayNightCycle'
import { getThemePalette } from '@/config/day-night-palettes'
import type { RenderBridge } from '@/ecs/systems/renderSyncSystem'

export interface UseRenderer {
  mount(container: HTMLElement): Promise<void>
  destroy(): void
  loadMap(theme: MapTheme, mapData: MapData): void

  /** Create a sprite for an agent, returns sprite pool index */
  createSprite(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }): number
  /** Get the underlying AgentSpriteObject by pool index */
  getSpriteByIndex(index: number): AgentSpriteObject | undefined
  /** Get sprite by agent string ID */
  getSpriteById(id: string): AgentSpriteObject | undefined
  /** Remove a sprite from the display tree and pool */
  removeSprite(id: string): void

  /** Register a per-frame update callback (called by ticker) */
  onTick(callback: (dt: number) => void): void

  centerOn(tileX: number, tileY: number): void
  setZoom(level: number): void

  highlightAgent(id: string, color: string): void
  clearHighlight(id: string): void
  onAgentClick(callback: (agentId: string) => void): void
  getAgentScreenPosition(id: string): { x: number; y: number } | null

  setPhase(phase: RoundPhase): void
  startDemoCycle(): void

  /** Create a tile sprite in the dynamic tile layer, returns pool index */
  createTileSprite(tileX: number, tileY: number, frameKey: string): number
  /** Remove a tile sprite by its pool index */
  removeTileSprite(poolIndex: number): void
  /** Remove all tile sprites */
  removeAllTileSprites(): void

  /** Get the render bridge for renderSyncSystem */
  getRenderBridge(): RenderBridge

  /** Get the IsometricMap instance (for pathfinding neighbor queries) */
  getIsoMap(): IsometricMap | null

  /** Update ambient/day-night each frame (called by tick loop) */
  updateVisuals(dt: number): void
}

export function useRenderer(): UseRenderer {
  let app: Application | null = null
  let camera: CameraController | null = null
  let isoMap: IsometricMap | null = null
  let ambientOverlay: AmbientOverlay | null = null
  let dayNightCycle: DayNightCycle | null = null
  let worldContainer: Container | null = null
  let canvasEl: HTMLCanvasElement | null = null
  let agentClickCallback: ((agentId: string) => void) | null = null
  let resizeObserver: ResizeObserver | null = null
  let tickCallbacks: ((dt: number) => void)[] = []

  // Agent sprite pool: indexed array + ID lookup
  const spritePool: AgentSpriteObject[] = []
  const spriteIdMap = new Map<string, number>() // agentId → pool index

  // Tile sprite pool: for ECS-driven dynamic tiles (water, hazards)
  const tileSpritePool: (Sprite | null)[] = []
  // Batched tile update queue: [poolIndex, frameKey] pairs flushed once per frame
  const pendingTileUpdates: { index: number; frameKey: string }[] = []
  // Cached sub-textures by frame key — avoids allocating new Texture objects every frame
  const tileTextureCache = new Map<string, Texture>()

  async function mount(container: HTMLElement): Promise<void> {
    app = new Application()
    await app.init({
      resizeTo: container,
      background: '#050507',
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    container.appendChild(app.canvas as HTMLCanvasElement)
    canvasEl = app.canvas as HTMLCanvasElement

    resizeObserver = new ResizeObserver(() => {
      if (app && camera) {
        const w = app.screen.width
        const h = app.screen.height
        camera.resize(w, h)
        ambientOverlay?.resize(w, h)
        dayNightCycle?.resize(w, h)
      }
    })
    resizeObserver.observe(container)

    worldContainer = new Container()
    worldContainer.sortableChildren = true
    app.stage.addChild(worldContainer)

    // Ticker drives the game loop
    app.ticker.add(() => {
      const dt = app!.ticker.deltaMS / 1000
      camera?.update()
      for (const cb of tickCallbacks) {
        cb(dt)
      }
    })
  }

  function loadMap(theme: MapTheme, mapData: MapData) {
    if (!worldContainer || !app || !canvasEl) return

    // Clean previous
    if (isoMap) {
      worldContainer.removeChild(isoMap.container)
      isoMap.destroy()
    }
    if (ambientOverlay) {
      worldContainer.removeChild(ambientOverlay.container)
      ambientOverlay.destroy()
    }
    if (dayNightCycle) {
      app.stage.removeChild(dayNightCycle.skyGraphics)
      app.stage.removeChild(dayNightCycle.celestialContainer)
      dayNightCycle.destroy()
      dayNightCycle = null
    }
    if (camera) {
      camera.destroy(canvasEl)
    }

    isoMap = new IsometricMap()
    isoMap.load(mapData, theme)
    isoMap.container.zIndex = 0
    worldContainer.addChild(isoMap.container)

    const w = app.screen.width
    const h = app.screen.height
    ambientOverlay = new AmbientOverlay(w, h, theme.ambient)
    worldContainer.addChild(ambientOverlay.container)

    camera = new CameraController(worldContainer, canvasEl, w, h)
    camera.setZoom(0.6)

    if (theme.dayNight?.enabled) {
      const palette = getThemePalette(theme.id)
      if (palette) {
        dayNightCycle = new DayNightCycle(w, h, palette, worldContainer)
        app.stage.addChildAt(dayNightCycle.skyGraphics, 0)
        app.stage.addChild(dayNightCycle.celestialContainer)
        app.stage.sortableChildren = true
      }
    }
  }

  function createSprite(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }): number {
    if (!worldContainer || !isoMap) return -1

    const agentObj = new AgentSpriteObject(id, name, sprite, tile.x, tile.y)
    agentObj.container.eventMode = 'static'
    agentObj.container.cursor = 'pointer'
    agentObj.container.on('pointerdown', () => {
      if (agentClickCallback) agentClickCallback(id)
    })
    isoMap.container.addChild(agentObj.container)

    const index = spritePool.length
    spritePool.push(agentObj)
    spriteIdMap.set(id, index)
    return index
  }

  function getSpriteByIndex(index: number): AgentSpriteObject | undefined {
    return spritePool[index]
  }

  function getSpriteById(id: string): AgentSpriteObject | undefined {
    const index = spriteIdMap.get(id)
    if (index === undefined) return undefined
    return spritePool[index]
  }

  function removeSprite(id: string): void {
    const index = spriteIdMap.get(id)
    if (index === undefined) return

    const sprite = spritePool[index]
    if (sprite) {
      sprite.container.removeFromParent()
      sprite.destroy()
      // Null out slot instead of splicing to avoid index shifts
      ;(spritePool as (AgentSpriteObject | null)[])[index] = null
    }
    spriteIdMap.delete(id)
  }

  function createTileSprite(tileX: number, tileY: number, frameKey: string): number {
    if (!isoMap) return -1
    const dynamicLayer = isoMap.getDynamicTileLayer()
    const atlas = isoMap.getAtlas()
    if (!dynamicLayer || !atlas) return -1

    const frame = atlas.frames.get(frameKey)
    if (!frame) return -1

    // Use cached sub-texture or create and cache on first use
    let subTex = tileTextureCache.get(frameKey)
    if (!subTex) {
      subTex = new Texture({
        source: atlas.texture.source,
        frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
      })
      tileTextureCache.set(frameKey, subTex)
    }

    const sprite = new Sprite(subTex)
    const screen = tileToScreen(tileX, tileY)
    sprite.x = screen.x - frame.w / 2
    sprite.y = screen.y - (frame.h / 2) - 1
    sprite.zIndex = tileY * 100 + tileX
    dynamicLayer.addChild(sprite)

    // Find empty slot or append
    let index = tileSpritePool.indexOf(null)
    if (index === -1) {
      index = tileSpritePool.length
      tileSpritePool.push(sprite)
    } else {
      tileSpritePool[index] = sprite
    }
    return index
  }

  function removeTileSprite(poolIndex: number): void {
    const sprite = tileSpritePool[poolIndex]
    if (!sprite) return
    sprite.removeFromParent()
    sprite.destroy()
    tileSpritePool[poolIndex] = null
  }

  function removeAllTileSprites(): void {
    for (let i = 0; i < tileSpritePool.length; i++) {
      const sprite = tileSpritePool[i]
      if (sprite) {
        sprite.removeFromParent()
        sprite.destroy()
      }
    }
    tileSpritePool.length = 0
    pendingTileUpdates.length = 0
    for (const tex of tileTextureCache.values()) {
      tex.destroy()
    }
    tileTextureCache.clear()
  }

  function onTick(callback: (dt: number) => void) {
    tickCallbacks.push(callback)
  }

  function centerOn(tileX: number, tileY: number) {
    if (!camera) return
    const screen = tileToScreen(tileX, tileY)
    camera.centerOn(screen.x, screen.y)
  }

  function setZoom(level: number) {
    camera?.setZoom(level)
  }

  function highlightAgent(id: string, color: string) {
    getSpriteById(id)?.setHighlight(color)
  }

  function clearHighlight(id: string) {
    getSpriteById(id)?.clearHighlight()
  }

  function onAgentClick(callback: (agentId: string) => void) {
    agentClickCallback = callback
  }

  function getAgentScreenPosition(id: string): { x: number; y: number } | null {
    const sprite = getSpriteById(id)
    if (!sprite || !worldContainer) return null
    const globalPos = sprite.container.getGlobalPosition()
    return { x: globalPos.x, y: globalPos.y }
  }

  function setPhase(phase: RoundPhase) {
    dayNightCycle?.setPhase(phase)
  }

  function startDemoCycle() {
    dayNightCycle?.startDemoCycle()
  }

  function updateVisuals(dt: number) {
    ambientOverlay?.update(dt)
    dayNightCycle?.update(dt)
  }

  function getRenderBridge(): RenderBridge {
    return {
      updateSpritePosition(spriteIndex: number, screenX: number, screenY: number, tileX: number, tileY: number) {
        const sprite = spritePool[spriteIndex]
        if (!sprite) return
        sprite.container.x = screenX
        sprite.container.y = screenY
        sprite.container.zIndex = Math.round(tileY) * 100 + Math.round(tileX)
        // Keep sprite tile position in sync for pathfinding reads
        sprite.tileX = Math.round(tileX)
        sprite.tileY = Math.round(tileY)
      },
      updateSpriteTexture(spriteIndex: number, pose: string) {
        const sprite = spritePool[spriteIndex]
        if (!sprite) return
        sprite.setPose(pose)
      },
      queueTileUpdate(tileSpriteIndex: number, frameKey: string) {
        pendingTileUpdates.push({ index: tileSpriteIndex, frameKey })
      },
      flushTileUpdates() {
        if (pendingTileUpdates.length === 0) return
        const atlas = isoMap?.getAtlas()
        if (!atlas) {
          pendingTileUpdates.length = 0
          return
        }

        for (const { index, frameKey } of pendingTileUpdates) {
          const sprite = tileSpritePool[index]
          if (!sprite) continue

          // Use cached sub-texture or create and cache on first use
          let tex = tileTextureCache.get(frameKey)
          if (!tex) {
            const frame = atlas.frames.get(frameKey)
            if (!frame) continue
            tex = new Texture({
              source: atlas.texture.source,
              frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
            })
            tileTextureCache.set(frameKey, tex)
          }

          sprite.texture = tex
        }
        pendingTileUpdates.length = 0
      },
    }
  }

  function getIsoMap(): IsometricMap | null {
    return isoMap
  }

  function destroy() {
    removeAllTileSprites()

    for (const sprite of spritePool) {
      sprite.destroy()
    }
    spritePool.length = 0
    spriteIdMap.clear()

    if (canvasEl && camera) {
      camera.destroy(canvasEl)
    }
    camera = null

    if (ambientOverlay) {
      ambientOverlay.destroy()
      ambientOverlay = null
    }

    if (dayNightCycle) {
      dayNightCycle.destroy()
      dayNightCycle = null
    }

    if (isoMap) {
      isoMap.destroy()
      isoMap = null
    }

    if (app) {
      app.destroy(true, { children: true })
      app = null
    }

    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    worldContainer = null
    canvasEl = null
    agentClickCallback = null
    tickCallbacks = []
  }

  return {
    mount,
    destroy,
    loadMap,
    createSprite,
    getSpriteByIndex,
    getSpriteById,
    removeSprite,
    onTick,
    centerOn,
    setZoom,
    highlightAgent,
    clearHighlight,
    onAgentClick,
    getAgentScreenPosition,
    setPhase,
    startDemoCycle,
    createTileSprite,
    removeTileSprite,
    removeAllTileSprites,
    getRenderBridge,
    getIsoMap,
    updateVisuals,
  }
}
