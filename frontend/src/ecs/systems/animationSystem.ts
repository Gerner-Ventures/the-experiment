/**
 * Animation System — advances animation frame indices.
 *
 * Reads/Writes: AnimState (frameIndex, elapsed)
 * Removes: AnimState when non-looping animation completes (triggers onRemove observer)
 */

import type { World } from 'bitecs'
import { query, removeComponent } from 'bitecs'
import { AnimState } from '../components'
import type { HDAnimationDef } from '@/config/sprites/hd/types'

/** Animation lookup table: animIndex → animation definition */
const animTable: HDAnimationDef[] = []
const animNameToIndex = new Map<string, number>()

/** Register an animation and return its index. Deduplicates by name. */
export function registerAnimation(anim: HDAnimationDef): number {
  const existing = animNameToIndex.get(anim.name)
  if (existing !== undefined) return existing
  const index = animTable.length
  animTable.push(anim)
  animNameToIndex.set(anim.name, index)
  return index
}

/** Get animation definition by index. */
export function getAnimationByIndex(index: number): HDAnimationDef | undefined {
  return animTable[index]
}

/** Get animation index by name. */
export function getAnimationIndex(name: string): number | undefined {
  return animNameToIndex.get(name)
}

/** Reset the animation registry. Call on world destroy to prevent cross-lifecycle leaks. */
export function resetAnimationRegistry(): void {
  animTable.length = 0
  animNameToIndex.clear()
}

export function animationSystem(world: World, dt: number): void {
  const entities = query(world, [AnimState])

  for (const eid of entities) {
    const animIndex = AnimState.animIndex[eid] as number
    const anim = animTable[animIndex]
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
