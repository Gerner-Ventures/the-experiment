/**
 * Theme ID constants — single source of truth for theme string identifiers.
 * Replaces hardcoded string literals across IsometricMap and tile-atlas.
 */

export const THEME_IDS = {
  MATRIX: 'matrix',
  LORD_OF_THE_FLIES: 'lord-of-the-flies',
  NINETEEN_EIGHTY_FOUR: '1984',
} as const

export type ThemeId = (typeof THEME_IDS)[keyof typeof THEME_IDS]

/** Matrix theme: the column index where code_river tiles replace path tiles */
export const CODE_RIVER_COLUMN_X = 9
