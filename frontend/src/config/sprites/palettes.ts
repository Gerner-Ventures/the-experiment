import type { CharacterPalette } from './types'

export function paletteMap(palette: CharacterPalette): Record<string, string> {
  return {
    '1': palette.outline,
    '2': palette.skin,
    '3': palette.skinShadow,
    '4': palette.hair,
    '5': palette.hairHighlight,
    '6': palette.outfitPrimary,
    '7': palette.outfitSecondary,
    '8': '#ffffff',
    '9': '#1a1a2e',
    'A': palette.accessory ?? '#ff0000',
    'B': palette.accessoryAlt ?? '#cc0000',
    'C': palette.shoe,
  }
}

export const SKIN_LIGHT: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#f5d0a9', skinShadow: '#d4a574' }
export const SKIN_MED: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#c68c53', skinShadow: '#a06830' }
export const SKIN_DARK: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#8b5e3c', skinShadow: '#6b4226' }
export const SKIN_PALE: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#ffe0cc', skinShadow: '#e0b8a0' }

export const OUTLINE = '#1a1a2e'
