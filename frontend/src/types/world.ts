/** Tile types from backend default_town.json */
export type TileType = 'grass' | 'path' | 'building' | 'fence' | 'field'

/** Single tile from the map grid */
export interface TileDef {
  x: number
  y: number
  tileType: TileType
  walkable: boolean
  locationId: string | null
}

/** Location metadata from the map */
export interface LocationDef {
  id: string
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  capacity: number
  description: string
}

/** Map data structure (matches backend default_town.json) */
export interface MapData {
  name: string
  width: number
  height: number
  tiles: TileDef[]
  locations: LocationDef[]
}

/** Theme color palette for tile rendering */
export interface TilePalette {
  grass: [string, string, string]       // [fill, stroke, variation]
  path: [string, string, string]
  building: [string, string, string]
  fence: [string, string, string]
  field: [string, string, string]
}

/** Building visual style per theme */
export type BuildingStyle = 'huts' | 'wireframe' | 'roman' | 'brutalist'

/** Ambient visual effects */
export interface AmbientConfig {
  fogColor?: string
  fogOpacity?: number
  overlay?: 'rain' | 'code' | 'dust' | 'smog'
  overlayOpacity?: number
  tint?: string
  scanlines?: boolean
}

/** Day/night cycle visual config */
export interface DayNightConfig {
  enabled: boolean
  showCelestialBodies: boolean
  celestialVariant?: 'standard' | 'digital'
}

/** Map theme definition */
export interface MapTheme {
  id: string
  name: string
  description: string
  tilePalette: TilePalette
  buildingStyle: BuildingStyle
  ambient: AmbientConfig
  dayNight?: DayNightConfig
  preview: string[]  // 3-4 hex colors for the theme picker swatch
}

/** World configuration passed to the renderer */
export interface WorldConfig {
  theme: MapTheme
  mapData: MapData
  tileWidth: number
  tileHeight: number
}
