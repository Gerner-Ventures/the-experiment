import type { HDCharacterDef, HDPoseName, PixelGrid, StatusEffect } from './types'
import { HD_GRID_W, HD_GRID_H, HD_PIXEL_SCALE } from './constants'
import { getHDSpriteById } from './characters'
import { deriveFullPalette, mixColors } from './palette'
import { POSE_REGISTRY } from './poses'
import { drawHead } from './draw-head'
import { drawNeck, drawTorso } from './draw-torso'
import { drawArm } from './draw-arms'
import { drawLegs } from './draw-legs'
import { drawHair, drawMustache, drawHat } from './draw-hair'
import { drawProp, drawGroundShadow } from './props'
import { drawStatusOverlays } from './status-overlays'

/**
 * Render an HD sprite to a pixel grid (32×48).
 * This is the core composable pipeline — body part renderers are independent modules.
 */
export function renderHDSpriteGrid(
  character: HDCharacterDef,
  poseName: HDPoseName,
  statuses: StatusEffect[] = [],
): PixelGrid {
  const g: PixelGrid = Array.from({ length: HD_GRID_H }, () => Array(HD_GRID_W).fill(null))
  const c = deriveFullPalette(character.basePalette)
  const pose = POSE_REGISTRY[poseName]
  const small = character.bodyType === 'small'

  // Apply rosy cheeks if character has them
  if (character.rosyCheeks) {
    c.ch = mixColors(character.basePalette.skin, '#ff6688', 0.45)
  }

  const { dynamics } = pose

  // 1. Head (includes eyes, mouth, ears, nose)
  const { headX, headY, headW, headH } = drawHead(g, c, pose.face, dynamics, small)

  // 2. Hair (renders over head)
  drawHair(g, c, headX, headY, headW, headH, character.hairStyle)

  // 3. Accessories: hat
  if (character.accessories.hat) {
    drawHat(g, c, headX, headY, headW, character.accessories.hat, character.accessories.hatColor)
  }

  // 4. Accessories: mustache
  if (character.accessories.mustache) {
    const mouthY = headY + 10
    drawMustache(g, c, headX, mouthY, character.accessories.mustache)
  }

  // 5. Neck
  const headBottom = headY + headH
  drawNeck(g, c, dynamics, headBottom)

  // 6. Torso
  const neckBottom = headBottom + 3
  const { tX, tH, shoulders } = drawTorso(g, c, dynamics, neckBottom, small)

  // 7. Arms
  drawArm(g, c, shoulders.left, 'L', pose.leftArm)
  const rightHand = drawArm(g, c, shoulders.right, 'R', pose.rightArm)

  // 8. Legs
  const legY = neckBottom + tH
  drawLegs(g, c, tX, legY, pose.leftLeg, pose.rightLeg)

  // 9. Ground shadow
  drawGroundShadow(g, legY + 10, dynamics.lean)

  // 10. Prop (uses right hand position)
  if (pose.prop) {
    drawProp(g, c, pose.prop, rightHand)
  }

  // 11. Effect (also uses right hand position for positioning)
  if (pose.effect) {
    drawProp(g, c, pose.effect, rightHand)
  }

  // 12. Status overlays (bleeding, bruised, bandaged, etc.)
  if (statuses.length > 0) {
    drawStatusOverlays(g, c, statuses)
  }

  return g
}

/**
 * Render an HD sprite to an offscreen canvas.
 * Returns an HTMLCanvasElement ready for PixiJS Texture.from().
 */
export function renderHDSpriteToCanvas(
  character: HDCharacterDef,
  poseName: HDPoseName,
  scale = HD_PIXEL_SCALE,
  statuses: StatusEffect[] = [],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = HD_GRID_W * scale
  canvas.height = HD_GRID_H * scale
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const grid = renderHDSpriteGrid(character, poseName, statuses)

  for (let y = 0; y < HD_GRID_H; y++) {
    for (let x = 0; x < HD_GRID_W; x++) {
      const color = grid[y][x]
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
    }
  }

  return canvas
}

// ─── Backward-compatible wrappers ───

/**
 * Render a character by id to a pixel grid.
 * @deprecated Use renderHDSpriteGrid with HDCharacterDef instead.
 */
export function renderCharacter(charOrId: { id: string }, pose: string = 'idle'): PixelGrid {
  const hd = getHDSpriteById(charOrId.id)
  if (!hd) return Array.from({ length: HD_GRID_H }, () => Array(HD_GRID_W).fill(null))
  return renderHDSpriteGrid(hd, pose as HDPoseName)
}

/**
 * Render a character by id to a canvas.
 * @deprecated Use renderHDSpriteToCanvas with HDCharacterDef instead.
 */
export function renderSpriteToCanvas(charOrId: { id: string }, pose: string = 'idle', scale = HD_PIXEL_SCALE): HTMLCanvasElement {
  const hd = getHDSpriteById(charOrId.id)
  if (!hd) {
    const canvas = document.createElement('canvas')
    canvas.width = HD_GRID_W * scale
    canvas.height = HD_GRID_H * scale
    return canvas
  }
  return renderHDSpriteToCanvas(hd, pose as HDPoseName, scale)
}
