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
