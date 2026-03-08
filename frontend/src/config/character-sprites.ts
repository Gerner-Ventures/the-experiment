/**
 * Modular pixel character system.
 * Characters are 14w x 18h pixels, rendered from layers:
 *   body (skin) → outfit → hair → accessory
 *
 * Color legend for grids:
 *   0 = transparent
 *   1 = outline (dark)
 *   2 = skin
 *   3 = skin shadow
 *   4 = hair
 *   5 = hair highlight
 *   6 = outfit primary
 *   7 = outfit secondary
 *   8 = eye white
 *   9 = eye/pupil
 *   A = accessory color
 *   B = accessory secondary
 *   C = shoe color
 */

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

const W = 14
const H = 18

// ─── PALETTE MAPPING ───
function paletteMap(palette: CharacterPalette): Record<string, string> {
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

// ─── BASE BODIES (just skin, head shape, arms, legs) ───
// Front-facing chibi: big head, small body

const BODIES: string[][] = [
  // Body 0: standard
  [
    '00000111100000',
    '00001222210000',
    '00012222221000',
    '00012222221000', // head
    '00012289221000', // eyes row
    '00012222221000',
    '00001232210000', // mouth
    '00000111100000',
    '00000166100000', // neck + shirt top
    '00001666610000',
    '00016666661000',
    '00216666612000', // arms
    '00021666120000',
    '00001666100000',
    '00001166110000', // belt
    '00001611610000', // legs
    '00001C11C10000',
    '0000CC00CC0000', // feet
  ],
  // Body 1: stocky
  [
    '00000111100000',
    '00001222210000',
    '00012222221000',
    '00012222221000',
    '00012289221000',
    '00012222221000',
    '00001232210000',
    '00000111100000',
    '00001166110000',
    '00016666661000',
    '00166666666100',
    '02166666666120',
    '00216666661200',
    '00016666661000',
    '00011661166100',
    '00001611610000',
    '00001C11C10000',
    '0000CC00CC0000',
  ],
  // Body 2: slim
  [
    '00000111100000',
    '00001222210000',
    '00012222221000',
    '00012222221000',
    '00012289221000',
    '00012222221000',
    '00001232210000',
    '00000111100000',
    '00000166100000',
    '00001666610000',
    '00012666210000',
    '00216662612000',
    '00021666120000',
    '00001666100000',
    '00001166100000',
    '00001611610000',
    '00001C11C10000',
    '0000CC00CC0000',
  ],
]

// ─── HAIR STYLES (overlaid on head area, rows 0-7) ───

const HAIRS: string[][] = [
  // Hair 0: short spiky
  [
    '00004141400000',
    '00041444414000',
    '00045444451000',
    '00041000041000',
    '00010000001000',
    '00000000000000',
    '00000000000000',
    '00000000000000',
  ],
  // Hair 1: side part
  [
    '00000444400000',
    '00044444440000',
    '00445444441000',
    '00441000041000',
    '00410000001000',
    '00000000000000',
    '00000000000000',
    '00000000000000',
  ],
  // Hair 2: long/shaggy
  [
    '00004444400000',
    '00044544540000',
    '00445444441000',
    '00441000041000',
    '00410000004100',
    '00410000004100',
    '00040000004000',
    '00000000000000',
  ],
  // Hair 3: buzz cut
  [
    '00000444400000',
    '00004444440000',
    '00014444441000',
    '00010000001000',
    '00010000001000',
    '00000000000000',
    '00000000000000',
    '00000000000000',
  ],
  // Hair 4: mohawk
  [
    '00000044000000',
    '00000454000000',
    '00001444100000',
    '00012444210000',
    '00012000210000',
    '00010000001000',
    '00000000000000',
    '00000000000000',
  ],
  // Hair 5: messy/curly
  [
    '00044444440000',
    '00454545454000',
    '04454444454400',
    '04410000014400',
    '04100000001400',
    '00100000001000',
    '00000000000000',
    '00000000000000',
  ],
  // Hair 6: bald (just outline)
  [
    '00000111100000',
    '00001000010000',
    '00010000001000',
    '00010000001000',
    '00010000001000',
    '00000000000000',
    '00000000000000',
    '00000000000000',
  ],
  // Hair 7: bowl cut
  [
    '00004444400000',
    '00044544540000',
    '00445454451000',
    '00444444441000',
    '00414111141000',
    '00010000001000',
    '00000000000000',
    '00000000000000',
  ],
]

// ─── OUTFIT OVERLAYS (rows 8-17, only outfit colors) ───

const OUTFITS: string[][] = [
  // Outfit 0: t-shirt + jeans (default, no overlay needed — uses base)
  [],
  // Outfit 1: lab coat
  [
    '00000000000000', // row 8
    '00007777770000',
    '00077777777000',
    '00777777777700',
    '00077777777000',
    '00077777770000',
    '00077677670000',
    '00007711770000',
    '00007C11C70000',
    '00000000000000',
  ],
  // Outfit 2: suit
  [
    '00000176100000',
    '00001766710000',
    '00017667671000',
    '00176766676100',
    '00017667670000',
    '00017667670000',
    '00011661166100',
    '00001611610000',
    '00001C11C10000',
    '00000000000000',
  ],
  // Outfit 3: hoodie
  [
    '00000166100000',
    '00001666610000',
    '00016666661000',
    '00166666666100',
    '00016666661000',
    '00016676610000',
    '00016666610000',
    '00001611610000',
    '00001C11C10000',
    '00000000000000',
  ],
  // Outfit 4: vest/tactical
  [
    '00000166100000',
    '00001767710000',
    '00017677671000',
    '00276777672000',
    '00027677720000',
    '00017677710000',
    '00011771170000',
    '00001611610000',
    '00001C11C10000',
    '00000000000000',
  ],
]

// ─── ACCESSORIES (sparse overlays) ───

const ACCESSORIES: (readonly [number, number, string])[][] = [
  // Accessory 0: none
  [],
  // Accessory 1: glasses
  [[4, 3, 'A'], [5, 3, 'A'], [6, 3, 'A'], [7, 3, 'A'], [8, 3, 'A'], [9, 3, 'A'],
   [4, 4, 'A'], [5, 4, '8'], [6, 4, 'A'], [7, 4, 'A'], [8, 4, '8'], [9, 4, 'A']],
  // Accessory 2: headband
  [[3, 3, 'A'], [4, 3, 'A'], [5, 3, 'A'], [6, 3, 'A'], [7, 3, 'A'], [8, 3, 'A'], [9, 3, 'A'], [10, 3, 'A']],
  // Accessory 3: mask (lower face)
  [[4, 5, 'A'], [5, 5, 'A'], [6, 5, 'A'], [7, 5, 'A'], [8, 5, 'A'], [9, 5, 'A'],
   [4, 6, 'A'], [5, 6, 'A'], [6, 6, 'A'], [7, 6, 'A'], [8, 6, 'A'], [9, 6, 'A']],
  // Accessory 4: hat
  [[3, 0, 'A'], [4, 0, 'A'], [5, 0, 'A'], [6, 0, 'A'], [7, 0, 'A'], [8, 0, 'A'], [9, 0, 'A'], [10, 0, 'A'],
   [4, 1, 'A'], [5, 1, 'A'], [6, 1, 'A'], [7, 1, 'A'], [8, 1, 'A'], [9, 1, 'A']],
  // Accessory 5: clipboard (held)
  [[11, 10, 'A'], [12, 10, 'A'], [11, 11, 'A'], [12, 11, 'A'], [11, 12, 'B'], [12, 12, 'A'], [11, 13, 'A'], [12, 13, 'A']],
  // Accessory 6: badge/id
  [[6, 9, 'A'], [7, 9, 'A'], [6, 10, 'B'], [7, 10, 'B']],
]

// ─── RENDER FUNCTION ───

// ─── ANIMATION POSES ───
// Each pose is a partial body override: [rowIndex, rowData][]
// These replace specific rows of the base body to create different poses.

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

interface PoseDef {
  bodyOverrides: [number, string][]      // [rowIndex, rowData]
  pixelOverrides?: [number, number, string][] // [x, y, colorKey] extra pixels (effects)
}

const POSES: Record<PoseName, PoseDef> = {
  idle: { bodyOverrides: [] },

  // Walk: leg alternation for movement
  walk1: {
    bodyOverrides: [
      [15, '00001611610000'], // legs: left forward, right back
      [16, '0001C1001C0000'],
      [17, '000CC000CC0000'],
    ],
  },
  walk2: {
    bodyOverrides: [
      [15, '00001611610000'], // legs: right forward, left back
      [16, '0000C1001C1000'],
      [17, '0000CC000CC000'],
    ],
  },

  // Dance: arms up, legs apart
  dance1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '20016666610020'], // arms up left
      [12, '02001666100200'],
      [15, '00016100016100'], // legs apart
      [16, '0001C1000C1000'],
      [17, '000CC000CC0000'],
    ],
  },
  dance2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00201666610200'], // arms up right
      [12, '00020166102000'],
      [15, '00016100016100'],
      [16, '000C10001C0000'],
      [17, '00CC0000CC0000'],
    ],
  },

  // Pee: turned slightly, stream pixels
  pee: {
    bodyOverrides: [
      [11, '00216666600000'],
      [12, '00021666120000'],
      [13, '00001666100000'],
      [14, '00001166100000'],
      [15, '00001621610000'],
    ],
    pixelOverrides: [
      [9, 14, 'A'], [10, 15, 'A'], [10, 16, 'A'], [10, 17, 'A'], // stream
    ],
  },

  // Poop: squatting
  poop: {
    bodyOverrides: [
      [13, '00001666100000'],
      [14, '00011661100000'],
      [15, '00016111610000'],
      [16, '0001C1001C1000'],
      [17, '000CC0000CC000'],
    ],
    pixelOverrides: [
      [7, 16, '3'], [7, 17, '3'], [8, 17, '3'], // the evidence
    ],
  },

  // Vomit: leaning forward
  vomit: {
    bodyOverrides: [
      [5, '00012222221000'],
      [6, '00001232310000'], // mouth open
    ],
    pixelOverrides: [
      [10, 7, 'A'], [11, 7, 'A'], [12, 8, 'A'], [11, 8, 'A'], // splatter
      [12, 9, 'A'], [13, 9, 'A'],
    ],
  },

  // Stab: arm extended with weapon
  stab: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666612000'],
      [12, '00001666100200'],
      [13, '00001666100020'],
    ],
    pixelOverrides: [
      [13, 12, '1'], [13, 13, '1'], [13, 11, 'A'], // knife
    ],
  },

  // Shoot: arm extended
  shoot: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666612000'],
      [12, '00001666100200'],
    ],
    pixelOverrides: [
      [13, 11, '1'], [13, 12, '1'], [12, 12, '1'], // gun shape
      [13, 10, 'A'], // muzzle flash frame
    ],
  },

  // Panic: arms flailing alternating
  panic1: {
    bodyOverrides: [
      [4, '00012899221000'], // wide eyes
      [10, '00016666661000'],
      [11, '20016666610020'],
      [12, '02001666100200'],
    ],
  },
  panic2: {
    bodyOverrides: [
      [4, '00012998221000'], // wide eyes other way
      [10, '00016666661000'],
      [11, '00201666610200'],
      [12, '00020166102000'],
      [15, '00016100016100'],
      [16, '0001C1000C1000'],
    ],
  },

  // Sleep: lying down... well, head tilted, Z's
  sleep: {
    bodyOverrides: [
      [4, '00012211221000'], // eyes closed
      [5, '00012222221000'],
    ],
    pixelOverrides: [
      [11, 1, 'A'], // z
      [12, 0, 'A'], // Z
      [10, 2, 'A'], // z
    ],
  },

  // Wave
  wave1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666610200'],
      [12, '00001666100200'],
    ],
  },
  wave2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666610020'],
      [12, '00001666100020'],
    ],
  },

  // Dead: X eyes, flat
  dead: {
    bodyOverrides: [
      [4, '00019289291000'], // X eyes
      [5, '00012222221000'],
      [6, '00001212210000'], // flat mouth
      [15, '00016111610000'], // legs splayed
      [16, '001C10001C1000'],
      [17, '00CC0000CC0000'],
    ],
  },
}

