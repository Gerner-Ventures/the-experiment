/**
 * ECS World — creates and configures the bitECS world instance.
 */

import { createWorld, registerComponents } from 'bitecs'
import type { World } from 'bitecs'
import {
  Position, Velocity, PathState, AnimState,
  AgentId, SpriteRef, StatusEffect,
  Mood, Social, Inventory, TaskAssignment,
} from './components'

/** Create a fresh ECS world with all components registered. */
export function createGameWorld(): World {
  const world = createWorld()

  registerComponents(world, [
    Position,
    Velocity,
    PathState,
    AnimState,
    AgentId,
    SpriteRef,
    StatusEffect,
    Mood,
    Social,
    Inventory,
    TaskAssignment,
  ])

  return world
}
