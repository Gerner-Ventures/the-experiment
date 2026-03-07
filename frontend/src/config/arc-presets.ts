import { useLocale } from '@/locales'

export interface ArcTimelineAct {
  name: string
  rounds: string
  tone: string
  color: string
}

export interface ArcPreset {
  id: string
  name: string
  acts: number
  description: string
  timeline: ArcTimelineAct[]
}

type ArcPresetKey = 'lordOfTheFlies' | 'slowBurn' | 'chaosFromRound1' | 'theLongPeace'

interface ArcPresetDef {
  id: string
  key: ArcPresetKey
  acts: number
  timeline: { actKey: string; rounds: string; color: string }[]
}

const ARC_DEFINITIONS: ArcPresetDef[] = [
  {
    id: 'lord-of-the-flies',
    key: 'lordOfTheFlies',
    acts: 3,
    timeline: [
      { actKey: 'falsePeace', rounds: '1-5', color: '#00e5a0' },
      { actKey: 'theFracture', rounds: '6-10', color: '#f5c542' },
      { actKey: 'theReckoning', rounds: '11-15', color: '#f54242' },
    ],
  },
  {
    id: 'slow-burn',
    key: 'slowBurn',
    acts: 5,
    timeline: [
      { actKey: 'arrival', rounds: '1-3', color: '#00e5a0' },
      { actKey: 'settlingIn', rounds: '4-6', color: '#00b37d' },
      { actKey: 'firstCracks', rounds: '7-9', color: '#f5c542' },
      { actKey: 'erosion', rounds: '10-12', color: '#f57542' },
      { actKey: 'collapse', rounds: '13-15', color: '#f54242' },
    ],
  },
  {
    id: 'chaos-from-round-1',
    key: 'chaosFromRound1',
    acts: 2,
    timeline: [
      { actKey: 'panic', rounds: '1-8', color: '#f57542' },
      { actKey: 'endgame', rounds: '9-15', color: '#f54242' },
    ],
  },
  {
    id: 'the-long-peace',
    key: 'theLongPeace',
    acts: 3,
    timeline: [
      { actKey: 'goldenAge', rounds: '1-9', color: '#00e5a0' },
      { actKey: 'shock', rounds: '10-12', color: '#f57542' },
      { actKey: 'aftermath', rounds: '13-15', color: '#f54242' },
    ],
  },
]

export function getArcPresets(): ArcPreset[] {
  const locale = useLocale()
  return ARC_DEFINITIONS.map((def) => {
    const preset = locale.arcs.presets[def.key]
    return {
      id: def.id,
      name: preset.name,
      acts: def.acts,
      description: preset.description,
      timeline: def.timeline.map((act) => {
        const actLocale = (preset.acts as Record<string, { name: string; tone: string }>)[act.actKey]
        if (!actLocale) {
          throw new Error(`Missing locale for arc "${def.key}", act "${act.actKey}"`)
        }
        return {
          name: actLocale.name,
          rounds: act.rounds,
          tone: actLocale.tone,
          color: act.color,
        }
      }),
    }
  })
}
