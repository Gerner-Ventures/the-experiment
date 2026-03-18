/**
 * Barrel export — all ECS components.
 *
 * Import from '@/ecs/components' (this file).
 */

// Agent domain
export {
  Position, Velocity, PathState, AnimState,
  AgentId, SpriteRef, StatusEffect,
  STATUS_TYPES,
} from './agent'
export type { StatusType } from './agent'

// Social domain
export { Mood, Social } from './social'

// Inventory domain
export { Inventory, TaskAssignment } from './inventory'

// Relations
export { CausedBy, Targets, Trusts, LocatedAt } from './relations'

// World domain
export { TileRef, WaterState, WATER_VARIANTS } from './world'
export type { WaterVariant } from './world'
