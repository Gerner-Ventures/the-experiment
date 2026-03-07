import { Container, Graphics, Text } from 'pixi.js'
import type { LocationDef, MapTheme } from '@/types/world'
import { TILE_W, TILE_H } from './isometric-utils'

const BASE_HEIGHT = 40

export class BuildingRenderer {
  render(location: LocationDef, theme: MapTheme): Container {
    const container = new Container()
    const palette = theme.tilePalette.building
    const [fill, stroke, highlight] = palette

    const w = location.width
    const h = location.height
    const hw = TILE_W / 2
    const hh = TILE_H / 2

    switch (theme.buildingStyle) {
      case 'wireframe':
        this.drawWireframe(container, w, h, hw, hh, location)
        break
      case 'roman':
        this.drawRoman(container, w, h, hw, hh, fill, stroke, highlight, location)
        break
      case 'brutalist':
        this.drawBrutalist(container, w, h, hw, hh, fill, stroke, highlight, location)
        break
      case 'huts':
      default:
        this.drawHuts(container, w, h, hw, hh, fill, stroke, highlight, location)
        break
    }

    // Location label
    const label = new Text({
      text: location.name,
      style: {
        fontFamily: 'JetBrains Mono Variable, monospace',
        fontSize: 9,
        fill: '#ffffff',
        align: 'center',
      },
    })
    label.anchor.set(0.5, 0)
    label.x = ((w - 1) * hw) / 2
    const maxHeight = this.getHeightForLocation(location, theme)
    label.y = -maxHeight - 14
    label.alpha = 0.5
    container.addChild(label)

    return container
  }

  private getHeightForLocation(loc: LocationDef, theme: MapTheme): number {
    if (theme.buildingStyle === 'brutalist') {
      if (loc.type === 'meeting_hall' || loc.id === 'town_hall') return 80
      if (loc.type === 'store' || loc.type === 'bar') return 65
      return 55 + Math.min(loc.width, loc.height) * 8
    }
    if (theme.buildingStyle === 'roman') {
      if (loc.id === 'town_hall') return 70
      return BASE_HEIGHT + 5
    }
    return BASE_HEIGHT
  }

  // ─── CASTAWAY ISLAND: Thatched huts with palm-leaf roofs ───
  private drawHuts(c: Container, w: number, h: number, hw: number, hh: number, fill: string, stroke: string, highlight: string, loc: LocationDef) {
    const g = new Graphics()
    const bw = w * hw
    const bh = h * hh
    const height = BASE_HEIGHT
    const roofPeak = height + 15

    // Stilts (bamboo poles)
    const stiltColor = '#6b5b3b'
    for (let i = 0; i < Math.min(w, 3); i++) {
      const sx = (i * bw / (w + 1)) - bw / 4
      g.moveTo(sx, 0)
      g.lineTo(sx, -height + 5)
      g.stroke({ color: stiltColor, width: 2, alpha: 0.8 })
    }

    // Front face — woven bamboo walls
    g.poly([
      0, -5,
      bw / 2, -bh / 2 - 5,
      bw / 2, -bh / 2 - height,
      0, -height,
    ])
    g.fill(fill)
    g.stroke({ color: stroke, width: 1 })

    // Horizontal bamboo lines
    for (let i = 1; i < 4; i++) {
      const yLine = -5 - (height - 5) * (i / 4)
      const yLineR = -bh / 2 - 5 - (height - bh / 2 - 5 + 5) * (i / 4)
      g.moveTo(0, yLine)
      g.lineTo(bw / 2, yLineR)
      g.stroke({ color: stroke, width: 0.5, alpha: 0.4 })
    }

    // Side face
    g.poly([
      0, -5,
      -bw / 2, -bh / 2 - 5,
      -bw / 2, -bh / 2 - height,
      0, -height,
    ])
    g.fill(highlight)
    g.stroke({ color: stroke, width: 1 })

    // Thatched roof — wider overhang, palm-leaf look
    const overhang = 6
    g.poly([
      -bw / 2 - overhang, -bh / 2 - height + 3,
      0, -roofPeak,
      bw / 2 + overhang, -bh / 2 - height + 3,
      0, -height + 3,
    ])
    g.fill('#7a8a3a')
    g.stroke({ color: '#5a6a2a', width: 1 })

    // Leaf texture lines on roof
    g.moveTo(-bw / 4, -bh / 4 - height + 3)
    g.lineTo(0, -roofPeak + 3)
    g.stroke({ color: '#6a7a2a', width: 1, alpha: 0.5 })
    g.moveTo(bw / 4, -bh / 4 - height + 3)
    g.lineTo(0, -roofPeak + 3)
    g.stroke({ color: '#6a7a2a', width: 1, alpha: 0.5 })

    // Door opening
    if (loc.type !== 'water_source') {
      g.rect(bw / 6, -15, 6, 10)
      g.fill('#3a2a1a')
    }

    c.addChild(g)
  }

