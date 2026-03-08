/** Directions for sprite facing/movement */
export type SpriteDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Animation states a sprite can be in */
export type SpriteAnimation =
  // Locomotion
  | 'idle'
  | 'walk'
  | 'run'

  // Work / productive
  | 'gather'
  | 'build'
  | 'heal'

  // Social
  | 'talk'
  | 'argue'
  | 'rally'
  | 'dance'
  | 'celebrate'
  | 'pray'
  | 'mourn'

  // Aggressive
  | 'punch'
  | 'stab'
  | 'shoot'
  | 'threaten'

  // Emotional
  | 'panic'
  | 'breakdown'
  | 'think'
  | 'monologue'
  | 'suspicious'

  // Biological (the dark humor ones)
  | 'eat'
  | 'drink'
  | 'sleep'
  | 'pee'
  | 'poop'
  | 'vomit'

  // State
  | 'dead'
  | 'injured'
  | 'sneak'

/** Sprite sheet frame definition for a single animation */
export interface SpriteFrameDef {
  animation: SpriteAnimation
  direction: SpriteDirection
  frames: number
  row: number
  loop: boolean
}
