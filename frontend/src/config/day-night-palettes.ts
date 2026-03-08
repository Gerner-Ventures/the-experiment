import type { RoundPhase } from '@/types/websocket'

/** Maps each game phase to a 0-1 position on the celestial arc */
export const PHASE_ARC_POSITIONS: Record<RoundPhase, number> = {
  gm_plan: -1,      // -1 = no transition (inherit previous)
  dawn: 0.05,        // sun just peeking above left horizon
  morning: 0.2,      // sun on the left side of the sky
  midday: 0.5,       // sun at apex (center)
  afternoon: 0.8,    // sun on the right side of the sky, still elevated
  night: 1.0,        // sun gone, moon visible
}

export interface PhasePalette {
  skyTop: string          // sky gradient top color
  skyBottom: string       // sky gradient bottom color
  filterBrightness: number  // ColorMatrixFilter brightness (1.0=normal, 0.5=dark)
  sunAlpha: number        // sun visibility (0-1)
  moonAlpha: number       // moon visibility (0-1)
  starOpacity: number     // 0=no stars, 1=full
}

export interface ThemeDayNightPalette {
  themeId: string
  celestialVariant?: 'standard' | 'digital'
  sunColor: string
  sunGlowColor: string
  moonColor: string
  moonGlowColor: string
  phases: Partial<Record<RoundPhase, PhasePalette>>
}

const PALETTES: ThemeDayNightPalette[] = [
  {
    themeId: 'lord-of-the-flies',
    sunColor: '#ffdd44',
    sunGlowColor: '#ffaa00',
    moonColor: '#ddeeff',
    moonGlowColor: '#8899cc',
    phases: {
      dawn:      { skyTop: '#ff9966', skyBottom: '#ffcc88', filterBrightness: 0.85, sunAlpha: 0.9, moonAlpha: 0, starOpacity: 0 },
      morning:   { skyTop: '#7bb8e0', skyBottom: '#c8e4f4', filterBrightness: 0.95, sunAlpha: 1.0, moonAlpha: 0, starOpacity: 0 },
      midday:    { skyTop: '#87ceeb', skyBottom: '#e0f0ff', filterBrightness: 1.0,  sunAlpha: 1.0, moonAlpha: 0, starOpacity: 0 },
      afternoon: { skyTop: '#e09050', skyBottom: '#f0c890', filterBrightness: 0.8,  sunAlpha: 0.9, moonAlpha: 0, starOpacity: 0 },
      night:     { skyTop: '#0a1428', skyBottom: '#1a2040', filterBrightness: 0.55, sunAlpha: 0,   moonAlpha: 0.9, starOpacity: 1.0 },
    },
  },
  {
    themeId: 'matrix',
    celestialVariant: 'digital',
    sunColor: '#00ff41',
    sunGlowColor: '#00cc33',
    moonColor: '#00ff41',
    moonGlowColor: '#00cc33',
    phases: {
      dawn:      { skyTop: '#001100', skyBottom: '#002200', filterBrightness: 0.9,  sunAlpha: 0.6, moonAlpha: 0, starOpacity: 0 },
      morning:   { skyTop: '#000d00', skyBottom: '#001a00', filterBrightness: 0.95, sunAlpha: 0.8, moonAlpha: 0, starOpacity: 0 },
      midday:    { skyTop: '#000d00', skyBottom: '#001a00', filterBrightness: 1.0,  sunAlpha: 1.0, moonAlpha: 0, starOpacity: 0 },
      afternoon: { skyTop: '#000a00', skyBottom: '#001400', filterBrightness: 0.9,  sunAlpha: 0.7, moonAlpha: 0, starOpacity: 0 },
      night:     { skyTop: '#000800', skyBottom: '#001200', filterBrightness: 0.8,  sunAlpha: 0,   moonAlpha: 0.8, starOpacity: 0 },
    },
  },
  {
    themeId: 'gladiator',
    sunColor: '#ffffff',
    sunGlowColor: '#ffeecc',
    moonColor: '#fff5e0',
    moonGlowColor: '#ccaa77',
    phases: {
      dawn:      { skyTop: '#cc7744', skyBottom: '#ddaa66', filterBrightness: 0.8,  sunAlpha: 0.9, moonAlpha: 0, starOpacity: 0 },
      morning:   { skyTop: '#ddc088', skyBottom: '#eee0c0', filterBrightness: 0.95, sunAlpha: 1.0, moonAlpha: 0, starOpacity: 0 },
      midday:    { skyTop: '#f0e8d0', skyBottom: '#fffff0', filterBrightness: 1.05, sunAlpha: 1.0, moonAlpha: 0, starOpacity: 0 },
      afternoon: { skyTop: '#cc8855', skyBottom: '#ddbb88', filterBrightness: 0.75, sunAlpha: 0.9, moonAlpha: 0, starOpacity: 0 },
      night:     { skyTop: '#1a1030', skyBottom: '#251840', filterBrightness: 0.55, sunAlpha: 0,   moonAlpha: 0.9, starOpacity: 1.0 },
    },
  },
  {
    themeId: '1984',
    sunColor: '#ff8844',
    sunGlowColor: '#cc5500',
    moonColor: '#554433',
    moonGlowColor: '#332211',
    phases: {
      dawn:      { skyTop: '#332211', skyBottom: '#553322', filterBrightness: 0.7,  sunAlpha: 0.6, moonAlpha: 0, starOpacity: 0 },
      morning:   { skyTop: '#443322', skyBottom: '#665544', filterBrightness: 0.8,  sunAlpha: 0.7, moonAlpha: 0, starOpacity: 0 },
      midday:    { skyTop: '#555544', skyBottom: '#887766', filterBrightness: 0.85, sunAlpha: 0.8, moonAlpha: 0, starOpacity: 0 },
      afternoon: { skyTop: '#443322', skyBottom: '#664433', filterBrightness: 0.7,  sunAlpha: 0.8, moonAlpha: 0, starOpacity: 0 },
      night:     { skyTop: '#0f0810', skyBottom: '#1a1018', filterBrightness: 0.5,  sunAlpha: 0,   moonAlpha: 0.6, starOpacity: 0.8 },
    },
  },
]

export function getThemePalette(themeId: string): ThemeDayNightPalette | undefined {
  return PALETTES.find(p => p.themeId === themeId)
}
