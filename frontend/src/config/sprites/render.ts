import type { CharacterSprite, PoseName } from './types'
import { GRID_W, GRID_H, SPRITE_W, SPRITE_H, PIXEL_SCALE, HAIR_ROW_END, OUTFIT_ROW_START } from './constants'
import { paletteMap } from './palettes'
import { BODIES } from './bodies'
import { HAIRS } from './hairs'
import { OUTFITS } from './outfits'
import { ACCESSORIES } from './accessories'
import { POSES } from './poses'

export function renderCharacter(sprite: CharacterSprite, pose: PoseName = 'idle'): (string | null)[][] {
  const pm = paletteMap(sprite.palette)
  const body = [...(BODIES[sprite.body] ?? BODIES[0])]
  const hair = HAIRS[sprite.hair] ?? HAIRS[0]
  const outfit = OUTFITS[sprite.outfit] ?? []
  const accessory = ACCESSORIES[sprite.accessory] ?? []
  const poseDef = POSES[pose] ?? POSES.idle

  // Apply pose body overrides
  for (const [rowIdx, rowData] of poseDef.bodyOverrides) {
    if (rowIdx < body.length) {
      body[rowIdx] = rowData
    }
  }

  // Start with empty grid
  const result: (string | null)[][] = Array.from({ length: GRID_H }, () =>
    Array.from({ length: GRID_W }, () => null)
  )

  // Layer 1: body
  for (let y = 0; y < GRID_H; y++) {
    const row = body[y]
    if (!row) continue
    for (let x = 0; x < GRID_W; x++) {
      const ch = row[x]
      if (ch && ch !== '0' && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  // Layer 2: hair (rows 0..HAIR_ROW_END)
  for (let y = 0; y < hair.length && y <= HAIR_ROW_END; y++) {
    const row = hair[y]
    if (!row) continue
    for (let x = 0; x < GRID_W; x++) {
      const ch = row[x]
      if (ch && ch !== '0' && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  // Layer 3: outfit (rows OUTFIT_ROW_START..end)
  for (let oy = 0; oy < outfit.length; oy++) {
    const row = outfit[oy]
    if (!row) continue
    const y = OUTFIT_ROW_START + oy
    if (y >= GRID_H) break
    for (let x = 0; x < GRID_W; x++) {
      const ch = row[x]
      if (ch && ch !== '0' && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  // Layer 4: accessories (pixel overrides)
  for (const [x, y, ch] of accessory) {
    if (y < GRID_H && x < GRID_W && pm[ch]) {
      result[y][x] = pm[ch]
    }
  }

  // Layer 5: pose pixel overrides (effects like streams, splatter, Z's)
  if (poseDef.pixelOverrides) {
    for (const [x, y, ch] of poseDef.pixelOverrides) {
      if (y < GRID_H && x < GRID_W && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  return result
}

/**
 * Render a character sprite to an offscreen canvas.
 * Reusable across PixiJS textures, SVG data URLs, and Vue canvas components.
 */
export function renderSpriteToCanvas(sprite: CharacterSprite, pose: PoseName = 'idle', scale = PIXEL_SCALE): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_W * scale
  canvas.height = SPRITE_H * scale
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const grid = renderCharacter(sprite, pose)
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const color = grid[y][x]
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
    }
  }

  return canvas
}
