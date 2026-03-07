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

/** Maps game action types to sprite animations */
export const ACTION_TO_ANIMATION: Record<string, SpriteAnimation> = {
  // Cooperative
  move: 'walk',
  gather: 'gather',
  repair: 'build',
  trade: 'talk',
  talk: 'talk',
  vote: 'talk',
  rest: 'idle',
  observe: 'think',
  heal: 'heal',

  // Selfish
  hoard: 'sneak',
  sabotage: 'sneak',
  explore: 'walk',
  accuse: 'argue',
  steal: 'sneak',
  scheme: 'think',

  // Aggressive
  attack: 'punch',
  threaten: 'threaten',
  stab: 'stab',
  shoot: 'shoot',
  poison: 'sneak',

  // Social / expressive
  dance: 'dance',
  pray: 'pray',
  rally: 'rally',
  mourn: 'mourn',
  celebrate: 'celebrate',
  argue: 'argue',

  // Biological
  pee: 'pee',
  poop: 'poop',
  vomit: 'vomit',
  sleep: 'sleep',
  eat: 'eat',
  drink: 'drink',

  // Meta
  investigate: 'suspicious',
  monologue: 'monologue',
  panic: 'panic',
  breakdown: 'breakdown',
}

/** Sprite sheet frame definition for a single animation */
export interface SpriteFrameDef {
  animation: SpriteAnimation
  direction: SpriteDirection
  frames: number
  row: number
  loop: boolean
}
