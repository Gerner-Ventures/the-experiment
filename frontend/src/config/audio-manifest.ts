/**
 * Audio manifest — maps theme IDs to audio file paths for each layer.
 *
 * Layers:
 * - ambient: Looping background soundscape per theme
 * - weather: Looping weather effect audio
 * - sfx: One-shot event sounds (theme-specific variants)
 *
 * File paths are relative to /assets/audio/. Assets are lazy-loaded.
 * Placeholder assets (generated tones) are used initially — replace
 * with real OGG files later without code changes.
 */

export interface ThemeAudioManifest {
  ambient: string
  weather: Record<string, string>
  sfx: Record<string, string>
}

export type SFXEvent =
  | 'spawn'
  | 'conversation'
  | 'vote'
  | 'elimination'
  | 'round_start'
  | 'consequence'

export type WeatherType = 'rain' | 'code_rain' | 'dust_storm' | 'smog'

const BASE = '/assets/audio'

export const AUDIO_MANIFEST: Record<string, ThemeAudioManifest> = {
  'lord-of-the-flies': {
    ambient: `${BASE}/ambient/castaway-island.ogg`,
    weather: {
      rain: `${BASE}/weather/rain.ogg`,
    },
    sfx: {
      spawn: `${BASE}/sfx/castaway-island/spawn.ogg`,
      conversation: `${BASE}/sfx/castaway-island/conversation.ogg`,
      vote: `${BASE}/sfx/castaway-island/vote.ogg`,
      elimination: `${BASE}/sfx/castaway-island/elimination.ogg`,
      round_start: `${BASE}/sfx/castaway-island/round-start.ogg`,
      consequence: `${BASE}/sfx/castaway-island/consequence.ogg`,
    },
  },
  'matrix': {
    ambient: `${BASE}/ambient/the-construct.ogg`,
    weather: {
      code_rain: `${BASE}/weather/code-rain.ogg`,
    },
    sfx: {
      spawn: `${BASE}/sfx/the-construct/spawn.ogg`,
      conversation: `${BASE}/sfx/the-construct/conversation.ogg`,
      vote: `${BASE}/sfx/the-construct/vote.ogg`,
      elimination: `${BASE}/sfx/the-construct/elimination.ogg`,
      round_start: `${BASE}/sfx/the-construct/round-start.ogg`,
      consequence: `${BASE}/sfx/the-construct/consequence.ogg`,
    },
  },
  'gladiator': {
    ambient: `${BASE}/ambient/the-arena.ogg`,
    weather: {
      dust_storm: `${BASE}/weather/dust-storm.ogg`,
    },
    sfx: {
      spawn: `${BASE}/sfx/the-arena/spawn.ogg`,
      conversation: `${BASE}/sfx/the-arena/conversation.ogg`,
      vote: `${BASE}/sfx/the-arena/vote.ogg`,
      elimination: `${BASE}/sfx/the-arena/elimination.ogg`,
      round_start: `${BASE}/sfx/the-arena/round-start.ogg`,
      consequence: `${BASE}/sfx/the-arena/consequence.ogg`,
    },
  },
  '1984': {
    ambient: `${BASE}/ambient/sector-7g.ogg`,
    weather: {
      smog: `${BASE}/weather/smog.ogg`,
    },
    sfx: {
      spawn: `${BASE}/sfx/sector-7g/spawn.ogg`,
      conversation: `${BASE}/sfx/sector-7g/conversation.ogg`,
      vote: `${BASE}/sfx/sector-7g/vote.ogg`,
      elimination: `${BASE}/sfx/sector-7g/elimination.ogg`,
      round_start: `${BASE}/sfx/sector-7g/round-start.ogg`,
      consequence: `${BASE}/sfx/sector-7g/consequence.ogg`,
    },
  },
}
