import type { FullPalette, PixelGrid, PropType, HandPosition } from './types'
import { darken, lighten } from './palette'
import { px, rc } from './grid-helpers'
import { HEAD_CX, EYE_Y } from './body-regions'

// ─── Prop Renderer ───

export function drawProp(
  g: PixelGrid,
  c: FullPalette,
  prop: PropType,
  hand: HandPosition,
): void {
  const hx = hand.hx
  const hy = hand.hy

  switch (prop) {
    case 'knife_held': {
      // Knife held back — blade up
      const kx = hx + 2, ky = hy - 1
      rc(g, kx, ky, 1, 6, '#cccccc')
      px(g, kx + 1, ky, '#1a1a2e'); px(g, kx + 1, ky + 1, '#dddddd')
      px(g, kx, ky, '#eeeeee')
      rc(g, kx - 1, ky + 5, 3, 2, '#8b6914')
      px(g, kx, ky + 5, '#a07818')
      break
    }
    case 'knife_thrust': {
      // Knife thrust forward — blade horizontal
      const kx = hx + 2, ky = hy - 1
      rc(g, kx, ky, 7, 1, '#cccccc')
      rc(g, kx, ky - 1, 7, 1, '#dddddd')
      px(g, kx + 6, ky - 1, '#eeeeee'); px(g, kx + 6, ky, '#aaaaaa')
      rc(g, kx - 1, ky - 1, 2, 3, '#8b6914')
      px(g, kx - 1, ky, '#a07818')
      break
    }
    case 'gun_aim': {
      // Aiming — gun forward
      const gx = hx + 2, gy = hy
      rc(g, gx, gy - 1, 5, 3, '#444455')
      rc(g, gx, gy - 1, 5, 1, '#555566')
      rc(g, gx + 4, gy, 1, 2, '#333344')
      px(g, gx + 5, gy - 1, '#666677')
      break
    }
    case 'gun_fire': {
      // Firing — gun extended with muzzle flash
      const gx = hx + 2, gy = hy
      rc(g, gx, gy - 1, 6, 3, '#444455')
      rc(g, gx, gy - 1, 6, 1, '#555566')
      rc(g, gx + 5, gy, 1, 2, '#333344')
      px(g, gx + 6, gy - 1, '#ffff44'); px(g, gx + 7, gy - 2, '#ffaa22'); px(g, gx + 7, gy, '#ffaa22')
      px(g, gx + 6, gy - 2, '#ffff88')
      break
    }
    case 'impact_stars': {
      const ix = hx + 4, iy = hy - 1
      px(g, ix, iy, '#ffff44'); px(g, ix + 1, iy - 1, '#ffff44'); px(g, ix + 2, iy, '#ffff44')
      px(g, ix + 1, iy + 1, '#ffaa22'); px(g, ix, iy - 1, '#ffaa22')
      break
    }
    case 'muzzle_flash': {
      const fx = hx + 6, fy = hy - 1
      px(g, fx, fy, '#ffff44'); px(g, fx + 1, fy - 1, '#ffaa22'); px(g, fx + 1, fy + 1, '#ffaa22')
      px(g, fx, fy - 1, '#ffff88')
      break
    }
    case 'thought_bubble': {
      px(g, hx + 1, hy - 2, '#fff'); px(g, hx + 2, hy - 4, '#fff')
      rc(g, hx + 2, hy - 8, 5, 3, '#fff'); rc(g, hx + 3, hy - 9, 3, 1, '#fff')
      px(g, hx + 3, hy - 7, '#aabbcc'); px(g, hx + 5, hy - 7, '#aabbcc')
      break
    }
    case 'speech_particles': {
      const sx = hx + 2, sy = hy - 3
      px(g, sx, sy, '#fff'); px(g, sx + 2, sy - 1, '#fff'); px(g, sx + 1, sy + 1, '#ccc')
      break
    }
    case 'mug': {
      // Cup/mug with straw
      const dx = hx - 1, dy = hy - 3
      rc(g, dx, dy, 4, 5, '#ddaa66')
      rc(g, dx, dy, 1, 5, darken('#ddaa66', 20))
      rc(g, dx + 3, dy, 1, 5, lighten('#ddaa66', 15))
      rc(g, dx, dy, 4, 1, '#996633')
      rc(g, dx + 4, dy + 1, 2, 3, '#ddaa66')
      px(g, dx + 4, dy + 1, darken('#ddaa66', 15))
      px(g, dx + 5, dy + 2, darken('#ddaa66', 15))
      px(g, dx + 4, dy + 3, darken('#ddaa66', 15))
      // Straw
      const stX = dx + 1
      rc(g, stX, dy - 6, 1, 7, '#cc3333')
      px(g, stX, dy - 7, '#ee4444')
      px(g, stX + 1, dy - 6, '#aa2222')
      // Liquid
      rc(g, dx + 1, dy + 1, 2, 3, '#885533')
      break
    }
    case 'megaphone': {
      const mx = hx + 2, my = hy - 2
      rc(g, mx, my, 3, 4, '#888888')
      rc(g, mx + 3, my - 1, 2, 6, '#999999')
      rc(g, mx + 5, my - 2, 1, 8, '#aaaaaa')
      break
    }
    case 'hammer': {
      // Hammer
      const hmx = hx + 2, hmy = hy - 1
      rc(g, hmx, hmy, 1, 6, '#8b6914') // handle
      rc(g, hmx - 1, hmy, 3, 2, '#888888') // head
      px(g, hmx - 1, hmy, '#aaaaaa')
      break
    }
    case 'vial': {
      const vx = hx + 1, vy = hy - 3
      rc(g, vx, vy, 2, 4, '#44cc44')
      rc(g, vx, vy, 2, 1, '#aaaaaa')
      px(g, vx, vy + 1, '#66ee66')
      break
    }
    case 'sack': {
      const sx = hx, sy = hy - 2
      rc(g, sx, sy, 4, 4, '#886644')
      rc(g, sx, sy, 4, 1, '#aa8866')
      px(g, sx + 1, sy + 1, '#aa8866')
      break
    }
    case 'bandage_item': {
      rc(g, hx, hy - 2, 3, 3, '#ffffff')
      px(g, hx + 1, hy - 1, '#cc3333')
      break
    }
    case 'food': {
      rc(g, hx, hy - 2, 4, 3, '#dd8833')
      rc(g, hx + 1, hy - 1, 2, 1, '#cc6622')
      break
    }
    case 'binoculars': {
      // Binoculars held at side/chest — compact side view
      const bx = hx, by = hy - 2
      // Body tube (side profile)
      rc(g, bx, by, 4, 2, '#333344')
      rc(g, bx, by, 4, 1, '#444455')
      // Lens end
      px(g, bx + 4, by, '#6688aa'); px(g, bx + 4, by + 1, '#557799')
      // Eyepiece end
      px(g, bx - 1, by, '#555566'); px(g, bx - 1, by + 1, '#555566')
      // Strap hint
      px(g, bx + 1, by - 1, '#665544')
      break
    }
    case 'magnifying_glass': {
      // Lens circle
      const lx = hx - 3, ly = hy - 5
      rc(g, lx, ly, 4, 4, '#ffffff')
      rc(g, lx + 1, ly + 1, 2, 2, '#aaccff')
      // Frame
      px(g, lx - 1, ly, '#888888'); px(g, lx - 1, ly + 3, '#888888')
      px(g, lx + 4, ly, '#888888'); px(g, lx + 4, ly + 3, '#888888')
      // Handle
      px(g, lx + 4, ly + 4, '#8b6914'); px(g, lx + 5, ly + 5, '#8b6914')
      break
    }
    case 'magnifying_glass_raising': {
      // Magnifying glass mid-raise — between hand and face
      const rx = hx - 1, ry = hy - 6
      // Lens (smaller, at angle)
      rc(g, rx, ry, 3, 3, '#ffffff')
      rc(g, rx + 1, ry + 1, 1, 1, '#aaccff')
      // Frame ring
      px(g, rx - 1, ry, '#888888'); px(g, rx + 3, ry, '#888888')
      px(g, rx - 1, ry + 2, '#888888'); px(g, rx + 3, ry + 2, '#888888')
      // Handle
      px(g, rx + 3, ry + 3, '#8b6914'); px(g, rx + 4, ry + 4, '#8b6914')
      break
    }
    case 'magnifying_glass_face': {
      // Large magnifying glass in front of face — one big lens over eye area
      // Drawn at fixed head position (face center ~x=16, eyes ~y=9)
      const cx = HEAD_CX, ey = EYE_Y
      // Large circular lens (5×5) covering one eye
      rc(g, cx - 3, ey - 3, 6, 6, '#ffffff')
      // Glass tint — slightly blue/clear
      rc(g, cx - 2, ey - 2, 4, 4, '#ddeeff')
      // Magnified eye visible through lens (larger than normal)
      rc(g, cx - 1, ey - 1, 3, 2, '#ffffff')
      px(g, cx, ey - 1, c.ei); px(g, cx, ey, c.ep)
      px(g, cx - 1, ey, c.ei); px(g, cx + 1, ey - 1, c.ei)
      // Lens glint
      px(g, cx - 2, ey - 2, '#eef8ff')
      px(g, cx - 1, ey - 2, '#eef8ff')
      // Frame ring (dark outline around lens)
      px(g, cx - 3, ey - 3, '#666666'); px(g, cx + 2, ey - 3, '#666666')
      px(g, cx - 3, ey + 2, '#666666'); px(g, cx + 2, ey + 2, '#666666')
      rc(g, cx - 3, ey - 2, 1, 4, '#777777')
      rc(g, cx + 2, ey - 2, 1, 4, '#777777')
      rc(g, cx - 2, ey - 3, 4, 1, '#777777')
      rc(g, cx - 2, ey + 2, 4, 1, '#777777')
      // Handle extending down-right
      px(g, cx + 2, ey + 3, '#8b6914')
      px(g, cx + 3, ey + 4, '#8b6914')
      px(g, cx + 4, ey + 5, '#8b6914')
      px(g, cx + 3, ey + 3, '#a07818')
      break
    }
    case 'flame_particles': {
      px(g, hx, hy - 3, '#ff4422'); px(g, hx + 1, hy - 4, '#ffaa22')
      px(g, hx + 2, hy - 3, '#ffff44'); px(g, hx - 1, hy - 2, '#ff6622')
      break
    }
    case 'dizzy_stars': {
      px(g, hx - 2, hy - 8, '#ffff44'); px(g, hx + 4, hy - 10, '#ffff44')
      px(g, hx + 1, hy - 11, '#ffaa22'); px(g, hx + 6, hy - 9, '#ffaa22')
      break
    }
    case 'green_particles': {
      px(g, hx, hy - 3, '#44cc44'); px(g, hx + 2, hy - 4, '#22aa22')
      px(g, hx - 1, hy - 2, '#66ee66')
      break
    }
    case 'confetti': {
      px(g, hx - 2, hy - 6, '#ff4444'); px(g, hx + 1, hy - 8, '#44ff44')
      px(g, hx + 4, hy - 7, '#4444ff'); px(g, hx + 2, hy - 5, '#ffff44')
      px(g, hx - 1, hy - 9, '#ff44ff')
      break
    }
    case 'zzz': {
      px(g, hx + 1, hy - 5, '#aabbcc')
      px(g, hx + 3, hy - 7, '#8899aa')
      px(g, hx + 5, hy - 9, '#667788')
      break
    }
    case 'tears': {
      px(g, hx - 5, hy - 2, '#6688cc'); px(g, hx - 5, hy - 1, '#6688cc')
      px(g, hx + 7, hy - 2, '#6688cc'); px(g, hx + 7, hy - 1, '#6688cc')
      break
    }
    case 'pee_stream': {
      // Yellow stream falling from character
      const py = hy + 4
      px(g, hx + 1, py, '#ffcc44'); px(g, hx + 1, py + 1, '#ffcc44')
      px(g, hx + 1, py + 2, '#ffcc44'); px(g, hx + 1, py + 3, '#ffcc44')
      break
    }
    case 'poop_pile': {
      const py = hy + 6
      rc(g, hx, py, 3, 2, '#664422')
      px(g, hx + 1, py - 1, '#664422')
      break
    }
    case 'vomit_splatter': {
      const vx = hx + 3, vy = hy
      px(g, vx, vy, '#88cc44'); px(g, vx + 1, vy, '#88cc44')
      px(g, vx + 2, vy + 1, '#88cc44'); px(g, vx + 1, vy + 1, '#aadd66')
      px(g, vx + 3, vy + 1, '#88cc44')
      break
    }
    case 'adventure_hat': {
      // Wide-brimmed explorer hat held in hand
      const ax = hx - 2, ay = hy - 2
      // Brim
      rc(g, ax, ay + 2, 7, 1, '#8b6914')
      rc(g, ax - 1, ay + 3, 9, 1, darken('#8b6914', 10))
      // Crown
      rc(g, ax + 1, ay, 5, 2, '#a07818')
      rc(g, ax + 2, ay, 3, 1, lighten('#a07818', 15))
      // Band
      rc(g, ax + 1, ay + 2, 5, 1, '#664411')
      break
    }
    case 'adventure_hat_on': {
      // Explorer hat worn on head — drawn relative to hand pos (which caller maps to head)
      const ax = hx - 3, ay = hy - 2
      // Brim — wider than head
      rc(g, ax, ay + 2, 9, 1, '#8b6914')
      rc(g, ax - 1, ay + 3, 11, 1, darken('#8b6914', 10))
      // Crown
      rc(g, ax + 2, ay, 5, 2, '#a07818')
      rc(g, ax + 3, ay, 3, 1, lighten('#a07818', 15))
      // Band
      rc(g, ax + 2, ay + 2, 5, 1, '#664411')
      break
    }
    case 'binoculars_raising': {
      // Binoculars mid-raise — between chest and face
      const bx = hx - 1, by = hy - 5
      // Two barrels at angle
      rc(g, bx, by, 3, 3, '#333344')
      rc(g, bx + 4, by, 3, 3, '#333344')
      // Lenses (partially visible)
      px(g, bx + 1, by, '#6688aa'); px(g, bx + 5, by, '#6688aa')
      // Bridge
      rc(g, bx + 3, by + 1, 1, 1, '#444455')
      // Body
      rc(g, bx + 1, by + 3, 5, 1, '#555566')
      break
    }
    case 'binoculars_face': {
      // Binoculars in front of face — front view showing two big round lenses
      // Drawn at fixed head position (face center ~x=16, eyes ~y=9) regardless of hand
      const cx = HEAD_CX, ey = EYE_Y
      // Left lens — large circle (front-facing)
      rc(g, cx - 5, ey - 2, 4, 4, '#333344')
      rc(g, cx - 4, ey - 1, 2, 2, '#6688aa')
      // Left lens glint
      px(g, cx - 4, ey - 1, '#8899cc')
      // Left lens rim
      px(g, cx - 5, ey - 2, '#222233'); px(g, cx - 2, ey - 2, '#222233')
      px(g, cx - 5, ey + 1, '#222233'); px(g, cx - 2, ey + 1, '#222233')
      // Right lens — large circle (front-facing)
      rc(g, cx + 2, ey - 2, 4, 4, '#333344')
      rc(g, cx + 3, ey - 1, 2, 2, '#6688aa')
      // Right lens glint
      px(g, cx + 3, ey - 1, '#8899cc')
      // Right lens rim
      px(g, cx + 2, ey - 2, '#222233'); px(g, cx + 5, ey - 2, '#222233')
      px(g, cx + 2, ey + 1, '#222233'); px(g, cx + 5, ey + 1, '#222233')
      // Bridge between lenses
      rc(g, cx - 1, ey - 1, 2, 2, '#444455')
      px(g, cx - 1, ey, '#555566'); px(g, cx, ey, '#555566')
      break
    }
    case 'map': {
      // Unfolded parchment/map held in hand
      const mx = hx - 3, my = hy - 4
      // Parchment background
      rc(g, mx, my, 6, 5, '#e8d5a3')
      rc(g, mx, my, 6, 1, lighten('#e8d5a3', 10))
      rc(g, mx, my + 4, 6, 1, darken('#e8d5a3', 10))
      // Map markings — simple lines and X
      px(g, mx + 1, my + 1, '#886644'); px(g, mx + 2, my + 1, '#886644')
      px(g, mx + 1, my + 2, '#886644'); px(g, mx + 3, my + 2, '#886644')
      px(g, mx + 4, my + 3, '#886644')
      // X marks the spot
      px(g, mx + 4, my + 1, '#cc3333'); px(g, mx + 3, my + 2, '#cc3333')
      break
    }
  }
}

// ─── Ground Shadow ───

export function drawGroundShadow(
  g: PixelGrid,
  legBottom: number,
  lean: number,
): void {
  const shY = legBottom
  const shCx = 16 + lean
  const shRx = 7
  const shRy = 2

  for (let sy = shY - shRy; sy <= shY + shRy; sy++) {
    for (let sx = shCx - shRx; sx <= shCx + shRx; sx++) {
      const dx = (sx - shCx) / shRx
      const dy = (sy - shY) / shRy
      if (dx * dx + dy * dy <= 1.0) {
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 0.4) px(g, sx, sy, '#06060f')
        else if (dist < 0.7) px(g, sx, sy, '#0c0c1e')
        else px(g, sx, sy, '#10102a')
      }
    }
  }
}