/** Silly animation sequences for the config screen */
export const SILLY_ANIMATIONS: { name: string; frames: PoseName[]; frameMs: number }[] = [
  { name: 'dance', frames: ['dance1', 'dance2', 'dance1', 'dance2', 'dance1', 'dance2', 'idle'], frameMs: 250 },
  { name: 'panic', frames: ['panic1', 'panic2', 'panic1', 'panic2', 'panic1', 'panic2', 'idle'], frameMs: 200 },
  { name: 'wave', frames: ['wave1', 'wave2', 'wave1', 'wave2', 'idle'], frameMs: 300 },
  { name: 'pee', frames: ['idle', 'pee', 'pee', 'pee', 'pee', 'idle'], frameMs: 400 },
  { name: 'poop', frames: ['idle', 'poop', 'poop', 'poop', 'poop', 'idle'], frameMs: 500 },
  { name: 'vomit', frames: ['idle', 'vomit', 'vomit', 'vomit', 'idle'], frameMs: 350 },
  { name: 'stab', frames: ['idle', 'stab', 'idle', 'stab', 'idle'], frameMs: 200 },
  { name: 'shoot', frames: ['idle', 'shoot', 'idle', 'shoot', 'idle'], frameMs: 250 },
  { name: 'sleep', frames: ['sleep', 'sleep', 'sleep', 'sleep', 'idle'], frameMs: 600 },
  { name: 'dead', frames: ['idle', 'dead', 'dead', 'dead', 'dead', 'idle'], frameMs: 500 },
]

