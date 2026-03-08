import type { HDCharacterDef, HDPoseName, StatusEffect } from './types'
import { renderHDSpriteToCanvas } from './render'

/** Hash status effects for cache key differentiation */
function statusHash(statuses: StatusEffect[]): string {
  if (statuses.length === 0) return ''
  return ':' + statuses.map(s => `${s.type}${s.seed ?? ''}`).sort().join(',')
}

/**
 * Shared frame cache for HD sprites.
 * Keyed by `${characterId}:${poseName}:${statusHash}` — renders once, reused across instances.
 */
class HDFrameCacheImpl {
  private cache = new Map<string, HTMLCanvasElement>()

  private key(characterId: string, poseName: HDPoseName, statuses: StatusEffect[] = []): string {
    return `${characterId}:${poseName}${statusHash(statuses)}`
  }

  get(
    character: HDCharacterDef,
    poseName: HDPoseName,
    scale?: number,
    statuses: StatusEffect[] = [],
  ): HTMLCanvasElement {
    const k = this.key(character.id, poseName, statuses)
    let canvas = this.cache.get(k)
    if (!canvas) {
      canvas = renderHDSpriteToCanvas(character, poseName, scale, statuses)
      this.cache.set(k, canvas)
    }
    return canvas
  }

  /**
   * Pre-render a set of poses for a character.
   * Call on spawn to warm the cache.
   */
  prerender(character: HDCharacterDef, poses: HDPoseName[], scale?: number): void {
    for (const pose of poses) {
      this.get(character, pose, scale)
    }
  }

  /** Invalidate all cached frames for a character (e.g., status change) */
  invalidateCharacter(characterId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(characterId + ':')) {
        this.cache.delete(key)
      }
    }
  }

  /** Clear entire cache */
  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

export const HDFrameCache = new HDFrameCacheImpl()
