import type { PixelGrid } from './types'

/** Set a single pixel with bounds checking */
export function px(g: PixelGrid, x: number, y: number, col: string): void {
  if (x >= 0 && x < g[0].length && y >= 0 && y < g.length && col) g[y][x] = col
}

/** Fill a rectangle with bounds checking per pixel */
export function rc(g: PixelGrid, x1: number, y1: number, w: number, h: number, col: string): void {
  for (let y = y1; y < y1 + h; y++)
    for (let x = x1; x < x1 + w; x++)
      px(g, x, y, col)
}