/** Walk cycle config — loop walk1/walk2 during movement */
export const WALK_ANIMATION = { frames: ['walk1', 'walk2'] as PoseName[], frameMs: 200 }

export function renderCharacter(sprite: CharacterSprite, pose: PoseName = 'idle'): (string | null)[][] {
  const pm = paletteMap(sprite.palette)
  const body = [...(BODIES[sprite.body] ?? BODIES[0])]
  const hair = HAIRS[sprite.hair] ?? HAIRS[0]
  const outfit = OUTFITS[sprite.outfit] ?? []
  const accessory = ACCESSORIES[sprite.accessory] ?? []
  const poseDef = POSES[pose] ?? POSES.idle

  // Apply pose body overrides
  for (const [rowIdx, rowData] of poseDef.bodyOverrides) {
    if (rowIdx < body.length) {
      body[rowIdx] = rowData
    }
  }

  // Start with empty grid
  const result: (string | null)[][] = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => null)
  )

  // Layer 1: body
  for (let y = 0; y < H; y++) {
    const row = body[y]
    if (!row) continue
    for (let x = 0; x < W; x++) {
      const ch = row[x]
      if (ch && ch !== '0' && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  // Layer 2: hair (rows 0-7)
  for (let y = 0; y < hair.length && y < 8; y++) {
    const row = hair[y]
    if (!row) continue
    for (let x = 0; x < W; x++) {
      const ch = row[x]
      if (ch && ch !== '0' && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  // Layer 3: outfit (rows 8-17)
  for (let oy = 0; oy < outfit.length; oy++) {
    const row = outfit[oy]
    if (!row) continue
    const y = 8 + oy
    if (y >= H) break
    for (let x = 0; x < W; x++) {
      const ch = row[x]
      if (ch && ch !== '0' && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  // Layer 4: accessories (pixel overrides)
  for (const [x, y, ch] of accessory) {
    if (y < H && x < W && pm[ch]) {
      result[y][x] = pm[ch]
    }
  }

  // Layer 5: pose pixel overrides (effects like streams, splatter, Z's)
  if (poseDef.pixelOverrides) {
    for (const [x, y, ch] of poseDef.pixelOverrides) {
      if (y < H && x < W && pm[ch]) {
        result[y][x] = pm[ch]
      }
    }
  }

  return result
}

// ─── CHARACTER DEFINITIONS ───

const SKIN_LIGHT: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#f5d0a9', skinShadow: '#d4a574' }
const SKIN_MED: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#c68c53', skinShadow: '#a06830' }
const SKIN_DARK: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#8b5e3c', skinShadow: '#6b4226' }
const SKIN_PALE: Pick<CharacterPalette, 'skin' | 'skinShadow'> = { skin: '#ffe0cc', skinShadow: '#e0b8a0' }

const OUTLINE = '#1a1a2e'

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

// ─── SHARED SPRITE RENDERING CONSTANTS ───
export const SPRITE_W = 14
export const SPRITE_H = 18
export const PIXEL_SCALE = 2

/**
 * Render a character sprite to an offscreen canvas.
 * Reusable across PixiJS textures, SVG data URLs, and Vue canvas components.
 */
export function renderSpriteToCanvas(sprite: CharacterSprite, pose: PoseName = 'idle', scale = PIXEL_SCALE): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_W * scale
  canvas.height = SPRITE_H * scale
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const grid = renderCharacter(sprite, pose)
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const color = grid[y][x]
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
    }
  }

  return canvas
}
