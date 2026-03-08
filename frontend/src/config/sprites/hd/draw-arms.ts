import type { FullPalette, PixelGrid, ArmPose, HandPosition } from './types'
import { px, rc } from './grid-helpers'

// ─── Arm Renderer ───

export function drawArm(
  g: PixelGrid,
  c: FullPalette,
  shoulder: { x: number; y: number },
  side: 'L' | 'R',
  pose: ArmPose,
): HandPosition {
  const L = side === 'L'
  const sx = shoulder.x
  const sy = shoulder.y

  let ux: number, uy: number
  let fx: number, fy: number
  let hx: number, hy: number

  switch (pose) {
    case 'down':
      ux = sx + (L ? -3 : 1); uy = sy
      fx = ux; fy = uy + 5
      hx = ux; hy = uy + 9
      break
    case 'back':
      ux = sx + (L ? -2 : 0); uy = sy - 1
      fx = ux + (L ? 1 : -1); fy = uy + 4
      hx = fx + (L ? 1 : -1); hy = fy + 3
      break
    case 'fwd':
      ux = sx + (L ? -4 : 2); uy = sy
      fx = ux + (L ? -1 : 1); fy = uy + 4
      hx = fx + (L ? -1 : 1); hy = fy + 3
      break
    case 'up':
      ux = sx + (L ? -3 : 1); uy = sy - 6
      fx = ux + (L ? -1 : 1); fy = uy - 3
      hx = fx; hy = fy - 2
      break
    case 'diag':
      ux = sx + (L ? -4 : 2); uy = sy - 3
      fx = ux + (L ? -2 : 2); fy = uy - 2
      hx = fx + (L ? -1 : 1); hy = fy - 2
      break
    case 'punch':
      ux = sx + (L ? -4 : 2); uy = sy
      fx = ux + (L ? -4 : 4); fy = sy - 1
      hx = fx + (L ? -3 : 3); hy = sy - 1
      break
    case 'uppercut':
      ux = sx + (L ? -3 : 1); uy = sy - 2
      fx = ux + (L ? -2 : 2); fy = uy - 4
      hx = fx + (L ? -1 : 1); hy = fy - 2
      break
    case 'hold':
      ux = sx + (L ? -3 : 1); uy = sy - 2
      fx = ux; fy = uy + 4
      hx = fx + (L ? 1 : -1); hy = fy + 2
      break
    case 'reach':
      ux = sx + (L ? -4 : 2); uy = sy + 1
      fx = ux + (L ? -2 : 2); fy = uy + 4
      hx = fx + (L ? -1 : 1); hy = fy + 3
      break
    case 'clasped':
      ux = sx + (L ? -2 : 0); uy = sy + 2
      fx = ux + (L ? 2 : -2); fy = uy + 4
      hx = fx + (L ? 1 : -1); hy = fy + 2
      break
    case 'spread':
      ux = sx + (L ? -5 : 3); uy = sy - 1
      fx = ux + (L ? -2 : 2); fy = uy + 2
      hx = fx + (L ? -1 : 1); hy = fy + 2
      break
    default:
      // fallback to down
      ux = sx + (L ? -3 : 1); uy = sy
      fx = ux; fy = uy + 5
      hx = ux; hy = uy + 9
  }

  // Upper arm with 3D shading
  rc(g, ux, uy, 3, 5, c.o1)
  rc(g, L ? ux : ux + 2, uy, 1, 5, c.os)
  px(g, L ? ux + 2 : ux, uy + 1, c.oh)

  // Forearm with 3D
  rc(g, fx, fy, 3, 4, c.sk)
  rc(g, L ? fx : fx + 2, fy, 1, 4, c.ss)
  px(g, L ? fx + 2 : fx, fy + 1, c.sh)

  // Hand
  rc(g, hx, hy, 3, 2, c.sk)
  rc(g, hx, hy + 1, 3, 1, c.ss)

  // Shoulder bridge
  px(g, L ? sx - 1 : sx + 1, sy + 1, c.o1)

  // AO at armpit
  px(g, sx, sy + 2, c.ao)

  return { hx, hy }
}
