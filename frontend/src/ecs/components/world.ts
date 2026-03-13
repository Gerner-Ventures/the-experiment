/**
 * World Components — tiles, water, buildings, hazards (map elements).
 */

/** Marks an entity as a world tile (not an agent) */
export const TileRef = {
  tileX: [] as number[],
  tileY: [] as number[],
  tileSpriteIndex: [] as number[],  // index into renderer tile sprite pool
}

/** Water tile animation state */
export const WaterState = {
  phase: [] as number[],    // 0-2PI offset per tile (staggered ripples)
  frame: [] as number[],    // current frame index (0-3)
  elapsed: [] as number[],  // time accumulator
  variant: [] as number[],  // 0=ocean, 1=code_river
}

/** Water variant constants */
export const WATER_VARIANTS = {
  OCEAN: 0,
  CODE_RIVER: 1,
} as const

export type WaterVariant = (typeof WATER_VARIANTS)[keyof typeof WATER_VARIANTS]
