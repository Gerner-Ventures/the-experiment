import type { AnimationDef, PoseName } from './types'

/**
 * Unified animation registry.
 * Every animation has a name, frame sequence (PoseNames), and timing.
 * loop: true = repeats indefinitely (walk); loop: false/undefined = plays once then stops.
 */
export const ANIMATION_REGISTRY: Record<string, AnimationDef> = {
  // Locomotion
  walk: { name: 'walk', frames: ['walk1', 'walk2'], frameMs: 200, loop: true },

  // Silly / one-shot animations
  dance: { name: 'dance', frames: ['dance1', 'dance2', 'dance1', 'dance2', 'dance1', 'dance2', 'idle'], frameMs: 250 },
  panic: { name: 'panic', frames: ['panic1', 'panic2', 'panic1', 'panic2', 'panic1', 'panic2', 'idle'], frameMs: 200 },
  wave: { name: 'wave', frames: ['wave1', 'wave2', 'wave1', 'wave2', 'idle'], frameMs: 300 },
  pee: { name: 'pee', frames: ['idle', 'pee', 'pee', 'pee', 'pee', 'idle'], frameMs: 400 },
  poop: { name: 'poop', frames: ['idle', 'poop', 'poop', 'poop', 'poop', 'idle'], frameMs: 500 },
  vomit: { name: 'vomit', frames: ['idle', 'vomit', 'vomit', 'vomit', 'idle'], frameMs: 350 },
  stab: { name: 'stab', frames: ['idle', 'stab', 'idle', 'stab', 'idle'], frameMs: 200 },
  shoot: { name: 'shoot', frames: ['idle', 'shoot', 'idle', 'shoot', 'idle'], frameMs: 250 },
  sleep: { name: 'sleep', frames: ['sleep', 'sleep', 'sleep', 'sleep', 'idle'], frameMs: 600 },
  dead: { name: 'dead', frames: ['idle', 'dead', 'dead', 'dead', 'dead', 'idle'], frameMs: 500 },

  // New Phase 1 action animations
  talk: { name: 'talk', frames: ['talk1', 'talk2', 'talk1', 'talk2', 'idle'], frameMs: 300 },
  rally: { name: 'rally', frames: ['rally1', 'rally2', 'rally1', 'rally2', 'rally1', 'rally2', 'idle'], frameMs: 250 },
  gather: { name: 'gather', frames: ['idle', 'gather1', 'gather2', 'gather1', 'gather2', 'idle'], frameMs: 350 },
  argue: { name: 'argue', frames: ['argue1', 'argue2', 'argue1', 'argue2', 'idle'], frameMs: 250 },
  think: { name: 'think', frames: ['idle', 'think', 'think', 'think', 'idle'], frameMs: 500 },
}

/** Default fallback animation when a requested animation is not found */
export const FALLBACK_ANIMATION: AnimationDef = {
  name: 'fallback',
  frames: ['wave1', 'wave2', 'wave1', 'wave2', 'idle'] as PoseName[],
  frameMs: 300,
}

/**
 * Maps game action types to animation registry keys.
 * The value must be a key in ANIMATION_REGISTRY.
 */
export const ACTION_TO_ANIMATION: Record<string, string> = {
  // Cooperative
  move: 'walk',
  gather: 'gather',
  repair: 'gather',
  trade: 'talk',
  talk: 'talk',
  vote: 'talk',
  rest: 'wave',
  observe: 'think',
  heal: 'gather',

  // Selfish
  hoard: 'gather',
  sabotage: 'stab',
  explore: 'walk',
  accuse: 'argue',
  steal: 'gather',
  scheme: 'think',

  // Aggressive
  attack: 'stab',
  threaten: 'argue',
  stab: 'stab',
  shoot: 'shoot',
  poison: 'gather',

  // Social / expressive
  dance: 'dance',
  pray: 'think',
  rally: 'rally',
  mourn: 'think',
  celebrate: 'dance',
  argue: 'argue',

  // Biological
  pee: 'pee',
  poop: 'poop',
  vomit: 'vomit',
  sleep: 'sleep',
  eat: 'gather',
  drink: 'gather',

  // Meta
  investigate: 'think',
  monologue: 'talk',
  panic: 'panic',
  breakdown: 'panic',
}

/**
 * Look up an animation by name with fallback.
 * Always returns a valid AnimationDef.
 */
export function getAnimation(name: string): AnimationDef {
  const anim = ANIMATION_REGISTRY[name]
  if (anim) return anim
  console.debug(`[animations] Unknown animation "${name}", using fallback`)
  return FALLBACK_ANIMATION
}

/**
 * Map a game action type to an animation with fallback.
 * Always returns a valid AnimationDef.
 */
export function getAnimationForAction(actionType: string): AnimationDef {
  const animName = ACTION_TO_ANIMATION[actionType]
  if (animName) return getAnimation(animName)
  console.debug(`[animations] No animation mapping for action "${actionType}", using fallback`)
  return FALLBACK_ANIMATION
}

/** Non-looping animations suitable for random playback (config screen, idle behavior) */
export const SILLY_ANIMATIONS: AnimationDef[] = Object.values(ANIMATION_REGISTRY).filter(a => !a.loop)

/** Walk cycle animation reference */
export const WALK_ANIMATION: AnimationDef = ANIMATION_REGISTRY.walk
