import type { MapData, TileDef, LocationDef } from '@/types/world'
import rawMapData from '../../backend-data/default_town.json'

interface RawTile {
  x: number
  y: number
  tile_type: string
  walkable: boolean
  location_id: string | null
}

interface RawLocation {
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

interface RawMapData {
  name: string
  width: number
  height: number
  tiles: RawTile[]
  locations: RawLocation[]
}

function convertMapData(raw: RawMapData): MapData {
  const tiles: TileDef[] = raw.tiles.map(t => ({
    x: t.x,
    y: t.y,
    tileType: t.tile_type as TileDef['tileType'],
    walkable: t.walkable,
    locationId: t.location_id,
  }))

  const locations: LocationDef[] = raw.locations.map(l => ({
    id: l.id,
    name: l.name,
    type: l.type,
    x: l.x,
    y: l.y,
    width: l.width,
    height: l.height,
    capacity: l.capacity,
    description: l.description,
  }))

  return {
    name: raw.name,
    width: raw.width,
    height: raw.height,
    tiles,
    locations,
  }
}

export const DEFAULT_TOWN: MapData = convertMapData(rawMapData as RawMapData)
