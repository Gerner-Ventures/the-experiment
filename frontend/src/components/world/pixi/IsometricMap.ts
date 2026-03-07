import { Container, Graphics } from 'pixi.js'
import type { MapData, MapTheme, TileDef, TilePalette } from '@/types/world'
import { BuildingRenderer } from './BuildingRenderer'
import { TILE_W, TILE_H, tileToScreen } from './isometric-utils'

export { tileToScreen, screenToTile } from './isometric-utils'

function drawDiamond(g: Graphics, x: number, y: number, fill: string, stroke: string) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  g.poly([
    x,      y - hh,   // top
    x + hw, y,        // right
    x,      y + hh,   // bottom
    x - hw, y,        // left
  ])
  g.fill(fill)
  g.stroke({ color: stroke, width: 1, alpha: 0.3 })
}

function getTileColor(tileType: string, palette: TilePalette): [string, string] {
  const p = palette[tileType as keyof TilePalette]
  if (p) return [p[0], p[1]]
  return [palette.grass[0], palette.grass[1]]
}

export class IsometricMap {
  container: Container
  private tileGrid: (TileDef | null)[][] = []
  private mapWidth = 0
  private mapHeight = 0
  private buildingRenderer: BuildingRenderer

  constructor() {
    this.container = new Container()
    this.container.sortableChildren = true
    this.buildingRenderer = new BuildingRenderer()
  }