  // ─── MATRIX: Wireframe data structures with code streams ───
  private drawWireframe(c: Container, w: number, h: number, hw: number, hh: number, loc: LocationDef) {
    const g = new Graphics()
    const bw = w * hw
    const bh = h * hh
    const color = '#00ff41'
    const dimColor = '#004400'
    const height = loc.id === 'town_hall' ? 60 : BASE_HEIGHT

    // Floor grid (base plane)
    g.poly([
      0, 0,
      bw / 2, -bh / 2,
      0, -bh,
      -bw / 2, -bh / 2,
    ])
    g.stroke({ color: dimColor, width: 1, alpha: 0.4 })

    // Inner floor grid
    const gridLines = Math.max(2, w)
    for (let i = 1; i < gridLines; i++) {
      const frac = i / gridLines
      // Horizontal lines
      const lx = frac * (-bw / 2)
      const ly = frac * (-bh / 2)
      g.moveTo(lx, ly)
      g.lineTo(lx + bw / 2, ly - bh / 2)
      g.stroke({ color: dimColor, width: 0.5, alpha: 0.3 })
    }

    // Vertical edges (data towers)
    const corners = [
      [0, 0],
      [bw / 2, -bh / 2],
      [0, -bh],
      [-bw / 2, -bh / 2],
    ]
    for (const [cx, cy] of corners) {
      g.moveTo(cx, cy)
      g.lineTo(cx, cy - height)
      g.stroke({ color, width: 1.5, alpha: 0.8 })

      // Node dot at top
      g.circle(cx, cy - height, 2)
      g.fill({ color, alpha: 0.9 })
    }

    // Top face wireframe
    g.poly([
      0, -height,
      bw / 2, -bh / 2 - height,
      0, -bh - height,
      -bw / 2, -bh / 2 - height,
    ])
    g.stroke({ color, width: 1, alpha: 0.6 })

    // Data stream lines (vertical code flow inside)
    const streams = Math.max(2, w)
    for (let i = 0; i < streams; i++) {
      const frac = (i + 0.5) / streams
      const sx = frac * (bw / 2) - bw / 4
      const sy = frac * (-bh / 2) - bh / 4 + bh / 4
      const segHeight = height * (0.3 + Math.random() * 0.5)
      const startY = sy - (height - segHeight) * Math.random()

      g.moveTo(sx, startY)
      g.lineTo(sx, startY - segHeight)
      g.stroke({ color, width: 0.5, alpha: 0.2 + Math.random() * 0.3 })
    }

    // Pulsing connection lines between top corners
    g.moveTo(0, -height)
    g.lineTo(bw / 2, -bh / 2 - height)
    g.stroke({ color, width: 0.5, alpha: 0.3 })
    g.moveTo(0, -height)
    g.lineTo(-bw / 2, -bh / 2 - height)
    g.stroke({ color, width: 0.5, alpha: 0.3 })

    c.addChild(g)
  }

