import { useLocale } from '@/locales'

export const PERSONALITY_TRAIT_KEYS = [
  'cautious', 'aggressive', 'charismatic', 'quiet', 'paranoid',
  'analytical', 'manipulative', 'friendly', 'resourceful', 'naive',
  'stubborn', 'empathetic', 'cunning', 'leader', 'observant',
  'impulsive', 'strategic', 'trusting', 'skeptical', 'creative',
] as const

export type PersonalityTrait = typeof PERSONALITY_TRAIT_KEYS[number]

export function getTraitLabel(key: PersonalityTrait): string {
  const locale = useLocale()
  return locale.agents.traits[key]
}

export const GOAL_PRESET_KEYS = [
  'hoardSupplies', 'becomeLeader', 'buildRadioTower', 'escapeAlone',
  'exposeTruth', 'startReligion', 'saboteur', 'sowDistrust',
  'protectEveryone', 'fakeScientist',
] as const

export type GoalPresetKey = typeof GOAL_PRESET_KEYS[number]

export function getGoalPreset(key: GoalPresetKey) {
  const locale = useLocale()
  return locale.agents.goalPresets[key]
}

export const LLM_MODELS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
]

export const DEFAULT_LLM_MODEL = 'claude-sonnet-4-6'
export const MAX_PERSONALITY_TRAITS = 4
export const MIN_AGENTS = 6
export const MAX_AGENTS = 12

/** Default personality axes (matches backend PersonalityAxes) */
export const DEFAULT_PERSONALITY_AXES = {
  paranoia: 50,
  empathy: 50,
  dominance: 50,
  impulsiveness: 50,
  loyalty: 50,
  ambition: 50,
} as const

/** Maps frontend trait tags to backend personality axis biases */
export const TRAIT_TO_AXES: Record<PersonalityTrait, Partial<Record<string, number>>> = {
  cautious: { impulsiveness: -15, paranoia: 10 },
  aggressive: { dominance: 15, impulsiveness: 15 },
  charismatic: { empathy: 10, dominance: 10 },
  quiet: { dominance: -15, empathy: 5 },
  paranoid: { paranoia: 25 },
  analytical: { impulsiveness: -20, paranoia: 5 },
  manipulative: { dominance: 15, ambition: 15, empathy: -10 },
  friendly: { empathy: 20, loyalty: 10 },
  resourceful: { ambition: 10, impulsiveness: -5 },
  naive: { paranoia: -20, empathy: 10 },
  stubborn: { dominance: 10, loyalty: 15 },
  empathetic: { empathy: 25, loyalty: 10 },
  cunning: { ambition: 15, paranoia: 5, impulsiveness: -10 },
  leader: { dominance: 20, ambition: 15 },
  observant: { paranoia: 10, impulsiveness: -10 },
  impulsive: { impulsiveness: 25, paranoia: -5 },
  strategic: { ambition: 15, impulsiveness: -15 },
  trusting: { paranoia: -20, loyalty: 15 },
  skeptical: { paranoia: 15, empathy: -5 },
  creative: { impulsiveness: 10, ambition: 10 },
}

import type { GoalArchetype } from '@/types/agent'

/** Maps goal presets to backend GoalArchetype */
export const GOAL_ARCHETYPE_MAP: Record<GoalPresetKey, GoalArchetype> = {
  hoardSupplies: 'resource_control',
  becomeLeader: 'status_power',
  buildRadioTower: 'communal_survival',
  escapeAlone: 'escape_exit',
  exposeTruth: 'truth_revelation',
  startReligion: 'belief_transformation',
  saboteur: 'social_disruption',
  sowDistrust: 'social_disruption',
  protectEveryone: 'protective_attachment',
  fakeScientist: 'obsession_desire',
}
