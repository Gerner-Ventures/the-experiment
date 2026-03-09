import type { HDAnimationDef, HDPoseName } from './types'

/**
 * HD Animation Registry.
 * Every animation uses HD pose names and PixiJS AnimatedSprite timing.
 * Speed is frames-per-tick (0.1 = ~6fps at 60fps ticker).
 */
export const HD_ANIMATION_REGISTRY: Record<string, HDAnimationDef> = {
  // ─── Locomotion ───
  walk: { name: 'walk', poses: ['walk1', 'walk2'], speed: 0.12, loop: true },

  // ─── Combat ───
  attack: { name: 'attack', poses: ['idle', 'lookR', 'punch1', 'punch1', 'punch2', 'punch2', 'punch2', 'idle'], speed: 0.12, loop: false },
  stab: { name: 'stab', poses: ['idle', 'lookR', 'stab1', 'stab1', 'stab2', 'stab2', 'stab2', 'idle'], speed: 0.12, loop: false },
  shoot: { name: 'shoot', poses: ['idle', 'lookR', 'shoot1', 'shoot1', 'shoot2', 'shoot2', 'shoot1', 'shoot2', 'idle'], speed: 0.12, loop: false },
  threaten: { name: 'threaten', poses: ['idle', 'lookR', 'threaten1', 'threaten1', 'threaten2', 'threaten2', 'idle'], speed: 0.10, loop: false },

  // ─── Social ───
  talk: { name: 'talk', poses: ['idle', 'talk1', 'talk2', 'talk1', 'talk2', 'idle'], speed: 0.10, loop: false },
  dance: { name: 'dance', poses: ['dance1', 'dance2', 'dance1', 'dance2', 'dance1', 'dance2', 'idle'], speed: 0.10, loop: false },
  wave: { name: 'wave', poses: ['idle', 'wave1', 'wave2', 'wave1', 'wave2', 'idle'], speed: 0.10, loop: false },
  argue: { name: 'argue', poses: ['idle', 'argue1', 'argue2', 'argue1', 'argue2', 'idle'], speed: 0.10, loop: false },
  rally: { name: 'rally', poses: ['idle', 'rally1', 'rally2', 'rally1', 'rally2', 'rally1', 'rally2', 'idle'], speed: 0.10, loop: false },
  celebrate: { name: 'celebrate', poses: ['idle', 'celebrate1', 'celebrate2', 'celebrate1', 'celebrate2', 'idle'], speed: 0.10, loop: false },
  monologue: { name: 'monologue', poses: ['idle', 'monologue1', 'monologue2', 'monologue1', 'monologue2', 'idle'], speed: 0.08, loop: false },

  // ─── Emotional ───
  panic: { name: 'panic', poses: ['panic1', 'panic2', 'panic1', 'panic2', 'panic1', 'panic2', 'idle'], speed: 0.12, loop: false },
  pray: { name: 'pray', poses: ['idle', 'pray', 'pray', 'pray', 'pray', 'idle'], speed: 0.06, loop: false },
  mourn: { name: 'mourn', poses: ['idle', 'mourn', 'mourn', 'mourn', 'mourn', 'idle'], speed: 0.06, loop: false },
  breakdown: { name: 'breakdown', poses: ['idle', 'breakdown1', 'breakdown1', 'breakdown2', 'breakdown2', 'breakdown1', 'idle'], speed: 0.08, loop: false },

  // ─── Biological ───
  pee: { name: 'pee', poses: ['idle', 'pee', 'pee', 'pee', 'pee', 'idle'], speed: 0.08, loop: false },
  poop: { name: 'poop', poses: ['idle', 'poop', 'poop', 'poop', 'poop', 'idle'], speed: 0.06, loop: false },
  vomit: { name: 'vomit', poses: ['idle', 'vomit', 'vomit', 'vomit', 'idle'], speed: 0.10, loop: false },
  sleep: { name: 'sleep', poses: ['sleep', 'sleep', 'sleep', 'sleep', 'idle'], speed: 0.04, loop: false },
  eat: { name: 'eat', poses: ['idle', 'eat1', 'eat2', 'eat1', 'eat2', 'idle'], speed: 0.08, loop: false },
  drink: { name: 'drink', poses: ['idle', 'drink1', 'drink1', 'drink2', 'drink2', 'drink1', 'idle'], speed: 0.08, loop: false },

  // ─── Resource/Utility ───
  gather: { name: 'gather', poses: ['idle', 'gather1', 'gather2', 'gather1', 'gather2', 'idle'], speed: 0.10, loop: false },
  repair: { name: 'repair', poses: ['idle', 'repair1', 'repair2', 'repair1', 'repair2', 'idle'], speed: 0.10, loop: false },
  trade: { name: 'trade', poses: ['idle', 'trade1', 'trade2', 'trade1', 'idle'], speed: 0.08, loop: false },
  observe: { name: 'observe', poses: ['idle', 'observe1', 'observe1', 'observe2', 'observe3', 'observe3', 'observe4', 'observe4', 'observe3', 'observe4', 'observe2', 'observe1', 'idle'], speed: 0.08, loop: false },
  investigate: { name: 'investigate', poses: ['idle', 'investigate1', 'investigate2', 'investigate3', 'investigate3', 'investigate4', 'investigate4', 'investigate3', 'investigate2', 'investigate1', 'idle'], speed: 0.08, loop: false },
  rest: { name: 'rest', poses: ['idle', 'rest', 'rest', 'rest', 'rest', 'idle'], speed: 0.04, loop: false },
  explore: { name: 'explore', poses: ['idle', 'explore1', 'explore1', 'explore2', 'explore2', 'explore3', 'explore3', 'explore4', 'explore4', 'idle'], speed: 0.10, loop: false },
  vote: { name: 'vote', poses: ['idle', 'vote', 'vote', 'vote', 'idle'], speed: 0.08, loop: false },

  // ─── Selfish/Hostile ───
  hoard: { name: 'hoard', poses: ['idle', 'hoard1', 'hoard2', 'hoard1', 'hoard2', 'idle'], speed: 0.10, loop: false },
  sabotage: { name: 'sabotage', poses: ['idle', 'sabotage1', 'sabotage2', 'sabotage1', 'sabotage2', 'idle'], speed: 0.10, loop: false },
  steal: { name: 'steal', poses: ['idle', 'steal1', 'steal2', 'steal1', 'idle'], speed: 0.10, loop: false },
  accuse: { name: 'accuse', poses: ['idle', 'lookR', 'accuse1', 'accuse2', 'accuse1', 'accuse2', 'idle'], speed: 0.10, loop: false },
  poison: { name: 'poison', poses: ['idle', 'poison1', 'poison1', 'poison2', 'poison2', 'idle'], speed: 0.08, loop: false },

  // ─── Special ───
  self_sacrifice: { name: 'self_sacrifice', poses: ['idle', 'self_sacrifice', 'self_sacrifice', 'self_sacrifice', 'idle'], speed: 0.06, loop: false },
  think: { name: 'think', poses: ['idle', 'lookR', 'think', 'think', 'think', 'think', 'idle'], speed: 0.06, loop: false },
  tongue: { name: 'tongue', poses: ['idle', 'tongue', 'tongue', 'tongue', 'idle'], speed: 0.08, loop: false },

  // ─── Consequence reactions ───
  dead: { name: 'dead', poses: ['idle', 'dead', 'dead', 'dead', 'dead'], speed: 0.08, loop: false },
  injured: { name: 'injured', poses: ['idle', 'injured', 'injured', 'injured', 'idle'], speed: 0.06, loop: false },
  stunned: { name: 'stunned', poses: ['stunned', 'stunned', 'stunned', 'stunned', 'idle'], speed: 0.08, loop: false },
  knocked_down: { name: 'knocked_down', poses: ['idle', 'knocked_down', 'knocked_down', 'knocked_down'], speed: 0.08, loop: false },
  fleeing: { name: 'fleeing', poses: ['fleeing1', 'fleeing2', 'fleeing1', 'fleeing2'], speed: 0.15, loop: true },
  bleeding: { name: 'bleeding', poses: ['injured', 'injured', 'injured'], speed: 0.04, loop: false },
  burning: { name: 'burning', poses: ['panic1', 'panic2', 'panic1', 'panic2'], speed: 0.15, loop: true },
  poisoned: { name: 'poisoned', poses: ['idle', 'vomit', 'idle', 'vomit'], speed: 0.08, loop: false },
  crying: { name: 'crying', poses: ['mourn', 'mourn', 'breakdown1', 'mourn'], speed: 0.06, loop: false },
}

