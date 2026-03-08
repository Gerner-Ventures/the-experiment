/**
 * @jest-environment jsdom
 */
import {
  SPRITE_W,
  SPRITE_H,
  PIXEL_SCALE,
  renderSpriteToCanvas,
  renderCharacter,
  CHARACTER_SPRITES,
  getSpriteById,
  type CharacterSprite,
} from '@/config/character-sprites'

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

describe('character-sprites', () => {
  describe('constants', () => {
    it('SPRITE_W is 14', () => {
      expect(SPRITE_W).toBe(14)
    })

    it('SPRITE_H is 18', () => {
      expect(SPRITE_H).toBe(18)
    })

    it('PIXEL_SCALE is 2', () => {
      expect(PIXEL_SCALE).toBe(2)
    })
  })

  describe('renderCharacter', () => {
    const testSprite: CharacterSprite = CHARACTER_SPRITES[0]

    it('returns a grid with correct dimensions', () => {
      const grid = renderCharacter(testSprite)
      expect(grid).toHaveLength(SPRITE_H)
      for (const row of grid) {
        expect(row).toHaveLength(SPRITE_W)
      }
    })

    it('returns grid with null or hex color strings', () => {
      const grid = renderCharacter(testSprite)
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
        expect(grid).toHaveLength(SPRITE_H)
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

  describe('renderSpriteToCanvas', () => {
    it('returns a canvas with correct dimensions at default scale', () => {
      const sprite = CHARACTER_SPRITES[0]
      const canvas = renderSpriteToCanvas(sprite)

      expect(canvas).toBeInstanceOf(HTMLCanvasElement)
      expect(canvas.width).toBe(SPRITE_W * PIXEL_SCALE)
      expect(canvas.height).toBe(SPRITE_H * PIXEL_SCALE)
    })

    it('returns a canvas with correct dimensions at custom scale', () => {
      const sprite = CHARACTER_SPRITES[0]
      const scale = 4
      const canvas = renderSpriteToCanvas(sprite, 'idle', scale)

      expect(canvas.width).toBe(SPRITE_W * scale)
      expect(canvas.height).toBe(SPRITE_H * scale)
    })

    it('renders all character sprites without error', () => {
      for (const sprite of CHARACTER_SPRITES) {
        expect(() => renderSpriteToCanvas(sprite)).not.toThrow()
      }
    })
  })

  describe('getSpriteById', () => {
    it('returns sprite for valid id', () => {
      const sprite = getSpriteById('intern')
      expect(sprite).toBeDefined()
      expect(sprite!.id).toBe('intern')
    })

    it('returns undefined for unknown id', () => {
      expect(getSpriteById('nonexistent')).toBeUndefined()
    })
  })

  describe('CHARACTER_SPRITES', () => {
    it('has unique ids', () => {
      const ids = CHARACTER_SPRITES.map(s => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('all sprites have valid body/hair/outfit/accessory indices', () => {
      for (const sprite of CHARACTER_SPRITES) {
        expect(() => renderCharacter(sprite)).not.toThrow()
      }
    })
  })
})
