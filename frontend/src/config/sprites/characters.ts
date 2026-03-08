import type { CharacterSprite } from './types'
import { SKIN_LIGHT, SKIN_MED, SKIN_DARK, SKIN_PALE, OUTLINE } from './palettes'

export const CHARACTER_SPRITES: CharacterSprite[] = [
  // Lab rats
  {
    id: 'intern',
    palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#6b4423', hairHighlight: '#8b6243', outfitPrimary: '#4a7c59', outfitSecondary: '#ffffff', shoe: '#3d3d3d', accessory: '#f0c040', accessoryAlt: '#ffffff' },
    body: 0, hair: 1, outfit: 0, accessory: 6,
  },
  {
    id: 'patient-zero',
    palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#2a2a3a', hairHighlight: '#3a3a4a', outfitPrimary: '#5a8a8a', outfitSecondary: '#4a7a7a', shoe: '#3d3d3d', accessory: '#88cccc' },
    body: 0, hair: 3, outfit: 3, accessory: 0,
  },
  {
    id: 'volunteer',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#c4783c', hairHighlight: '#e09050', outfitPrimary: '#cc4444', outfitSecondary: '#ffffff', shoe: '#5a3a2a' },
    body: 0, hair: 0, outfit: 0, accessory: 0,
  },
  {
    id: 'whistleblower',
    palette: { outline: OUTLINE, ...SKIN_MED, hair: '#1a1a1a', hairHighlight: '#333333', outfitPrimary: '#3a5a3a', outfitSecondary: '#2a4a2a', shoe: '#2a2a2a', accessory: '#888888', accessoryAlt: '#aaaaaa' },
    body: 2, hair: 3, outfit: 3, accessory: 1,
  },

  // Authority figures
  {
    id: 'middle-mgmt',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#4a3a2a', hairHighlight: '#6a5a4a', outfitPrimary: '#2a3a5a', outfitSecondary: '#cc3333', shoe: '#1a1a1a' },
    body: 1, hair: 1, outfit: 2, accessory: 0,
  },
  {
    id: 'hall-monitor',
    palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#8a6a3a', hairHighlight: '#aa8a5a', outfitPrimary: '#4a4a6a', outfitSecondary: '#ff8800', shoe: '#2a2a2a', accessory: '#ddaa44', accessoryAlt: '#ffffff' },
    body: 0, hair: 7, outfit: 4, accessory: 5,
  },
  {
    id: 'influencer',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#e8c840', hairHighlight: '#f0d860', outfitPrimary: '#e05090', outfitSecondary: '#ffffff', shoe: '#ffffff' },
    body: 2, hair: 2, outfit: 0, accessory: 0,
  },
  {
    id: 'politician',
    palette: { outline: OUTLINE, ...SKIN_MED, hair: '#555555', hairHighlight: '#777777', outfitPrimary: '#1a2a4a', outfitSecondary: '#aa2222', shoe: '#1a1a1a' },
    body: 1, hair: 1, outfit: 2, accessory: 0,
  },

  // Survivors
  {
    id: 'prepper',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#3a2a1a', hairHighlight: '#5a4a3a', outfitPrimary: '#5a6a3a', outfitSecondary: '#4a5a2a', shoe: '#3a3a2a', accessory: '#7a8a5a' },
    body: 1, hair: 3, outfit: 4, accessory: 2,
  },
  {
    id: 'medic',
    palette: { outline: OUTLINE, ...SKIN_DARK, hair: '#1a1a1a', hairHighlight: '#2a2a2a', outfitPrimary: '#ffffff', outfitSecondary: '#cc3333', shoe: '#ffffff', accessory: '#cc3333', accessoryAlt: '#ffffff' },
    body: 0, hair: 3, outfit: 1, accessory: 6,
  },
  {
    id: 'engineer',
    palette: { outline: OUTLINE, ...SKIN_MED, hair: '#2a2a2a', hairHighlight: '#3a3a3a', outfitPrimary: '#cc8833', outfitSecondary: '#aa6622', shoe: '#5a4a3a', accessory: '#ffcc00' },
    body: 1, hair: 0, outfit: 0, accessory: 2,
  },
  {
    id: 'chef',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#1a1a1a', hairHighlight: '#2a2a2a', outfitPrimary: '#ffffff', outfitSecondary: '#ffffff', shoe: '#2a2a2a', accessory: '#ffffff' },
    body: 1, hair: 6, outfit: 1, accessory: 4,
  },

  // Wildcards
  {
    id: 'philosopher',
    palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#aaaaaa', hairHighlight: '#cccccc', outfitPrimary: '#6a5a4a', outfitSecondary: '#5a4a3a', shoe: '#4a3a2a', accessory: '#998877', accessoryAlt: '#776655' },
    body: 2, hair: 2, outfit: 0, accessory: 1,
  },
  {
    id: 'child',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#cc6633', hairHighlight: '#ee8855', outfitPrimary: '#5588cc', outfitSecondary: '#ffffff', shoe: '#cc4444' },
    body: 2, hair: 5, outfit: 3, accessory: 0,
  },
  {
    id: 'therapist',
    palette: { outline: OUTLINE, ...SKIN_DARK, hair: '#2a1a1a', hairHighlight: '#4a3a3a', outfitPrimary: '#7a6a8a', outfitSecondary: '#6a5a7a', shoe: '#3a3a3a', accessory: '#aa9977', accessoryAlt: '#ffffff' },
    body: 0, hair: 5, outfit: 0, accessory: 5,
  },
  {
    id: 'con-artist',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#1a1a1a', hairHighlight: '#333333', outfitPrimary: '#2a2a2a', outfitSecondary: '#aa8833', shoe: '#1a1a1a' },
    body: 2, hair: 1, outfit: 2, accessory: 0,
  },

  // Dark humor specials
  {
    id: 'nihilist',
    palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#1a1a1a', hairHighlight: '#2a2a2a', outfitPrimary: '#1a1a1a', outfitSecondary: '#2a2a2a', shoe: '#1a1a1a' },
    body: 2, hair: 4, outfit: 3, accessory: 0,
  },
  {
    id: 'optimist',
    palette: { outline: OUTLINE, ...SKIN_MED, hair: '#dd8833', hairHighlight: '#eeaa55', outfitPrimary: '#f0c030', outfitSecondary: '#ffffff', shoe: '#dd7722' },
    body: 0, hair: 5, outfit: 0, accessory: 0,
  },
  {
    id: 'conspiracy',
    palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#5a3a2a', hairHighlight: '#7a5a4a', outfitPrimary: '#4a5a3a', outfitSecondary: '#3a4a2a', shoe: '#3a3a3a', accessory: '#888888', accessoryAlt: '#aaaaaa' },
    body: 0, hair: 2, outfit: 3, accessory: 1,
  },
  {
    id: 'sleeper',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#5a4a3a', hairHighlight: '#7a6a5a', outfitPrimary: '#6a7a8a', outfitSecondary: '#5a6a7a', shoe: '#4a4a5a' },
    body: 1, hair: 5, outfit: 3, accessory: 0,
  },
  {
    id: 'clone',
    palette: { outline: OUTLINE, ...SKIN_PALE, hair: '#aaaacc', hairHighlight: '#ccccee', outfitPrimary: '#8888aa', outfitSecondary: '#7777aa', shoe: '#6666aa', accessory: '#aaaacc', accessoryAlt: '#ffffff' },
    body: 0, hair: 3, outfit: 1, accessory: 6,
  },
  {
    id: 'mascot',
    palette: { outline: OUTLINE, ...SKIN_LIGHT, hair: '#ff5555', hairHighlight: '#ff7777', outfitPrimary: '#ff5555', outfitSecondary: '#ffcc00', shoe: '#ff3333', accessory: '#ff3333' },
    body: 1, hair: 5, outfit: 3, accessory: 4,
  },
]

const SPRITE_MAP = new Map(CHARACTER_SPRITES.map(s => [s.id, s]))

export function getSpriteById(id: string): CharacterSprite | undefined {
  return SPRITE_MAP.get(id)
}