/**
 * Maps every game action type to an HD animation.
 * 1:1 mapping — no shared animations.
 */
export const HD_ACTION_TO_ANIMATION: Record<string, string> = {
  // Cooperative
  move: 'walk',
  gather: 'gather',
  repair: 'repair',
  trade: 'trade',
  talk: 'talk',
  vote: 'vote',
  rest: 'rest',
  observe: 'observe',

  // Selfish
  hoard: 'hoard',
  sabotage: 'sabotage',
  explore: 'explore',
  accuse: 'accuse',
  steal: 'steal',

  // Aggressive
  attack: 'attack',
  threaten: 'threaten',
  stab: 'stab',
  shoot: 'shoot',
  poison: 'poison',

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

  // Meeting
  meeting_speech: 'talk',
  meeting_vote: 'vote',

  // Meta
  investigate: 'investigate',
  monologue: 'monologue',
  panic: 'panic',
  breakdown: 'breakdown',
  self_sacrifice: 'self_sacrifice',

  // Consequences
  bleeding: 'bleeding',
  injured: 'injured',
  stunned: 'stunned',
  knocked_down: 'knocked_down',
  burning: 'burning',
  poisoned: 'poisoned',
  crying: 'crying',
  fleeing: 'fleeing',
}

/** Default fallback HD animation */
export const HD_FALLBACK_ANIMATION: HDAnimationDef = {
  name: 'fallback',
  poses: ['idle', 'wave1', 'wave2', 'wave1', 'wave2', 'idle'] as HDPoseName[],
  speed: 0.10,
  loop: false,
}

/**
 * Look up an HD animation by name with fallback.
 */
export function getHDAnimation(name: string): HDAnimationDef {
  const anim = HD_ANIMATION_REGISTRY[name]
  if (anim) return anim
  return HD_FALLBACK_ANIMATION
}

/**
 * Map a game action type to an HD animation with fallback.
 */
export function getHDAnimationForAction(actionType: string): HDAnimationDef {
  const animName = HD_ACTION_TO_ANIMATION[actionType]
  if (animName) return getHDAnimation(animName)
  return HD_FALLBACK_ANIMATION
}

/** Non-looping HD animations for random playback */
export const HD_SILLY_ANIMATIONS: HDAnimationDef[] = Object.values(HD_ANIMATION_REGISTRY).filter(a => !a.loop)
