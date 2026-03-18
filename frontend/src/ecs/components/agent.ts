/**
 * Agent Components — identity, position, movement, animation, status.
 */

// ─── Core Simulation Components ───

/** Tile position + cached screen position for rendering */
export const Position = {
  x: [] as number[],
  y: [] as number[],
  screenX: [] as number[],
  screenY: [] as number[],
}

/** Movement velocity (tiles per second) in each axis */
export const Velocity = {
  dx: [] as number[],
  dy: [] as number[],
}

/** Active path-following state */
export const PathState = {
  waypointIndex: [] as number[],
  waypointCount: [] as number[],
  progress: [] as number[],
  fromX: [] as number[],
  fromY: [] as number[],
  toX: [] as number[],
  toY: [] as number[],
}

/** Animation playback state */
export const AnimState = {
  frameIndex: [] as number[],
  elapsed: [] as number[],
  loop: [] as number[],
  animIndex: [] as number[],
}

/** Links ECS entity to string agent ID (via lookup table index) */
export const AgentId = {
  idIndex: [] as number[],
}

/** Links ECS entity to PixiJS sprite (via renderer sprite pool index) */
export const SpriteRef = {
  spriteIndex: [] as number[],
}

// ─── Status / Consequence Components ───

/** Active status effect on an entity (bleeding, poisoned, stunned, etc.) */
export const StatusEffect = {
  type: [] as number[],
  intensity: [] as number[],
  remaining: [] as number[],
}

// ─── Status Effect Types ───

export const STATUS_TYPES = {
  BLEEDING: 0,
  POISONED: 1,
  STUNNED: 2,
  INJURED: 3,
  FLEEING: 4,
} as const

export type StatusType = (typeof STATUS_TYPES)[keyof typeof STATUS_TYPES]
