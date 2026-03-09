/** Actions that have aggressive/violent intent — used for visual emphasis (red labels, red highlight rings) */
export const AGGRESSIVE_ACTIONS = new Set([
  'attack', 'stab', 'shoot', 'threaten', 'poison',
])

/** Actions that skip the acting phase (animation redundant with idle/movement) */
export const SKIP_ACTION_PHASE = new Set(['move', 'rest', 'explore'])

/** Actions that skip both movement and acting phases — go straight to speech bubble */
export const SPEECH_ONLY_ACTIONS = new Set(['meeting_speech', 'meeting_vote'])

/** Actions where the bubble represents spoken dialog (not internal thoughts) */
export const SPOKEN_ACTIONS = new Set([
  'talk', 'argue', 'accuse', 'threaten', 'rally', 'monologue',
  'meeting_speech', 'meeting_vote',
])
