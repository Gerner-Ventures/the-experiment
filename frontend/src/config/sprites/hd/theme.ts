import { HD_GRID_H, HD_PIXEL_SCALE } from './constants'

// ─── Canvas Layout ───

/** Full canvas height in screen pixels */
export const HD_CANVAS_H = HD_GRID_H * HD_PIXEL_SCALE // 144

/**
 * Vertical offset from canvas bottom (anchor point) to character feet.
 * The bottom ~10 rows of the 48-row grid are ground plane/shadow area.
 * Character feet land around grid row 38, so offset = (48 - 38) * 3 = 30.
 */
export const HD_FEET_OFFSET_Y = -30

/** Vertical offset from canvas bottom to above the character's head */
export const HD_HEAD_TOP_OFFSET_Y = -(HD_CANVAS_H - 6) // small margin from top

// ─── Selection Ring ───

export const HD_SELECTION_RING = {
  rx: 50,
  ry: 20,
  color: '#00e5a0',
  strokeWidth: 2,
  alpha: 0.8,
} as const

// ─── Highlight Ring ───

export const HD_HIGHLIGHT_RING = {
  rx: 52,
  ry: 22,
  strokeWidth: 3,
  alpha: 0.9,
} as const

// ─── Name Label ───

export const AGENT_NAME_LABEL = {
  fontFamily: 'JetBrains Mono Variable, monospace',
  fontSize: 9,
  fill: '#ffffff',
  alpha: 0.6,
} as const

// ─── Movement ───

/** Tile-to-tile movement speed: higher = faster. 4 = ~0.25s per tile (Pokemon-style). */
export const MOVE_SPEED = 4
