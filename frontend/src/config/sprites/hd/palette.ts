import type { BasePalette, FullPalette } from './types'

// ─── Color Utility Functions ───

function hex2rgb(h: string): [number, number, number] {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
}

function rgb2hex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
}

function darken(hex: string, amount = 30): string {
  const [r, g, b] = hex2rgb(hex)
  return rgb2hex(r - amount, g - amount, b - amount)
}

function lighten(hex: string, amount = 40): string {
  const [r, g, b] = hex2rgb(hex)
  return rgb2hex(r + amount, g + amount, b + amount)
}

function mixColors(a: string, b: string, t = 0.5): string {
  const [r1, g1, b1] = hex2rgb(a)
  const [r2, g2, b2] = hex2rgb(b)
  return rgb2hex(
    r1 + (r2 - r1) * t,
    g1 + (g2 - g1) * t,
    b1 + (b2 - b1) * t,
  )
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
  }
  return h
}

// ─── Palette Derivation ───

const EYE_COLORS = ['#4488cc', '#338855', '#885533', '#446688', '#556633', '#664488']

/**
 * Derive a full render palette from a base character palette.
 * Produces 30+ colors from 8 base colors using deterministic shading.
 */
export function deriveFullPalette(base: BasePalette): FullPalette {
  const eyeColor = EYE_COLORS[Math.abs(hashStr(base.hair + base.skin)) % EYE_COLORS.length]

  return {
    ol: base.outline,
    sk: base.skin,
    ss: base.skinShadow,
    sh: lighten(base.skin, 25),
    sd: darken(base.skin, 15),
    rim: lighten(base.skin, 50),
    hr: base.hair,
    hh: base.hairHighlight,
    hs: darken(base.hair, 25),
    o1: base.outfitPrimary,
    o2: base.outfitSecondary,
    os: darken(base.outfitPrimary, 30),
    od: darken(base.outfitPrimary, 50),
    oh: lighten(base.outfitPrimary, 20),
    orim: lighten(base.outfitPrimary, 40),
    ob: darken(base.outfitPrimary, 40),
    bt: darken(base.outfitPrimary, 50),
    s1: base.shoe,
    s2: darken(base.shoe, 30),
    s3: lighten(base.shoe, 20),
    ew: '#e8e8f8',
    ei: eyeColor,
    ep: '#0a0a1a',
    eg: '#ffffff',
    eb: darken(eyeColor, 40),
    mo: darken(base.skin, 45),
    mi: '#2a0a0e',
    mt: '#e8ddd8',
    ml: mixColors(darken(base.skin, 30), '#cc6666', 0.35),
    mu: mixColors(darken(base.skin, 15), '#dd7777', 0.4),
    ch: mixColors(base.skin, '#ff8888', 0.3),
    ao: darken(base.outfitPrimary, 60),
    ao2: darken(base.skin, 50),
    gs: '#06060f',
    gp: '#1a1a30',
    gp2: '#151528',
    ue: darken(base.skin, 20),
    nh: lighten(base.skin, 35),
    ear: mixColors(base.skin, base.skinShadow, 0.5),
    hbs: darken(base.hair, 40),
  }
}

// Re-export utilities for use in draw modules
export { darken, lighten, mixColors }
