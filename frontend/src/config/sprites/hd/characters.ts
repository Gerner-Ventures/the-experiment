import type { BasePalette, HDCharacterDef, HairStyle } from './types'

// ─── Skin tone presets ───

const SKIN_LIGHT: Pick<BasePalette, 'skin' | 'skinShadow'> = { skin: '#f5d0a9', skinShadow: '#d4a574' }
const SKIN_MED: Pick<BasePalette, 'skin' | 'skinShadow'> = { skin: '#c68c53', skinShadow: '#a06830' }
const SKIN_DARK: Pick<BasePalette, 'skin' | 'skinShadow'> = { skin: '#8b5e3c', skinShadow: '#6b4226' }
const SKIN_PALE: Pick<BasePalette, 'skin' | 'skinShadow'> = { skin: '#ffe0cc', skinShadow: '#e0b8a0' }
const OUTLINE = '#1a1a2e'

// ─── Hair mapping ───

const HAIR_MAP: Record<number, HairStyle> = { 6: 3, 7: 1 }

function mapHairStyle(oldHair: number): HairStyle {
  if (oldHair >= 0 && oldHair <= 5) return oldHair as HairStyle
  return HAIR_MAP[oldHair] ?? 0
}

// ─── Character palette + hair definitions ───

interface CharacterSeed {
  id: string
  palette: BasePalette
  hair: number
}

