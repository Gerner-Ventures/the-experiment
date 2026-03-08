import type { FullPalette, PixelGrid, HairStyle, AccessorySet } from './types'
import { darken, lighten, mixColors } from './palette'
import { px, rc } from './grid-helpers'

// ─── Hair Renderer ───

export function drawHair(
  g: PixelGrid,
  c: FullPalette,
  headX: number,
  headY: number,
  headW: number,
  headH: number,
  hairStyle: HairStyle,
): void {
  const hy = headY - 3

  switch (hairStyle) {
    case 0: // Short spiky
      px(g, headX + 1, hy, c.hr); px(g, headX + 3, hy - 1, c.hr)
      px(g, headX + 6, hy - 1, c.hr); px(g, headX + 9, hy, c.hr)
      rc(g, headX, hy + 1, headW, 2, c.hr)
      rc(g, headX - 1, hy + 2, headW + 2, 2, c.hr)
      rc(g, headX - 1, hy + 4, 2, 3, c.hr)
      rc(g, headX + headW - 1, hy + 4, 2, 3, c.hr)
      px(g, headX + 2, hy + 1, c.hh); px(g, headX + 5, hy + 1, c.hh); px(g, headX + 8, hy + 1, c.hh)
      px(g, headX + 3, hy + 2, c.hh); px(g, headX + 7, hy + 2, c.hh)
      rc(g, headX - 1, hy + 5, 2, 2, c.hs)
      break

    case 1: // Side part
      rc(g, headX, hy + 1, headW, 1, c.hr)
      rc(g, headX - 1, hy + 2, headW + 2, 2, c.hr)
      rc(g, headX - 1, hy + 4, 2, 4, c.hr)
      rc(g, headX + headW - 1, hy + 4, 2, 3, c.hr)
      rc(g, headX - 1, hy + 2, 3, 1, c.hs)
      px(g, headX + 3, hy + 1, c.hh); px(g, headX + 7, hy + 1, c.hh)
      break

    case 2: // Long
      rc(g, headX, hy, headW, 1, c.hr)
      rc(g, headX - 1, hy + 1, headW + 2, 3, c.hr)
      rc(g, headX - 2, hy + 4, 2, 9, c.hr)
      rc(g, headX + headW, hy + 4, 2, 9, c.hr)
      rc(g, headX - 2, hy + 12, 2, 3, c.hr)
      rc(g, headX + headW, hy + 12, 2, 3, c.hr)
      px(g, headX + 2, hy + 1, c.hh); px(g, headX + 5, hy + 1, c.hh); px(g, headX + 9, hy + 1, c.hh)
      rc(g, headX - 2, hy + 7, 2, 3, c.hs)
      rc(g, headX + headW, hy + 7, 2, 3, c.hs)
      break

    case 3: // Buzz
      rc(g, headX + 1, hy + 1, headW - 2, 1, c.hr)
      rc(g, headX, hy + 2, headW, 2, c.hr)
      px(g, headX + 3, hy + 2, c.hh); px(g, headX + 8, hy + 2, c.hh)
      break

    case 4: // Mohawk
      rc(g, headX + 4, hy - 3, 4, 1, c.hr)
      rc(g, headX + 3, hy - 2, 6, 1, c.hr)
      rc(g, headX + 3, hy - 1, 6, 1, c.hr)
      rc(g, headX + 2, hy, 8, 1, c.hr)
      rc(g, headX + 1, hy + 1, 10, 1, c.hr)
      rc(g, headX, hy + 2, headW, 2, c.hr)
      px(g, headX + 5, hy - 3, c.hh); px(g, headX + 4, hy - 2, c.hh); px(g, headX + 6, hy - 1, c.hh)
      break

    default: // 5: Curly/full
      rc(g, headX - 1, hy, headW + 2, 1, c.hr)
      rc(g, headX - 2, hy + 1, headW + 4, 3, c.hr)
      rc(g, headX - 2, hy + 4, 2, 4, c.hr)
      rc(g, headX + headW, hy + 4, 2, 4, c.hr)
      px(g, headX, hy - 1, c.hr); px(g, headX + 3, hy - 1, c.hr)
      px(g, headX + 6, hy - 1, c.hr); px(g, headX + 9, hy - 1, c.hr)
      px(g, headX + 1, hy, c.hh); px(g, headX + 4, hy, c.hh)
      px(g, headX + 7, hy, c.hh); px(g, headX + 10, hy, c.hh)
      px(g, headX + 0, hy + 1, c.hh); px(g, headX + 3, hy + 1, c.hh)
      px(g, headX + 6, hy + 1, c.hh); px(g, headX + 9, hy + 1, c.hh)
      rc(g, headX - 2, hy + 5, 2, 2, c.hs)
      rc(g, headX + headW, hy + 5, 2, 2, c.hs)
      break
  }

  // Hair back shadow (cast on neck/shoulders)
  rc(g, headX + 3, headY + headH + 1, headW - 6, 1, c.hbs)
  rc(g, headX + 4, headY + headH + 2, headW - 8, 1, mixColors(c.hbs, c.sk, 0.5))
}

