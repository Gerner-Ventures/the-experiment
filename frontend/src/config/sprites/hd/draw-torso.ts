import type { FullPalette, PixelGrid, BodyDynamics, ShoulderPoints } from './types'
import { mixColors } from './palette'
import { px, rc } from './grid-helpers'

// ─── Neck ───

export function drawNeck(
  g: PixelGrid,
  c: FullPalette,
  dynamics: BodyDynamics,
  headBottom: number,
): void {
  const neckY = headBottom + 1
  rc(g, 14 + dynamics.lean, neckY, 4, 2, c.sk)
  rc(g, 14 + dynamics.lean, neckY, 1, 2, c.ss)
  // Neck AO
  px(g, 13 + dynamics.lean, neckY, c.ao2)
  px(g, 18 + dynamics.lean, neckY, c.ao2)
}

// ─── Torso ───

export function drawTorso(
  g: PixelGrid,
  c: FullPalette,
  dynamics: BodyDynamics,
  neckBottom: number,
  small: boolean,
): { tX: number; tY: number; tW: number; tH: number; shoulders: ShoulderPoints } {
  const tX = 10 + dynamics.lean
  const tY = neckBottom
  const tW = small ? 10 : 12
  const tH = (small ? 8 : 11) + dynamics.squash

  // Base fill
  rc(g, tX, tY, tW, tH, c.o1)

  // 3D shading
  rc(g, tX, tY, 2, tH, c.os)
  rc(g, tX + 2, tY, 1, tH, c.od)
  rc(g, tX, tY + tH - 2, tW, 2, c.os)
  rc(g, tX + tW - 3, tY + 1, 2, tH - 4, c.oh)
  rc(g, tX + tW - 1, tY + 1, 1, tH - 2, c.orim)

  // Collar
  rc(g, tX + 3, tY, 6, 2, c.o2)

  // Back depth
  rc(g, tX + 4, tY + 2, 1, tH - 3, c.ob)
  rc(g, tX + 5, tY + 2, 2, tH - 3, mixColors(c.o1, c.os, 0.4))
  rc(g, tX + 7, tY + 2, 1, tH - 3, c.ob)

  // AO under collar
  rc(g, tX + 3, tY + 2, 6, 1, c.ao)

  // Outline
  for (let x = tX; x < tX + tW; x++) {
    px(g, x, tY - 1, c.ol)
    px(g, x, tY + tH, c.ol)
  }
  for (let y = tY; y < tY + tH; y++) {
    px(g, tX - 1, y, c.ol)
    px(g, tX + tW, y, c.ol)
  }

  // Belt
  rc(g, tX + 1, tY + tH - 2, tW - 2, 1, c.bt)
  px(g, tX + 5, tY + tH - 2, mixColors(c.bt, '#ffffff', 0.3))
  px(g, tX + 6, tY + tH - 2, mixColors(c.bt, '#ffffff', 0.3))

  // Shoulders
  const shL = { x: tX, y: tY + 1 }
  const shR = { x: tX + tW - 1, y: tY + 1 }
  rc(g, shL.x - 1, shL.y, 2, 2, c.o1)
  px(g, shL.x - 1, shL.y, c.os)
  rc(g, shR.x, shR.y, 2, 2, c.o1)
  px(g, shR.x + 1, shR.y, c.orim)

  return {
    tX, tY, tW, tH,
    shoulders: { left: shL, right: shR },
  }
}
