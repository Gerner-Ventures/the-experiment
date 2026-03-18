export const TILE_W = 128
export const TILE_H = 64

export function tileToScreen(tileX: number, tileY: number): { x: number; y: number } {
  return {
    x: (tileX - tileY) * (TILE_W / 2),
    y: (tileX + tileY) * (TILE_H / 2),
  }
}

export function screenToTile(screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2),
    y: Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2),
  }
}
