/** Actions that have aggressive/violent intent — used for visual emphasis (red labels, red highlight rings) */
export const AGGRESSIVE_ACTIONS = new Set([
  'attack', 'stab', 'shoot', 'threaten', 'poison',
])

/** Actions that skip the acting phase (animation redundant with idle/movement) */
export const SKIP_ACTION_PHASE = new Set(['move', 'rest', 'observe', 'explore'])
