import { tileToScreen, screenToTile } from '@/components/world/pixi/isometric-utils'

describe('isometric math', () => {
  describe('tileToScreen', () => {
    it('maps (0,0) to screen origin', () => {
      const { x, y } = tileToScreen(0, 0)
      expect(x).toBe(0)
      expect(y).toBe(0)
    })

    it('maps (1,0) to the right and down', () => {
      const { x, y } = tileToScreen(1, 0)
      expect(x).toBe(32)  // TILE_W / 2
      expect(y).toBe(16)  // TILE_H / 2
    })

    it('maps (0,1) to the left and down', () => {
      const { x, y } = tileToScreen(0, 1)
      expect(x).toBe(-32) // -(TILE_W / 2)
      expect(y).toBe(16)  // TILE_H / 2
    })

    it('maps (1,1) to directly below (0,0)', () => {
      const { x, y } = tileToScreen(1, 1)
      expect(x).toBe(0)   // offsets cancel
      expect(y).toBe(32)  // TILE_H
    })

    it('is symmetric: (a,b) and (b,a) have mirrored x, same y', () => {
      const a = tileToScreen(3, 5)
      const b = tileToScreen(5, 3)
      expect(a.x).toBe(-b.x)
      expect(a.y).toBe(b.y)
    })
  })

  describe('screenToTile', () => {
    it('maps screen origin back to (0,0)', () => {
      const { x, y } = screenToTile(0, 0)
      expect(x).toBe(0)
      expect(y).toBe(0)
    })

    it('round-trips tileToScreen -> screenToTile for integer coordinates', () => {
      const testCases = [
        [0, 0], [1, 0], [0, 1], [5, 5], [10, 10], [3, 7], [19, 0], [0, 19],
      ]
      for (const [tx, ty] of testCases) {
        const screen = tileToScreen(tx, ty)
        const tile = screenToTile(screen.x, screen.y)
        expect(tile.x).toBe(tx)
        expect(tile.y).toBe(ty)
      }
    })

    it('handles negative screen coordinates', () => {
      const screen = tileToScreen(0, 5)
      expect(screen.x).toBeLessThan(0)
      const tile = screenToTile(screen.x, screen.y)
      expect(tile.x).toBe(0)
      expect(tile.y).toBe(5)
    })
  })

  describe('coordinate system properties', () => {
    it('moving +x in tile space moves right and down in screen space', () => {
      const a = tileToScreen(0, 0)
      const b = tileToScreen(1, 0)
      expect(b.x).toBeGreaterThan(a.x)
      expect(b.y).toBeGreaterThan(a.y)
    })

    it('moving +y in tile space moves left and down in screen space', () => {
      const a = tileToScreen(0, 0)
      const b = tileToScreen(0, 1)
      expect(b.x).toBeLessThan(a.x)
      expect(b.y).toBeGreaterThan(a.y)
    })

    it('tiles along a diagonal (x=y) are vertically aligned in screen space', () => {
      for (let i = 0; i < 10; i++) {
        const { x } = tileToScreen(i, i)
        expect(x).toBe(0)
      }
    })

    it('screen y increases monotonically as tiles go south-east', () => {
      let prevY = -Infinity
      for (let i = 0; i < 20; i++) {
        const { y } = tileToScreen(i, 0)
        expect(y).toBeGreaterThan(prevY)
        prevY = y
      }
    })
  })
})
