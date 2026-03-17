/**
 * Animation System — advances animation frame indices.
 *
 * Reads/Writes: AnimState (frameIndex, elapsed)
 * Removes: AnimState when non-looping animation completes (triggers onRemove observer)
 *
 * Animation registry is owned by GameSession and passed as a parameter — no module-level state.
 */

import type { World } from 'bitecs'
import { query, removeComponent } from 'bitecs'
import { AnimState } from '../components'
import type { HDAnimationDef } from '@/config/sprites/hd/types'

/** Animation registry — maps indices to animation definitions. Owned by GameSession. */
export class AnimationRegistry {
  private table: HDAnimationDef[] = []
  private nameToIndex = new Map<string, number>()

  /** Register an animation and return its index. Deduplicates by name. */
  register(anim: HDAnimationDef): number {
    const existing = this.nameToIndex.get(anim.name)
    if (existing !== undefined) return existing
    const index = this.table.length
    this.table.push(anim)
    this.nameToIndex.set(anim.name, index)
    return index
  }

  /** Get animation definition by index. */
  getByIndex(index: number): HDAnimationDef | undefined {
    return this.table[index]
  }

  /** Get animation index by name. */
  getIndex(name: string): number | undefined {
    return this.nameToIndex.get(name)
  }

  /** Reset the registry. Call on session dispose. */
  reset(): void {
    this.table.length = 0
    this.nameToIndex.clear()
  }
}

export function animationSystem(world: World, dt: number, registry: AnimationRegistry): void {
  const entities = query(world, [AnimState])

  for (const eid of entities) {
    const animIndex = AnimState.animIndex[eid] as number
    const anim = registry.getByIndex(animIndex)
    if (!anim) {
      removeComponent(world, eid, AnimState)
      continue
    }

    // Accumulate time
    AnimState.elapsed[eid] = ((AnimState.elapsed[eid] as number) || 0) + dt

    // Frame duration: speed is frames per tick at 60fps
    const frameDuration = 1 / (60 * anim.speed)

    if ((AnimState.elapsed[eid] as number) >= frameDuration) {
      AnimState.elapsed[eid] = (AnimState.elapsed[eid] as number) - frameDuration
      const nextFrame = (AnimState.frameIndex[eid] as number) + 1

      if (nextFrame >= anim.poses.length) {
        if (anim.loop) {
          AnimState.frameIndex[eid] = 0
        } else {
          // Animation complete — remove AnimState (fires onRemove observer)
          removeComponent(world, eid, AnimState)
        }
      } else {
        AnimState.frameIndex[eid] = nextFrame
      }
    }
  }
}
