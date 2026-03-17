import { Texture } from 'pixi.js'
import type { MapTheme, TilePalette } from '@/types/world'
import { TILE_W, TILE_H } from './isometric-utils'
import { THEME_IDS } from './map-themes'

/**
 * Frame entry in the tile atlas — maps a tile type key to its
 * pixel position and size within the atlas texture.
 */
export interface AtlasFrame {
  x: number
  y: number
  w: number
  h: number
}

export interface ThemeAtlas {
  texture: Texture
  frames: Map<string, AtlasFrame>
}

/** All tile frame keys that get generated into the atlas. */
const TILE_TYPES = ['grass', 'path', 'building', 'fence', 'field'] as const

/** Special tile frame keys for theme-specific overrides. */
type SpecialKey = 'code_river' | 'water' | 'sand_fence' | 'crop_field'

/** Animated frame keys (ocean_0..3, code_river_0..3) */
type AnimatedKey = `ocean_${0 | 1 | 2 | 3}` | `code_river_${0 | 1 | 2 | 3}`

type FrameKey = (typeof TILE_TYPES)[number] | SpecialKey | AnimatedKey

/**
 * Build a programmatic tile atlas texture for a given map theme.
 * Each tile type is rendered as a 128×64 isometric diamond.
 * Detail offsets use S = TILE_W/64 so they auto-scale with tile size.
 *
 * Layout: tiles are arranged in a single row within the atlas canvas.
 */
export function buildThemeAtlas(theme: MapTheme): ThemeAtlas {
  const palette = theme.tilePalette
  const allKeys: FrameKey[] = [...TILE_TYPES]

  // Add special keys based on theme
  if (theme.id === THEME_IDS.MATRIX) {
    allKeys.push('code_river')
    // Animated code river frames
    allKeys.push('code_river_0', 'code_river_1', 'code_river_2', 'code_river_3')
  }
  if (theme.id === THEME_IDS.LORD_OF_THE_FLIES) {
    allKeys.push('water', 'sand_fence', 'crop_field')
    // Animated ocean frames
    allKeys.push('ocean_0', 'ocean_1', 'ocean_2', 'ocean_3')
  }

  const cols = allKeys.length
  const canvasW = cols * TILE_W
  const canvasH = TILE_H + 2 // +2 for stroke overflow

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('[tile-atlas] Failed to create 2D canvas context — OffscreenCanvas or canvas element unavailable')
  }

  const frames = new Map<string, AtlasFrame>()

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i]
    const ox = i * TILE_W
    const oy = 1 // 1px top padding for stroke

    drawTileFrame(ctx, ox, oy, key, palette)
    frames.set(key, { x: ox, y: 0, w: TILE_W, h: TILE_H + 2 })
  }

  const texture = Texture.from(canvas)
  return { texture, frames }
}

