import type { FullPalette, PixelGrid, StatusEffect } from './types'
import { darken } from './palette'
import { px, rc } from './grid-helpers'
import { HEAD_CX, HEAD_Y, EYE_Y, MOUTH_Y, TORSO_Y, TORSO_CX, TORSO_W } from './body-regions'

/** Simple seeded pseudo-random (deterministic per character) */
function seededRand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s >> 16) / 32768
  }
}

/**
 * Draw all active status overlays onto the sprite grid.
 * Called after base character render, before final output.
 * Overlays stack — a character can be bleeding + bruised + bandaged simultaneously.
 */
export function drawStatusOverlays(
  g: PixelGrid,
  c: FullPalette,
  statuses: StatusEffect[],
): void {
  for (const status of statuses) {
    const rand = seededRand(status.seed ?? 42)

    switch (status.type) {
      case 'bleeding': {
        // Red drip from wound site on torso
        const wx = TORSO_CX + Math.floor(rand() * 6 - 3)
        const wy = TORSO_Y + Math.floor(rand() * 4)
        px(g, wx, wy, '#cc2222')
        px(g, wx, wy + 1, '#aa1111')
        px(g, wx, wy + 2, '#881111')
        // Blood trail down
        px(g, wx, wy + 3, '#661111')
        px(g, wx, wy + 4, '#551111')
        // Small blood pool at feet
        const poolY = 38
        rc(g, wx - 1, poolY, 3, 1, '#440808')
        px(g, wx, poolY + 1, '#330606')
        break
      }

      case 'bruised': {
        // Black eye — dark purple patch around one eye
        const side = rand() > 0.5 ? 1 : -1
        const ex = HEAD_CX + side * 3
        const ey = EYE_Y
        px(g, ex - 1, ey - 1, '#4a2255')
        px(g, ex, ey - 1, '#3d1a48')
        px(g, ex + 1, ey - 1, '#4a2255')
        px(g, ex - 1, ey, '#5a2a66')
        px(g, ex + 1, ey, '#5a2a66')
        px(g, ex, ey + 1, '#4a2255')
        // Optional swollen lip
        if (rand() > 0.5) {
          px(g, HEAD_CX, MOUTH_Y + 1, '#884455')
        }
        break
      }

      case 'shot_wound': {
        // Small dark red circle on torso with blood splatter
        const sx = TORSO_CX + Math.floor(rand() * 4 - 2)
        const sy = TORSO_Y + Math.floor(rand() * 3 + 1)
        // Wound center
        px(g, sx, sy, '#550000')
        // Blood ring
        px(g, sx - 1, sy, '#882222'); px(g, sx + 1, sy, '#882222')
        px(g, sx, sy - 1, '#882222'); px(g, sx, sy + 1, '#882222')
        // Splatter
        px(g, sx - 2, sy - 1, '#661111')
        px(g, sx + 2, sy + 1, '#661111')
        px(g, sx + 1, sy - 2, '#551111')
        break
      }

      case 'burned': {
        // Soot/char on skin edges + flame particles
        const bx = TORSO_CX
        // Char marks on body edges
        px(g, bx - 4, TORSO_Y + 1, '#333322')
        px(g, bx + 4, TORSO_Y + 2, '#333322')
        px(g, bx - 3, TORSO_Y + 4, '#444433')
        px(g, bx + 3, TORSO_Y, '#444433')
        // Singed hair tips
        px(g, HEAD_CX - 2, HEAD_Y, darken(c.hr, 40))
        px(g, HEAD_CX + 2, HEAD_Y, darken(c.hr, 40))
        // Flame particles around body
        px(g, bx - 3, TORSO_Y - 1, '#ff6622')
        px(g, bx + 4, TORSO_Y - 2, '#ffaa22')
        px(g, bx - 2, TORSO_Y + 5, '#ff4422')
        px(g, bx + 3, TORSO_Y + 4, '#ffff44')
        // Smoke wisps above head
        px(g, HEAD_CX - 1, HEAD_Y - 2, '#888888')
        px(g, HEAD_CX + 1, HEAD_Y - 3, '#777777')
        break
      }

      case 'poisoned': {
        // Green tint on skin + green sweat drops
        // Green sweat drops from face
        px(g, HEAD_CX - 4, EYE_Y + 1, '#44aa44')
        px(g, HEAD_CX - 4, EYE_Y + 2, '#338822')
        px(g, HEAD_CX + 5, EYE_Y, '#44aa44')
        // Green tinge on exposed skin
        px(g, HEAD_CX - 3, EYE_Y + 3, '#669966')
        px(g, HEAD_CX + 4, EYE_Y + 3, '#669966')
        // Nausea bubbles
        px(g, HEAD_CX + 3, MOUTH_Y + 1, '#66cc66')
        px(g, HEAD_CX + 4, MOUTH_Y, '#44aa44')
        break
      }

      case 'crying': {
        // Tear streaks from eyes to chin
        const lx = HEAD_CX - 3, rx = HEAD_CX + 3
        // Left tear streak
        px(g, lx, EYE_Y + 1, '#6688cc')
        px(g, lx, EYE_Y + 2, '#6688cc')
        px(g, lx, EYE_Y + 3, '#5577bb')
        px(g, lx, EYE_Y + 4, '#5577bb')
        px(g, lx, EYE_Y + 5, '#4466aa')
        // Right tear streak
        px(g, rx, EYE_Y + 1, '#6688cc')
        px(g, rx, EYE_Y + 2, '#6688cc')
        px(g, rx, EYE_Y + 3, '#5577bb')
        px(g, rx, EYE_Y + 4, '#5577bb')
        px(g, rx, EYE_Y + 5, '#4466aa')
        // Puffy red eye tint
        px(g, lx + 1, EYE_Y - 1, '#cc8888')
        px(g, rx - 1, EYE_Y - 1, '#cc8888')
        break
      }

      case 'bandaged': {
        // White wraps on torso or head
        const onHead = rand() > 0.5
        if (onHead) {
          // Head bandage wrap
          rc(g, HEAD_CX - 4, HEAD_Y + 2, 9, 1, '#eeeeee')
          rc(g, HEAD_CX - 4, HEAD_Y + 3, 9, 1, '#dddddd')
          // Cross
          px(g, HEAD_CX, HEAD_Y + 2, '#cc3333')
        } else {
          // Torso bandage
          rc(g, TORSO_CX - 4, TORSO_Y + 2, TORSO_W - 1, 1, '#eeeeee')
          rc(g, TORSO_CX - 4, TORSO_Y + 3, TORSO_W - 1, 1, '#dddddd')
          rc(g, TORSO_CX - 4, TORSO_Y + 4, TORSO_W - 1, 1, '#eeeeee')
          // Red cross
          px(g, TORSO_CX, TORSO_Y + 2, '#cc3333')
          px(g, TORSO_CX, TORSO_Y + 3, '#cc3333')
          px(g, TORSO_CX, TORSO_Y + 4, '#cc3333')
          px(g, TORSO_CX - 1, TORSO_Y + 3, '#cc3333')
          px(g, TORSO_CX + 1, TORSO_Y + 3, '#cc3333')
        }
        break
      }

      case 'stunned': {
        // Dizzy stars orbiting head + swirl eyes
        px(g, HEAD_CX - 3, HEAD_Y - 2, '#ffff44')
        px(g, HEAD_CX + 4, HEAD_Y - 3, '#ffff44')
        px(g, HEAD_CX, HEAD_Y - 4, '#ffaa22')
        px(g, HEAD_CX + 6, HEAD_Y - 1, '#ffaa22')
        px(g, HEAD_CX - 5, HEAD_Y - 1, '#ffff44')
        break
      }

      case 'knocked_down': {
        // Additional dust/impact marks on ground
        px(g, HEAD_CX - 4, 39, '#887766')
        px(g, HEAD_CX + 5, 38, '#887766')
        px(g, HEAD_CX - 2, 40, '#776655')
        break
      }
    }
  }
}
