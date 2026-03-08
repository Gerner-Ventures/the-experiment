import type { GoalArchetype } from '@/types/agent'

/** Color map for agent goal archetypes */
export const ARCHETYPE_COLORS: Record<GoalArchetype, string> = {
  communal_survival: '#34d399',     // green
  protective_attachment: '#60a5fa', // blue
  status_power: '#fbbf24',         // gold
  resource_control: '#f97316',     // orange
  escape_exit: '#a78bfa',          // purple
  truth_revelation: '#38bdf8',     // cyan
  social_disruption: '#f43f5e',    // red
  belief_transformation: '#e879f9',// magenta
  personal_redemption: '#94a3b8',  // slate
  obsession_desire: '#fb7185',     // rose
}

/** Force simulation parameters */
export const FORCE_CONFIG = {
  chargeStrength: -200,
  linkDistance: 100,
  centerStrength: 0.05,
  alphaDecay: 0.02,
  alphaTarget: 0,
  alphaNudge: 0.3,
} as const

/** Map trust value (-100..100) to edge color */
export function trustToColor(trust: number): string {
  if (trust > 50) return '#00e5a0'
  if (trust > 20) return '#34d399'
  if (trust > -20) return '#555863'
  if (trust > -50) return '#f57542'
  return '#f54242'
}

/** Map interaction history length to edge thickness (1-5px) */
export function interactionThickness(count: number): number {
  return Math.min(5, Math.max(1, Math.ceil(count / 2)))
}