/** Draw a single isometric diamond tile frame at (ox, oy) in the atlas canvas. */
function drawTileFrame(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  key: FrameKey,
  palette: TilePalette,
) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  // Scale factor for detail offsets — future-proofs for other tile sizes
  const S = TILE_W / 64
  // Center of the diamond within this frame
  const cx = ox + hw
  const cy = oy + hh

  switch (key) {
    case 'code_river':
    case 'code_river_0':
    case 'code_river_1':
    case 'code_river_2':
    case 'code_river_3': {
      const crFrame = key === 'code_river' ? 0 : parseInt(key.slice(-1), 10)

      // Pulsing background glow — gradient shifts per frame
      const bgColors = ['#001200', '#001400', '#001600', '#001400']
      drawDiamondCanvas(ctx, cx, cy, bgColors[crFrame], '#003300', 0.3)

      // Clip to diamond
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(cx, cy - hh)
      ctx.lineTo(cx + hw, cy)
      ctx.lineTo(cx, cy + hh)
      ctx.lineTo(cx - hw, cy)
      ctx.closePath()
      ctx.clip()

      // Column-based falling character blocks — Matrix rain style
      // Columns run vertically through the diamond, spaced ~5S apart
      const colSpacing = 5 * S
      const blockH = 3 * S       // character block height
      const blockW = 2.5 * S     // character block width
      const blockGap = 4 * S     // vertical gap between blocks
      const totalStep = blockH + blockGap  // distance per "cell"
      const dropPerFrame = totalStep * 0.25 // how far the column drops each frame

      // Each column has a deterministic stagger so they don't fall in sync
      const colStagger = [0, 0.6, 0.25, 0.8, 0.15, 0.5, 0.35, 0.7, 0.45, 0.9]
      // Which cells in each column are "lit" (deterministic gap pattern)
      const litPatterns = [
        [1, 0, 1, 1, 0, 1, 0, 1],
        [0, 1, 1, 0, 1, 0, 1, 1],
        [1, 1, 0, 1, 0, 1, 1, 0],
        [0, 1, 0, 1, 1, 0, 1, 1],
        [1, 0, 1, 0, 1, 1, 0, 1],
        [1, 1, 1, 0, 0, 1, 0, 1],
        [0, 1, 1, 1, 0, 1, 1, 0],
        [1, 0, 0, 1, 1, 0, 1, 1],
        [0, 1, 1, 0, 1, 1, 0, 1],
        [1, 1, 0, 1, 1, 0, 1, 0],
      ]
      // Brightness gradient: head is brightest, trail fades
      const headColor = '#aaffaa'  // near-white green
      const brightColor = '#00ff41'
      const midColor = '#00cc33'
      const dimColor = '#009922'
      const fadeColor = '#004411'

      const diamondTop = cy - hh
      const diamondBottom = cy + hh
      const visibleHeight = diamondBottom - diamondTop

      for (let col = -2; col <= 2; col++) {
        const colX = cx + col * colSpacing
        const colIdx = (col + 5) % colStagger.length
        const stagger = colStagger[colIdx]
        const pattern = litPatterns[colIdx]

        // Head position advances downward per frame, with stagger
        const headY = diamondTop + ((crFrame * dropPerFrame + stagger * visibleHeight) % (visibleHeight + totalStep * 2))

        // Draw blocks in this column
        for (let cell = -3; cell <= 8; cell++) {
          const cellY = headY - cell * totalStep
          if (cellY < diamondTop - totalStep || cellY > diamondBottom + totalStep) continue

          // Skip gaps based on pattern
          const patIdx = ((cell % pattern.length) + pattern.length) % pattern.length
          if (!pattern[patIdx]) continue

          // Distance from head determines brightness
          let alpha: number
          let color: string
          if (cell === 0) {
            color = headColor; alpha = 0.75
          } else if (cell === 1) {
            color = brightColor; alpha = 0.50
          } else if (cell <= 3) {
            color = midColor; alpha = 0.30
          } else if (cell <= 5) {
            color = dimColor; alpha = 0.15
          } else {
            color = fadeColor; alpha = 0.06
          }

          ctx.fillStyle = color
          ctx.globalAlpha = alpha
          ctx.fillRect(colX - blockW / 2, cellY, blockW, blockH)
        }
      }

      // CRT scan lines — faint horizontal lines for "screen" quality
      for (let sy = diamondTop; sy < diamondBottom; sy += 4 * S) {
        ctx.beginPath()
        ctx.moveTo(cx - hw, sy)
        ctx.lineTo(cx + hw, sy)
        ctx.strokeStyle = '#00ff41'
        ctx.globalAlpha = 0.03
        ctx.lineWidth = 0.5 * S
        ctx.stroke()
      }

      // Subtle vertical column guides — dim green lines behind the data
      for (let col = -2; col <= 2; col++) {
        const colX = cx + col * colSpacing
        ctx.beginPath()
        ctx.moveTo(colX, diamondTop)
        ctx.lineTo(colX, diamondBottom)
        ctx.strokeStyle = '#00ff41'
        ctx.globalAlpha = 0.04
        ctx.lineWidth = 0.5 * S
        ctx.stroke()
      }

      ctx.restore()
      ctx.globalAlpha = 1
      break
    }

    case 'water':
      drawDiamondCanvas(ctx, cx, cy, '#e8d8b0', '#d0c090', 0.4)
      // Wave hints
      ctx.beginPath()
      ctx.moveTo(cx - 8 * S, cy - 2 * S)
      ctx.lineTo(cx + 8 * S, cy - 2 * S)
      ctx.strokeStyle = '#c0b888'
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 0.5 * S
      ctx.stroke()
      ctx.globalAlpha = 1
      break

    case 'sand_fence':
      drawDiamondCanvas(ctx, cx, cy, '#e8d8b0', '#d0c8a0', 0.3)
      break

    case 'crop_field': {
      const [fill, stroke] = getTileColors('field', palette)
      drawDiamondCanvas(ctx, cx, cy, fill, stroke, 0.3)
      // Crop lines
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(cx + i * 5 * S - 6 * S, cy - 4 * S)
        ctx.lineTo(cx + i * 5 * S + 6 * S, cy + 4 * S)
        ctx.strokeStyle = '#4a7a2a'
        ctx.globalAlpha = 0.3
        ctx.lineWidth = S
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      break
    }

    case 'ocean_0':
    case 'ocean_1':
    case 'ocean_2':
    case 'ocean_3': {
      const oceanFrame = parseInt(key.slice(-1), 10)

      // Base color cycles subtly (ping-pong: 0→1→2→1)
      const baseColors = ['#1a6b8a', '#1c6d8c', '#1e6f8e', '#1c6d8c']
      drawDiamondCanvas(ctx, cx, cy, baseColors[oceanFrame], '#1a5b7a', 0.2)

      // Clip all detail drawing to the diamond shape
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(cx, cy - hh)
      ctx.lineTo(cx + hw, cy)
      ctx.lineTo(cx, cy + hh)
      ctx.lineTo(cx - hw, cy)
      ctx.closePath()
      ctx.clip()

      // Layer 1 — deep wave crests running NE-SW (diagonal along diamond edge)
      // 3 crests spaced 10S apart, shifting 2.5S per frame along SE direction
      const waveSpacing1 = 10 * S
      const waveShift1 = oceanFrame * 2.5 * S
      for (let i = -2; i <= 2; i++) {
        // Wave runs parallel to the NE-SW diamond edge
        const baseOffset = i * waveSpacing1 + waveShift1
        const x0 = cx - hw + baseOffset * 0.5
        const y0 = cy - hh / 2 + baseOffset * 0.25
        const x1 = cx + baseOffset * 0.5
        const y1 = cy + hh / 2 + baseOffset * 0.25

        ctx.beginPath()
        ctx.moveTo(x0, y0)
        // Gentle curve for organic wave shape
        const midX = (x0 + x1) / 2
        const midY = (y0 + y1) / 2
        ctx.quadraticCurveTo(midX + 2 * S, midY - 1.5 * S, x1, y1)
        ctx.strokeStyle = '#3a9aba'
        ctx.globalAlpha = 0.18
        ctx.lineWidth = 1.2 * S
        ctx.stroke()
      }

      // Layer 2 — surface wave crests running NW-SE (counter-scroll for depth)
      const waveShift2 = oceanFrame * -2 * S // opposite direction
      for (let i = -2; i <= 2; i++) {
        const baseOffset = i * 9 * S + waveShift2
        const x0 = cx + hw / 2 + baseOffset * 0.5
        const y0 = cy - hh / 2 + baseOffset * -0.25
        const x1 = cx - hw / 2 + baseOffset * 0.5
        const y1 = cy + hh / 2 + baseOffset * -0.25

        ctx.beginPath()
        ctx.moveTo(x0, y0)
        const midX = (x0 + x1) / 2
        const midY = (y0 + y1) / 2
        ctx.quadraticCurveTo(midX - 1.5 * S, midY + S, x1, y1)
        ctx.strokeStyle = '#4ab0cc'
        ctx.globalAlpha = 0.10
        ctx.lineWidth = 0.8 * S
        ctx.stroke()
      }

      // Specular highlights — small bright dots that jump positions per frame
      const sparklePositions = [
        [[-6, -2], [4, 3], [-2, 1]],    // frame 0
        [[4, 1], [-8, -1], [7, -2]],     // frame 1
        [[-2, 3], [6, -3], [-5, 0]],     // frame 2
        [[7, -2], [-3, 2], [3, -1]],     // frame 3
      ]
      const sparkleAlphas = [0.10, 0.14, 0.08, 0.12]
      for (const [sx, sy] of sparklePositions[oceanFrame]) {
        ctx.beginPath()
        ctx.arc(cx + sx * S, cy + sy * S, 1.5 * S, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.globalAlpha = sparkleAlphas[oceanFrame]
        ctx.fill()
      }

      // Subtle foam wisps — short curved strokes near diamond edges
      const foamPhase = oceanFrame * 0.25
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3 + foamPhase) * Math.PI * 2
        const fDist = (hw * 0.55 + Math.sin(angle * 2) * 3 * S)
        const fx = cx + Math.cos(angle) * fDist * 0.6
        const fy = cy + Math.sin(angle) * fDist * 0.35
        ctx.beginPath()
        ctx.arc(fx, fy, 2 * S, angle - 0.5, angle + 0.5)
        ctx.strokeStyle = '#ffffff'
        ctx.globalAlpha = 0.06 + (i === oceanFrame % 3 ? 0.04 : 0)
        ctx.lineWidth = S
        ctx.stroke()
      }

      ctx.restore()
      ctx.globalAlpha = 1
      break
    }

    default: {
      // Standard tile types: grass, path, building, fence, field
      const [fill, stroke] = getTileColors(key, palette)
      drawDiamondCanvas(ctx, cx, cy, fill, stroke, 0.3)
      break
    }
  }
}

/** Draw an isometric diamond on a canvas 2D context. */
function drawDiamondCanvas(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  fill: string,
  stroke: string,
  strokeAlpha: number,
) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  const S = TILE_W / 64

  ctx.beginPath()
  ctx.moveTo(cx, cy - hh)        // top
  ctx.lineTo(cx + hw, cy)        // right
  ctx.lineTo(cx, cy + hh)        // bottom
  ctx.lineTo(cx - hw, cy)        // left
  ctx.closePath()

  ctx.fillStyle = fill
  ctx.globalAlpha = 1
  ctx.fill()

  ctx.strokeStyle = stroke
  ctx.globalAlpha = strokeAlpha
  ctx.lineWidth = S
  ctx.stroke()
  ctx.globalAlpha = 1
}

function getTileColors(tileType: string, palette: TilePalette): [string, string] {
  const p = palette[tileType as keyof TilePalette]
  if (p) return [p[0], p[1]]
  console.warn(`[tile-atlas] Unknown tile type "${tileType}", falling back to grass palette`)
  return [palette.grass[0], palette.grass[1]]
}