  // ─── GLADIATOR: Colosseum arches, stone columns, arena walls ───
  private drawRoman(c: Container, w: number, h: number, hw: number, hh: number, fill: string, stroke: string, highlight: string, loc: LocationDef) {
    const g = new Graphics()
    const bw = w * hw
    const bh = h * hh
    const isTownHall = loc.id === 'town_hall'
    const height = isTownHall ? 70 : BASE_HEIGHT + 5

    if (isTownHall) {
      // ── COLOSSEUM ──
      // Outer wall — front
      g.poly([
        0, 0,
        bw / 2, -bh / 2,
        bw / 2, -bh / 2 - height,
        0, -height,
      ])
      g.fill(fill)
      g.stroke({ color: stroke, width: 1 })

      // Outer wall — side
      g.poly([
        0, 0,
        -bw / 2, -bh / 2,
        -bw / 2, -bh / 2 - height,
        0, -height,
      ])
      g.fill(highlight)
      g.stroke({ color: stroke, width: 1 })

      // Tiered arches on front (3 rows)
      const archRows = 3
      for (let row = 0; row < archRows; row++) {
        const archCount = Math.max(3, w + 1)
        const rowBase = height * (0.15 + row * 0.28)
        const archH = height * 0.2
        const archW = (bw / 2) / archCount

        for (let i = 0; i < archCount; i++) {
          const frac = (i + 0.5) / archCount
          const ax = frac * (bw / 2)
          const ay = frac * (-bh / 2) - rowBase

          // Arch shape (semicircle approximation)
          g.moveTo(ax - archW * 0.35, ay)
          g.lineTo(ax - archW * 0.35, ay - archH * 0.6)
          g.arcTo(ax, ay - archH, ax + archW * 0.35, ay - archH * 0.6, archW * 0.3)
          g.lineTo(ax + archW * 0.35, ay)
          g.stroke({ color: '#8a7050', width: 1, alpha: 0.7 })
          g.fill({ color: '#2a2010', alpha: 0.3 })
        }
      }

      // Top rim — crown of the colosseum
      g.poly([
        0, -height,
        bw / 2, -bh / 2 - height,
        0, -bh - height,
        -bw / 2, -bh / 2 - height,
      ])
      g.fill('#e8d8b0')
      g.stroke({ color: stroke, width: 2 })

      // Crenellations on top
      const crenels = 6
      for (let i = 0; i < crenels; i++) {
        const frac = (i + 0.5) / crenels
        const cx = frac * (bw / 2) - bw / 4
        const cy = frac * (-bh / 2) + bh / 4 - height - bh / 2
        g.rect(cx - 2, cy - 4, 4, 4)
        g.fill('#d4c4a0')
        g.stroke({ color: stroke, width: 0.5 })
      }

    } else {
      // ── Standard Roman building — stone with columns ──
      // Front face
      g.poly([
        0, 0,
        bw / 2, -bh / 2,
        bw / 2, -bh / 2 - height,
        0, -height,
      ])
      g.fill(fill)
      g.stroke({ color: stroke, width: 1 })

      // Side face
      g.poly([
        0, 0,
        -bw / 2, -bh / 2,
        -bw / 2, -bh / 2 - height,
        0, -height,
      ])
      g.fill(highlight)
      g.stroke({ color: stroke, width: 1 })

      // Top — terracotta roof
      g.poly([
        0, -height,
        bw / 2, -bh / 2 - height,
        0, -bh - height,
        -bw / 2, -bh / 2 - height,
      ])
      g.fill('#c4a070')
      g.stroke({ color: stroke, width: 1 })

      // Columns on front face
      const cols = Math.max(2, w + 1)
      for (let i = 0; i < cols; i++) {
        const frac = (i + 0.3) / (cols + 0.5)
        const cx = frac * (bw / 2)
        const cy = frac * (-bh / 2)

        // Column shaft
        g.moveTo(cx, cy)
        g.lineTo(cx, cy - height + 4)
        g.stroke({ color: '#c4b490', width: 3, alpha: 0.8 })

        // Capital (top decoration)
        g.rect(cx - 3, cy - height + 2, 6, 4)
        g.fill('#e0d0b0')

        // Base
        g.rect(cx - 2, cy - 2, 4, 3)
        g.fill('#c4b490')
      }

      // Arch between columns (if wide enough)
      if (w >= 2) {
        const ax = bw / 4
        const ay = -bh / 4 - height * 0.4
        g.moveTo(ax - 8, ay + 10)
        g.arcTo(ax, ay, ax + 8, ay + 10, 10)
        g.lineTo(ax + 8, ay + 10)
        g.stroke({ color: '#aa9060', width: 1.5, alpha: 0.6 })
      }
    }

    c.addChild(g)
  }