// ─── Mustache ───

export function drawMustache(
  g: PixelGrid,
  c: FullPalette,
  headX: number,
  mouthY: number,
  mustache: NonNullable<AccessorySet['mustache']>,
): void {
  const mx = headX + 3
  const my = mouthY - 1

  switch (mustache) {
    case 'handlebar':
      rc(g, mx, my, 6, 1, c.hr); rc(g, mx + 1, my + 1, 4, 1, c.hr)
      px(g, mx - 1, my + 1, c.hr); px(g, mx + 6, my + 1, c.hr)
      px(g, mx - 1, my, c.hr); px(g, mx + 6, my, c.hr)
      break
    case 'thick':
      rc(g, mx + 1, my, 4, 2, c.hr)
      rc(g, mx, my, 1, 1, c.hr); rc(g, mx + 5, my, 1, 1, c.hr)
      break
    case 'goatee':
      rc(g, mx + 1, my, 4, 1, c.hr)
      rc(g, mx + 2, my + 1, 2, 1, c.hr)
      rc(g, headX + 4, mouthY + 1, 3, 2, c.hr)
      break
  }
}

// ─── Hat ───

export function drawHat(
  g: PixelGrid,
  c: FullPalette,
  headX: number,
  headY: number,
  headW: number,
  hat: NonNullable<AccessorySet['hat']>,
  hatColor?: string,
): void {
  const hy = headY - 3
  const hatY = hy - 1
  const color = hatColor || '#cc3333'

  switch (hat) {
    case 'cap':
      rc(g, headX - 1, hatY + 1, headW + 2, 3, color)
      rc(g, headX - 1, hatY + 1, headW + 2, 1, lighten(color, 20))
      rc(g, headX - 3, hatY + 3, headW + 4, 1, darken(color, 20))
      rc(g, headX - 3, hatY + 4, headW + 5, 1, darken(color, 35))
      for (let x = headX - 1; x < headX + headW + 1; x++) px(g, x, hatY, c.ol)
      for (let x = headX - 3; x < headX + headW + 4; x++) px(g, x, hatY + 5, c.ol)
      break

    case 'beanie':
      rc(g, headX, hatY, headW, 4, color)
      rc(g, headX + 1, hatY - 1, headW - 2, 1, color)
      rc(g, headX, hatY + 3, headW, 1, darken(color, 20))
      rc(g, headX + 4, hatY - 3, 4, 2, color)
      rc(g, headX + 5, hatY - 4, 2, 1, lighten(color, 20))
      px(g, headX + 5, hatY - 3, lighten(color, 30))
      break

    case 'chef':
      rc(g, headX + 1, hatY - 4, headW - 2, 7, c.ew)
      rc(g, headX + 2, hatY - 5, headW - 4, 1, c.ew)
      rc(g, headX + 3, hatY - 6, headW - 6, 2, c.ew)
      rc(g, headX, hatY + 2, headW, 2, c.ew)
      for (let x = headX + 3; x < headX + headW - 3; x++) px(g, x, hatY - 7, c.ol)
      px(g, headX + 2, hatY - 6, c.ol); px(g, headX + headW - 3, hatY - 6, c.ol)
      px(g, headX + 1, hatY - 5, c.ol); px(g, headX + headW - 2, hatY - 5, c.ol)
      for (let y = hatY - 4; y < hatY + 2; y++) {
        px(g, headX, y, c.ol); px(g, headX + headW - 1, y, c.ol)
      }
      break

    case 'tophat':
      rc(g, headX + 2, hatY - 6, headW - 4, 8, c.ol)
      rc(g, headX + 3, hatY - 5, headW - 6, 6, darken(c.ol, 0))
      rc(g, headX - 1, hatY + 1, headW + 2, 2, c.ol)
      rc(g, headX + 3, hatY - 1, headW - 6, 1, '#cc3333')
      rc(g, headX + 4, hatY - 4, 1, 4, lighten(c.ol, 30))
      break

    case 'military': {
      const mc = '#4a5a3a'
      rc(g, headX - 1, hatY + 1, headW + 2, 3, darken(mc, 0))
      rc(g, headX - 1, hatY + 1, headW + 2, 1, lighten(mc, 15))
      rc(g, headX - 2, hatY + 3, headW + 3, 1, darken(mc, 15))
      rc(g, headX - 2, hatY + 4, headW + 2, 1, darken(mc, 30))
      px(g, headX + 5, hatY + 2, '#ddaa33'); px(g, headX + 6, hatY + 2, '#ddaa33')
      break
    }
  }
}