  load(mapData: MapData, theme: MapTheme) {
    this.container.removeChildren()
    this.mapWidth = mapData.width
    this.mapHeight = mapData.height

    // Build 2D grid for lookups
    this.tileGrid = Array.from({ length: this.mapHeight }, () =>
      Array.from({ length: this.mapWidth }, () => null)
    )
    for (const tile of mapData.tiles) {
      this.tileGrid[tile.y][tile.x] = tile
    }

    // Theme-specific background layer (water, void, etc.)
    this.renderBackground(theme)

    // Ground layer
    const groundLayer = new Container()
    groundLayer.zIndex = 1
    const groundGraphics = new Graphics()

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const tile = this.tileGrid[y][x]
        if (!tile) continue
        const screen = tileToScreen(x, y)

        // Theme-specific tile overrides
        if (this.isCodeRiverTile(tile, theme)) {
          this.drawCodeRiverTile(groundGraphics, screen.x, screen.y)
          continue
        }
        if (this.isWaterTile(tile, theme)) {
          this.drawWaterTile(groundGraphics, screen.x, screen.y)
          continue
        }

        const [fill, stroke] = getTileColor(tile.tileType, theme.tilePalette)

        // Add sand variation for island theme fence tiles
        if (theme.id === 'lord-of-the-flies' && tile.tileType === 'fence') {
          drawDiamond(groundGraphics, screen.x, screen.y, '#e8d8b0', '#d0c8a0')
          continue
        }

        drawDiamond(groundGraphics, screen.x, screen.y, fill, stroke)

        // Field decoration (crops for island, barren for others)
        if (tile.tileType === 'field' && theme.id === 'lord-of-the-flies') {
          this.drawCropLines(groundGraphics, screen.x, screen.y)
        }
      }
    }

    groundLayer.addChild(groundGraphics)
    this.container.addChild(groundLayer)

    // Decorations layer (trees for island, grid overlay for matrix)
    this.renderDecorations(theme, mapData)

    // Building layer
    const buildingLayer = new Container()
    buildingLayer.zIndex = 10
    buildingLayer.sortableChildren = true

    const drawnLocations = new Set<string>()
    for (const loc of mapData.locations) {
      if (loc.type === 'boundary') continue
      if (drawnLocations.has(loc.id)) continue
      drawnLocations.add(loc.id)

      const hasBuildingTile = mapData.tiles.some(
        t => t.locationId === loc.id && t.tileType === 'building'
      )
      if (!hasBuildingTile) continue

      const building = this.buildingRenderer.render(loc, theme)
      const screen = tileToScreen(loc.x, loc.y)
      building.x = screen.x
      building.y = screen.y
      building.zIndex = loc.y + loc.x
      buildingLayer.addChild(building)
    }

    this.container.addChild(buildingLayer)

    // Center the map
    const center = tileToScreen(this.mapWidth / 2, this.mapHeight / 2)
    this.container.pivot.set(center.x, center.y)
  }

  // ─── THEME-SPECIFIC GROUND FEATURES ───

  private renderBackground(theme: MapTheme) {
    const bg = new Graphics()
    bg.zIndex = -1

    if (theme.id === 'lord-of-the-flies') {
      // Ocean surrounding the island
      const pad = 5
      const tl = tileToScreen(-pad, -pad)
      const tr = tileToScreen(this.mapWidth + pad, -pad)
      const br = tileToScreen(this.mapWidth + pad, this.mapHeight + pad)
      const bl = tileToScreen(-pad, this.mapHeight + pad)
      bg.poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y])
      bg.fill('#1a6b8a')

      // Beach ring — draw sandy diamonds around the perimeter (just outside fence)
      for (let x = -1; x <= this.mapWidth; x++) {
        for (const y of [-1, this.mapHeight]) {
          const s = tileToScreen(x, y)
          drawDiamond(bg, s.x, s.y, '#e8d8b0', '#d8c8a0')
        }
      }
      for (let y = -1; y <= this.mapHeight; y++) {
        for (const x of [-1, this.mapWidth]) {
          const s = tileToScreen(x, y)
          drawDiamond(bg, s.x, s.y, '#e8d8b0', '#d8c8a0')
        }
      }
    } else if (theme.id === 'matrix') {
      // Dark void with faint grid
      const pad = 5
      const tl = tileToScreen(-pad, -pad)
      const tr = tileToScreen(this.mapWidth + pad, -pad)
      const br = tileToScreen(this.mapWidth + pad, this.mapHeight + pad)
      const bl = tileToScreen(-pad, this.mapHeight + pad)
      bg.poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y])
      bg.fill('#020202')
    } else if (theme.id === '1984') {
      // Smoggy industrial wasteland
      const pad = 3
      const tl = tileToScreen(-pad, -pad)
      const tr = tileToScreen(this.mapWidth + pad, -pad)
      const br = tileToScreen(this.mapWidth + pad, this.mapHeight + pad)
      const bl = tileToScreen(-pad, this.mapHeight + pad)
      bg.poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y])
      bg.fill('#1a1510')
    }

    this.container.addChild(bg)
  }

  private isCodeRiverTile(tile: TileDef, theme: MapTheme): boolean {
    // Matrix theme: path tiles along column 9 become a "code river"
    return theme.id === 'matrix' && tile.tileType === 'path' && tile.x === 9
  }

  private drawCodeRiverTile(g: Graphics, sx: number, sy: number) {
    const hw = TILE_W / 2
    const hh = TILE_H / 2

    // Dark base
    g.poly([sx, sy - hh, sx + hw, sy, sx, sy + hh, sx - hw, sy])
    g.fill('#001100')
    g.stroke({ color: '#003300', width: 1, alpha: 0.5 })

    // Glowing code stream lines
    const lines = 3
    for (let i = 0; i < lines; i++) {
      const offset = (i - 1) * 6
      g.moveTo(sx + offset - 2, sy - hh + 2)
      g.lineTo(sx + offset + 2, sy + hh - 2)
      g.stroke({ color: '#00ff41', width: 1, alpha: 0.15 + Math.random() * 0.2 })
    }

    // Bright center glow
    g.circle(sx, sy, 4)
    g.fill({ color: '#00ff41', alpha: 0.06 })
  }

  private isWaterTile(tile: TileDef, theme: MapTheme): boolean {
    // Island theme: fence perimeter tiles become water/beach
    return theme.id === 'lord-of-the-flies' && tile.tileType === 'fence'
  }

  private drawWaterTile(g: Graphics, sx: number, sy: number) {
    const hw = TILE_W / 2
    const hh = TILE_H / 2
    g.poly([sx, sy - hh, sx + hw, sy, sx, sy + hh, sx - hw, sy])
    g.fill('#e8d8b0')
    g.stroke({ color: '#d0c090', width: 1, alpha: 0.4 })

    // Wave hints
    g.moveTo(sx - 8, sy - 2)
    g.lineTo(sx + 8, sy - 2)
    g.stroke({ color: '#c0b888', width: 0.5, alpha: 0.3 })
  }

  private drawCropLines(g: Graphics, sx: number, sy: number) {
    // Little crop rows on field tiles
    for (let i = -2; i <= 2; i++) {
      g.moveTo(sx + i * 5 - 6, sy - 4)
      g.lineTo(sx + i * 5 + 6, sy + 4)
      g.stroke({ color: '#4a7a2a', width: 1, alpha: 0.3 })
    }
  }

  private renderDecorations(theme: MapTheme, mapData: MapData) {
    const decoLayer = new Container()
    decoLayer.zIndex = 5

    if (theme.id === 'lord-of-the-flies') {
      this.renderPalmTrees(decoLayer, mapData)
    } else if (theme.id === 'matrix') {
      this.renderGridOverlay(decoLayer)
    }

    this.container.addChild(decoLayer)
  }

  private renderPalmTrees(layer: Container, mapData: MapData) {
    // Place palm trees on grass tiles near the perimeter
    const g = new Graphics()
    const perimeterGrass = mapData.tiles.filter(
      t => t.tileType === 'grass' && t.walkable &&
      (t.x <= 2 || t.x >= 17 || t.y <= 2 || t.y >= 17) &&
      !t.locationId
    )

    // Only place a few — every 3rd qualifying tile
    for (let i = 0; i < perimeterGrass.length; i += 3) {
      const tile = perimeterGrass[i]
      const s = tileToScreen(tile.x, tile.y)

      // Trunk
      g.moveTo(s.x, s.y)
      g.lineTo(s.x + 2, s.y - 22)
      g.stroke({ color: '#6b4423', width: 2 })

      // Fronds (simplified)
      const top = s.y - 22
      g.moveTo(s.x + 2, top)
      g.lineTo(s.x - 8, top + 4)
      g.stroke({ color: '#3a7a2a', width: 2, alpha: 0.8 })
      g.moveTo(s.x + 2, top)
      g.lineTo(s.x + 12, top + 4)
      g.stroke({ color: '#3a7a2a', width: 2, alpha: 0.8 })
      g.moveTo(s.x + 2, top)
      g.lineTo(s.x - 5, top - 3)
      g.stroke({ color: '#4a8a3a', width: 2, alpha: 0.7 })
      g.moveTo(s.x + 2, top)
      g.lineTo(s.x + 9, top - 3)
      g.stroke({ color: '#4a8a3a', width: 2, alpha: 0.7 })
    }

    layer.addChild(g)
  }

  private renderGridOverlay(layer: Container) {
    // Faint green grid lines across the whole map (Matrix vibe)
    const g = new Graphics()

    for (let x = 0; x <= this.mapWidth; x++) {
      const start = tileToScreen(x, 0)
      const end = tileToScreen(x, this.mapHeight)
      g.moveTo(start.x, start.y)
      g.lineTo(end.x, end.y)
      g.stroke({ color: '#00ff41', width: 0.5, alpha: 0.04 })
    }
    for (let y = 0; y <= this.mapHeight; y++) {
      const start = tileToScreen(0, y)
      const end = tileToScreen(this.mapWidth, y)
      g.moveTo(start.x, start.y)
      g.lineTo(end.x, end.y)
      g.stroke({ color: '#00ff41', width: 0.5, alpha: 0.04 })
    }

    layer.addChild(g)
  }

  getTileAt(x: number, y: number): TileDef | null {
    if (y < 0 || y >= this.mapHeight || x < 0 || x >= this.mapWidth) return null
    return this.tileGrid[y]?.[x] ?? null
  }

  getWalkableTiles(): TileDef[] {
    const tiles: TileDef[] = []
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const tile = this.tileGrid[y][x]
        if (tile?.walkable) tiles.push(tile)
      }
    }
    return tiles
  }

  getWalkableNeighbors(x: number, y: number): TileDef[] {
    const neighbors: TileDef[] = []
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    for (const [dx, dy] of offsets) {
      const tile = this.getTileAt(x + dx, y + dy)
      if (tile?.walkable) neighbors.push(tile)
    }
    return neighbors
  }

  destroy() {
    this.container.destroy({ children: true })
  }
}
