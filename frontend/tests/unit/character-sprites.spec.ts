/**
 * @jest-environment jsdom
 */
import {
  HD_GRID_W,
  HD_GRID_H,
  HD_PIXEL_SCALE,
  renderHDSpriteToCanvas,
  renderCharacter,
  HD_CHARACTER_SPRITES,
  getHDSpriteById,
  getSpriteById,
} from '@/config/sprites'

// jsdom does not support canvas getContext('2d') — mock it
const mockCtx = {
  imageSmoothingEnabled: true,
  fillStyle: '',
  fillRect: jest.fn(),
}

beforeEach(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D)
  mockCtx.fillRect.mockClear()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('character-sprites (HD)', () => {
  describe('constants', () => {
    it('HD_GRID_W is 32', () => {
      expect(HD_GRID_W).toBe(32)
    })

    it('HD_GRID_H is 48', () => {
      expect(HD_GRID_H).toBe(48)
    })

    it('HD_PIXEL_SCALE is 3', () => {
      expect(HD_PIXEL_SCALE).toBe(3)
    })
  })

  describe('renderCharacter (compat wrapper)', () => {
    const testSprite = HD_CHARACTER_SPRITES[0]

    it('returns a grid with correct dimensions', () => {
      const grid = renderCharacter(testSprite, 'idle')
      expect(grid).toHaveLength(HD_GRID_H)
      for (const row of grid) {
        expect(row).toHaveLength(HD_GRID_W)
      }
    })

    it('returns grid with null or hex color strings', () => {
      const grid = renderCharacter(testSprite, 'idle')
      for (const row of grid) {
        for (const pixel of row) {
          if (pixel !== null) {
            expect(typeof pixel).toBe('string')
            expect(pixel.startsWith('#')).toBe(true)
          }
        }
      }
    })

    it('renders different poses without error', () => {
      const poses = ['idle', 'walk1', 'walk2', 'dance1', 'dance2', 'dead'] as const
      for (const pose of poses) {
        const grid = renderCharacter(testSprite, pose)
        expect(grid).toHaveLength(HD_GRID_H)
      }
    })

    it('produces different output for walk1 vs walk2', () => {
      const grid1 = renderCharacter(testSprite, 'walk1')
      const grid2 = renderCharacter(testSprite, 'walk2')

      const flat1 = grid1.map(r => r.join(',')).join('|')
      const flat2 = grid2.map(r => r.join(',')).join('|')
      expect(flat1).not.toBe(flat2)
    })
  })

  describe('renderHDSpriteToCanvas', () => {
    it('returns a canvas with correct dimensions at default scale', () => {
      const character = HD_CHARACTER_SPRITES[0]
      const canvas = renderHDSpriteToCanvas(character, 'idle')

      expect(canvas).toBeInstanceOf(HTMLCanvasElement)
      expect(canvas.width).toBe(HD_GRID_W * HD_PIXEL_SCALE)
      expect(canvas.height).toBe(HD_GRID_H * HD_PIXEL_SCALE)
    })

    it('returns a canvas with correct dimensions at custom scale', () => {
      const character = HD_CHARACTER_SPRITES[0]
      const scale = 4
      const canvas = renderHDSpriteToCanvas(character, 'idle', scale)

      expect(canvas.width).toBe(HD_GRID_W * scale)
      expect(canvas.height).toBe(HD_GRID_H * scale)
    })

    it('renders all characters without error', () => {
      for (const character of HD_CHARACTER_SPRITES) {
        expect(() => renderHDSpriteToCanvas(character, 'idle')).not.toThrow()
      }
    })
  })

  describe('getHDSpriteById / getSpriteById', () => {
    it('returns character for valid id', () => {
      const sprite = getHDSpriteById('intern')
      expect(sprite).toBeDefined()
      expect(sprite!.id).toBe('intern')
    })

    it('getSpriteById compat returns same result', () => {
      const sprite = getSpriteById('intern')
      expect(sprite).toBeDefined()
      expect(sprite!.id).toBe('intern')
    })

    it('returns undefined for unknown id', () => {
      expect(getHDSpriteById('nonexistent')).toBeUndefined()
    })
  })

  describe('HD_CHARACTER_SPRITES', () => {
    it('has unique ids', () => {
      const ids = HD_CHARACTER_SPRITES.map(s => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('all characters render without error', () => {
      for (const character of HD_CHARACTER_SPRITES) {
        expect(() => renderCharacter(character, 'idle')).not.toThrow()
      }
    })
  })
})