  // ─── SECTOR 7G: Brutalist towers, smokestacks, pipes ───
  private drawBrutalist(c: Container, w: number, h: number, hw: number, hh: number, fill: string, stroke: string, highlight: string, loc: LocationDef) {
    const g = new Graphics()
    const bw = w * hw
    const bh = h * hh

    // Taller buildings — varies by importance
    const isTownHall = loc.id === 'town_hall'
    const isStore = loc.type === 'store' || loc.type === 'bar'
    const height = isTownHall ? 80 : isStore ? 65 : 55 + Math.min(w, h) * 8

    // Front face — monolithic concrete
    g.poly([
      0, 0,
      bw / 2, -bh / 2,
      bw / 2, -bh / 2 - height,
      0, -height,
    ])
    g.fill(fill)
    g.stroke({ color: stroke, width: 1 })

    // Side face — darker shadow
    g.poly([
      0, 0,
      -bw / 2, -bh / 2,
      -bw / 2, -bh / 2 - height,
      0, -height,
    ])
    g.fill(highlight)
    g.stroke({ color: stroke, width: 1 })

    // Top
    g.poly([
      0, -height,
      bw / 2, -bh / 2 - height,
      0, -bh - height,
      -bw / 2, -bh / 2 - height,
    ])
    g.fill('#3a3a3a')
    g.stroke({ color: stroke, width: 1 })

    // Window grid on front — glowing orange
    const windowRows = Math.max(3, Math.floor(height / 18))
    const windowCols = Math.max(2, w)
    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        const frac = (col + 0.3) / (windowCols + 0.5)
        const xBase = frac * (bw / 2)
        const yOff = frac * (-bh / 2)
        const yBase = -(height * 0.12) - (row * (height * 0.8) / windowRows)

        // Some windows lit, some dark
        const lit = Math.random() > 0.3
        g.rect(xBase - 2, yBase + yOff - 2, 4, 5)
        g.fill({ color: lit ? '#ff6600' : '#1a1a1a', alpha: lit ? 0.5 : 0.3 })
      }
    }

    // Smokestack on town_hall / workshop
    if (isTownHall || loc.id === 'workshop') {
      const stackX = bw / 4
      const stackY = -bh / 4
      const stackH = 20

      g.rect(stackX - 3, stackY - height - stackH, 6, stackH)
      g.fill('#2a2a2a')
      g.stroke({ color: '#1a1a1a', width: 1 })

      // Smoke puffs
      g.circle(stackX, stackY - height - stackH - 5, 4)
      g.fill({ color: '#555555', alpha: 0.3 })
      g.circle(stackX - 3, stackY - height - stackH - 12, 5)
      g.fill({ color: '#555555', alpha: 0.2 })
      g.circle(stackX + 2, stackY - height - stackH - 18, 3)
      g.fill({ color: '#555555', alpha: 0.15 })
    }

    // Exposed pipes on side face
    if (w >= 2) {
      const pipeColor = '#5a3a2a'
      for (let i = 0; i < 2; i++) {
        const px = -(bw / 4) * (0.3 + i * 0.4)
        const py = -(bh / 4) * (0.3 + i * 0.4)
        g.moveTo(px, py)
        g.lineTo(px, py - height * 0.7)
        g.stroke({ color: pipeColor, width: 2, alpha: 0.6 })

        // Pipe joint
        g.circle(px, py - height * 0.35, 2)
        g.fill(pipeColor)
      }
    }

    // Antenna / spire on taller buildings
    if (height >= 65) {
      g.moveTo(0, -height - bh / 2)
      g.lineTo(0, -height - bh / 2 - 15)
      g.stroke({ color: '#5a5a5a', width: 1 })
      g.circle(0, -height - bh / 2 - 15, 1.5)
      g.fill({ color: '#ff3300', alpha: 0.8 })
    }

    c.addChild(g)
  }
}
