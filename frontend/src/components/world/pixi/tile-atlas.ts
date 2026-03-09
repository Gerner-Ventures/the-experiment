import { Texture } from 'pixi.js'
import type { MapTheme, TilePalette } from '@/types/world'
import { TILE_W, TILE_H } from './isometric-utils'

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

type FrameKey = (typeof TILE_TYPES)[number] | SpecialKey

/**
 * Build a programmatic tile atlas texture for a given map theme.
 * Each tile type is rendered as a 64×32 isometric diamond matching
 * the exact visual output of the old Graphics.poly() approach.
 *
 * Layout: tiles are arranged in a single row within the atlas canvas.
 */
export function buildThemeAtlas(theme: MapTheme): ThemeAtlas {
  const palette = theme.tilePalette
  const allKeys: FrameKey[] = [...TILE_TYPES]

  // Add special keys based on theme
  if (theme.id === 'matrix') allKeys.push('code_river')
  if (theme.id === 'lord-of-the-flies') {
    allKeys.push('water', 'sand_fence', 'crop_field')
  }

  const cols = allKeys.length
  const canvasW = cols * TILE_W
  const canvasH = TILE_H + 2 // +2 for stroke overflow

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!

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
  // Center of the diamond within this frame
  const cx = ox + hw
  const cy = oy + hh

  switch (key) {
    case 'code_river':
      drawDiamondCanvas(ctx, cx, cy, '#001100', '#003300', 0.5)
      // Glowing code stream lines
      for (let i = 0; i < 3; i++) {
        const offset = (i - 1) * 6
        ctx.beginPath()
        ctx.moveTo(cx + offset - 2, cy - hh + 2)
        ctx.lineTo(cx + offset + 2, cy + hh - 2)
        ctx.strokeStyle = '#00ff41'
        ctx.globalAlpha = 0.25 // Fixed alpha for atlas (no random)
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // Bright center glow
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#00ff41'
      ctx.globalAlpha = 0.06
      ctx.fill()
      ctx.globalAlpha = 1
      break

    case 'water':
      drawDiamondCanvas(ctx, cx, cy, '#e8d8b0', '#d0c090', 0.4)
      // Wave hints
      ctx.beginPath()
      ctx.moveTo(cx - 8, cy - 2)
      ctx.lineTo(cx + 8, cy - 2)
      ctx.strokeStyle = '#c0b888'
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 0.5
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
        ctx.moveTo(cx + i * 5 - 6, cy - 4)
        ctx.lineTo(cx + i * 5 + 6, cy + 4)
        ctx.strokeStyle = '#4a7a2a'
        ctx.globalAlpha = 0.3
        ctx.lineWidth = 1
        ctx.stroke()
      }
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
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = 1
}

function getTileColors(tileType: string, palette: TilePalette): [string, string] {
  const p = palette[tileType as keyof TilePalette]
  if (p) return [p[0], p[1]]
  return [palette.grass[0], palette.grass[1]]
}
