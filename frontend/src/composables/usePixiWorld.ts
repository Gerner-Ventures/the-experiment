import { Application, Container } from 'pixi.js'
import type { MapTheme, MapData } from '@/types/world'
import type { CharacterSprite } from '@/config/character-sprites'
import { IsometricMap, tileToScreen } from '@/components/world/pixi/IsometricMap'
import { CameraController } from '@/components/world/pixi/CameraController'
import { AgentSpriteObject } from '@/components/world/pixi/AgentSprite'
import { AmbientOverlay } from '@/components/world/pixi/AmbientOverlay'

export interface UsePixiWorld {
  mount(container: HTMLElement): Promise<void>
  destroy(): void
  loadMap(theme: MapTheme, mapData: MapData): void
  spawnAgent(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }): void
  startDemo(): void
  centerOn(tileX: number, tileY: number): void
  setZoom(level: number): void
  getAgents(): Map<string, AgentSpriteObject>
}

export function usePixiWorld(): UsePixiWorld {
  let app: Application | null = null
  let camera: CameraController | null = null
  let isoMap: IsometricMap | null = null
  let ambientOverlay: AmbientOverlay | null = null
  let worldContainer: Container | null = null
  const agents = new Map<string, AgentSpriteObject>()
  let canvasEl: HTMLCanvasElement | null = null

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

    worldContainer = new Container()
    worldContainer.sortableChildren = true
    app.stage.addChild(worldContainer)

    // Tick loop
    app.ticker.add(() => {
      const dt = app!.ticker.deltaMS / 1000
      camera?.update()
      for (const agent of agents.values()) {
        agent.update(dt)
      }
      ambientOverlay?.update(dt)
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
    if (camera) {
      camera.destroy(canvasEl)
    }

    // Render map
    isoMap = new IsometricMap()
    isoMap.load(mapData, theme)
    isoMap.container.zIndex = 0
    worldContainer.addChild(isoMap.container)

    // Ambient overlay
    const w = app.screen.width
    const h = app.screen.height
    ambientOverlay = new AmbientOverlay(w, h, theme.ambient)
    worldContainer.addChild(ambientOverlay.container)

    // Camera
    camera = new CameraController(worldContainer, canvasEl, w, h)
    camera.setZoom(1.2)
  }

  function spawnAgent(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }) {
    if (!worldContainer || !isoMap) return

    const agentObj = new AgentSpriteObject(id, name, sprite, tile.x, tile.y)
    isoMap.container.addChild(agentObj.container)
    agents.set(id, agentObj)
  }

  function startDemo() {
    if (!isoMap) return

    for (const agent of agents.values()) {
      agent.startRandomBehavior((x, y) => {
        const neighbors = isoMap!.getWalkableNeighbors(x, y)
        return neighbors.map(t => ({ x: t.x, y: t.y }))
      })
    }
  }

  function centerOn(tileX: number, tileY: number) {
    if (!camera) return
    const screen = tileToScreen(tileX, tileY)
    camera.centerOn(screen.x, screen.y)
  }

  function setZoom(level: number) {
    camera?.setZoom(level)
  }

  function getAgents(): Map<string, AgentSpriteObject> {
    return agents
  }

  function destroy() {
    for (const agent of agents.values()) {
      agent.destroy()
    }
    agents.clear()

    if (canvasEl && camera) {
      camera.destroy(canvasEl)
    }
    camera = null

    if (ambientOverlay) {
      ambientOverlay.destroy()
      ambientOverlay = null
    }

    if (isoMap) {
      isoMap.destroy()
      isoMap = null
    }

    if (app) {
      app.destroy(true, { children: true })
      app = null
    }

    worldContainer = null
    canvasEl = null
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
  }
}