const CHARACTER_SEEDS: CharacterSeed[] = [
  // Lab rats
  { id: 'intern', palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#6b4423', hairHighlight: '#8b6243', outfitPrimary: '#4a7c59', outfitSecondary: '#ffffff', shoe: '#3d3d3d', accessory: '#f0c040', accessoryAlt: '#ffffff' }, hair: 1 },
  { id: 'patient-zero', palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#2a2a3a', hairHighlight: '#3a3a4a', outfitPrimary: '#5a8a8a', outfitSecondary: '#4a7a7a', shoe: '#3d3d3d', accessory: '#88cccc' }, hair: 3 },
  { id: 'volunteer', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#c4783c', hairHighlight: '#e09050', outfitPrimary: '#cc4444', outfitSecondary: '#ffffff', shoe: '#5a3a2a' }, hair: 0 },
  { id: 'whistleblower', palette: { outline: OUTLINE, ...SKIN_MED, hair: '#1a1a1a', hairHighlight: '#333333', outfitPrimary: '#3a5a3a', outfitSecondary: '#2a4a2a', shoe: '#2a2a2a', accessory: '#888888', accessoryAlt: '#aaaaaa' }, hair: 3 },
  // Authority figures
  { id: 'middle-mgmt', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#4a3a2a', hairHighlight: '#6a5a4a', outfitPrimary: '#2a3a5a', outfitSecondary: '#cc3333', shoe: '#1a1a1a' }, hair: 1 },
  { id: 'hall-monitor', palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#8a6a3a', hairHighlight: '#aa8a5a', outfitPrimary: '#4a4a6a', outfitSecondary: '#ff8800', shoe: '#2a2a2a', accessory: '#ddaa44', accessoryAlt: '#ffffff' }, hair: 7 },
  { id: 'influencer', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#e8c840', hairHighlight: '#f0d860', outfitPrimary: '#e05090', outfitSecondary: '#ffffff', shoe: '#ffffff' }, hair: 2 },
  { id: 'politician', palette: { outline: OUTLINE, ...SKIN_MED, hair: '#555555', hairHighlight: '#777777', outfitPrimary: '#1a2a4a', outfitSecondary: '#aa2222', shoe: '#1a1a1a' }, hair: 1 },
  // Survivors
  { id: 'prepper', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#3a2a1a', hairHighlight: '#5a4a3a', outfitPrimary: '#5a6a3a', outfitSecondary: '#4a5a2a', shoe: '#3a3a2a', accessory: '#7a8a5a' }, hair: 3 },
  { id: 'medic', palette: { outline: OUTLINE, ...SKIN_DARK, hair: '#1a1a1a', hairHighlight: '#2a2a2a', outfitPrimary: '#ffffff', outfitSecondary: '#cc3333', shoe: '#ffffff', accessory: '#cc3333', accessoryAlt: '#ffffff' }, hair: 3 },
  { id: 'engineer', palette: { outline: OUTLINE, ...SKIN_MED, hair: '#2a2a2a', hairHighlight: '#3a3a3a', outfitPrimary: '#cc8833', outfitSecondary: '#aa6622', shoe: '#5a4a3a', accessory: '#ffcc00' }, hair: 0 },
  { id: 'chef', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#1a1a1a', hairHighlight: '#2a2a2a', outfitPrimary: '#ffffff', outfitSecondary: '#ffffff', shoe: '#2a2a2a', accessory: '#ffffff' }, hair: 6 },
  // Wildcards
  { id: 'philosopher', palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#aaaaaa', hairHighlight: '#cccccc', outfitPrimary: '#6a5a4a', outfitSecondary: '#5a4a3a', shoe: '#4a3a2a', accessory: '#998877', accessoryAlt: '#776655' }, hair: 2 },
  { id: 'child', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#cc6633', hairHighlight: '#ee8855', outfitPrimary: '#5588cc', outfitSecondary: '#ffffff', shoe: '#cc4444' }, hair: 5 },
  { id: 'therapist', palette: { outline: OUTLINE, ...SKIN_DARK, hair: '#2a1a1a', hairHighlight: '#4a3a3a', outfitPrimary: '#7a6a8a', outfitSecondary: '#6a5a7a', shoe: '#3a3a3a', accessory: '#aa9977', accessoryAlt: '#ffffff' }, hair: 5 },
  { id: 'con-artist', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#1a1a1a', hairHighlight: '#333333', outfitPrimary: '#2a2a2a', outfitSecondary: '#aa8833', shoe: '#1a1a1a' }, hair: 1 },
  // Dark humor specials
  { id: 'nihilist', palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#1a1a1a', hairHighlight: '#2a2a2a', outfitPrimary: '#1a1a1a', outfitSecondary: '#2a2a2a', shoe: '#1a1a1a' }, hair: 4 },
  { id: 'optimist', palette: { outline: OUTLINE, ...SKIN_MED, hair: '#dd8833', hairHighlight: '#eeaa55', outfitPrimary: '#f0c030', outfitSecondary: '#ffffff', shoe: '#dd7722' }, hair: 5 },
  { id: 'conspiracy', palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#5a3a2a', hairHighlight: '#7a5a4a', outfitPrimary: '#4a5a3a', outfitSecondary: '#3a4a2a', shoe: '#3a3a3a', accessory: '#888888', accessoryAlt: '#aaaaaa' }, hair: 2 },
  { id: 'sleeper', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#5a4a3a', hairHighlight: '#7a6a5a', outfitPrimary: '#6a7a8a', outfitSecondary: '#5a6a7a', shoe: '#4a4a5a' }, hair: 5 },
  { id: 'clone', palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#aaaacc', hairHighlight: '#ccccee', outfitPrimary: '#8888aa', outfitSecondary: '#7777aa', shoe: '#6666aa', accessory: '#aaaacc', accessoryAlt: '#ffffff' }, hair: 3 },
  { id: 'mascot', palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#ff5555', hairHighlight: '#ff7777', outfitPrimary: '#ff5555', outfitSecondary: '#ffcc00', shoe: '#ff3333', accessory: '#ff3333' }, hair: 5 },
]

// ─── HD Character Definitions ───

export const HD_CHARACTER_SPRITES: HDCharacterDef[] = CHARACTER_SEEDS.map(seed => ({
  id: seed.id,
  basePalette: seed.palette,
  hairStyle: mapHairStyle(seed.hair),
  bodyType: seed.id === 'child' ? 'small' : 'standard',
  accessories: {},
  rosyCheeks: seed.id === 'child',
}))

const HD_SPRITE_MAP = new Map(HD_CHARACTER_SPRITES.map(s => [s.id, s]))

export function getHDSpriteById(id: string): HDCharacterDef | undefined {
  return HD_SPRITE_MAP.get(id)
}

// ─── Backward-compatible exports ───

/** @deprecated Use HDCharacterDef and getHDSpriteById instead */
export function getSpriteById(id: string): HDCharacterDef | undefined {
  return HD_SPRITE_MAP.get(id)
}
