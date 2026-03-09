/**
 * ECS Components — SoA (Structure of Arrays) component definitions.
 *
 * bitECS 0.4 components are plain objects whose values are arrays.
 * Entity data is accessed as Component.field[entityId].
 * We use standard JS arrays (bitECS populates them at runtime).
 */

import {
  createRelation,
  withAutoRemoveSubject,
  withStore,
  makeExclusive,
} from 'bitecs'

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

// ─── Stub Components (defined, not wired — future use) ───

export const Mood = {
  happiness: [] as number[],
  fear: [] as number[],
  anger: [] as number[],
}

export const Social = {
  influence: [] as number[],
  suspicion: [] as number[],
}

export const Inventory = {
  itemCount: [] as number[],
}

export const TaskAssignment = {
  taskIndex: [] as number[],
  progress: [] as number[],
}

// ─── Relations ───

/** Consequence → aggressor link. Auto-removes if aggressor entity is destroyed. */
export const CausedBy = createRelation(withAutoRemoveSubject)

/** Aggressor → victim. Exclusive: one target per action at a time. */
export const Targets = createRelation(makeExclusive)

/** Social trust relationship with data store. */
export const Trusts = createRelation(withStore(() => ({ level: 0.5 })))

/** Agent → location entity. Exclusive: one location at a time. */
export const LocatedAt = createRelation(makeExclusive)

// ─── Status Effect Types ───

export const STATUS_TYPES = {
  BLEEDING: 0,
  POISONED: 1,
  STUNNED: 2,
  INJURED: 3,
  FLEEING: 4,
} as const

export type StatusType = (typeof STATUS_TYPES)[keyof typeof STATUS_TYPES]
