export interface CharacterPalette {
  outline: string
  skin: string
  skinShadow: string
  hair: string
  hairHighlight: string
  outfitPrimary: string
  outfitSecondary: string
  shoe: string
  accessory?: string
  accessoryAlt?: string
}

export interface CharacterSprite {
  id: string
  palette: CharacterPalette
  body: number
  hair: number
  outfit: number
  accessory: number
}

export type PoseName =
  | 'idle'
  | 'walk1' | 'walk2'
  | 'dance1' | 'dance2'
  | 'pee'
  | 'poop'
  | 'vomit'
  | 'stab'
  | 'shoot'
  | 'panic1' | 'panic2'
  | 'sleep'
  | 'wave1' | 'wave2'
  | 'dead'
  | 'talk1' | 'talk2'
  | 'rally1' | 'rally2'
  | 'gather1' | 'gather2'
  | 'argue1' | 'argue2'
  | 'think'
  | 'investigate1' | 'investigate2'
  | 'observe'

export interface PoseDef {
  bodyOverrides: [number, string][]      // [rowIndex, rowData]
  pixelOverrides?: [number, number, string][] // [x, y, colorKey] extra pixels (effects)
}

export interface AnimationDef {
  name: string
  frames: PoseName[]
  frameMs: number
  loop?: boolean
}
