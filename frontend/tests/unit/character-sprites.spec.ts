import {
  renderCharacter,
  getSpriteById,
  CHARACTER_SPRITES,
  SILLY_ANIMATIONS,
  WALK_ANIMATION,
  type PoseName,
} from '@/config/character-sprites'

describe('character-sprites', () => {
  const W = 14
  const H = 18

  describe('renderCharacter', () => {
    it('returns a grid of the correct dimensions', () => {
      const sprite = CHARACTER_SPRITES[0]
      const grid = renderCharacter(sprite)

      expect(grid).toHaveLength(H)
      for (const row of grid) {
        expect(row).toHaveLength(W)
      }
    })

    it('returns hex color strings or null for each cell', () => {
      const sprite = CHARACTER_SPRITES[0]
      const grid = renderCharacter(sprite)

      for (const row of grid) {
        for (const cell of row) {
          if (cell !== null) {
            expect(cell).toMatch(/^#[0-9a-fA-F]{6}$/)
          }
        }
      }
    })

    it('renders non-empty output (not all null)', () => {
      const sprite = CHARACTER_SPRITES[0]
      const grid = renderCharacter(sprite)
      const filledCount = grid.flat().filter(c => c !== null).length

      expect(filledCount).toBeGreaterThan(0)
    })

    it('uses palette skin color in the output', () => {
      const sprite = CHARACTER_SPRITES[0]
      const grid = renderCharacter(sprite)
      const allColors = grid.flat().filter(Boolean) as string[]

      expect(allColors).toContain(sprite.palette.skin)
    })

    it('uses palette outline color in the output', () => {
      const sprite = CHARACTER_SPRITES[0]
      const grid = renderCharacter(sprite)
      const allColors = grid.flat().filter(Boolean) as string[]

      expect(allColors).toContain(sprite.palette.outline)
    })

    it('renders all 22 character sprites without error', () => {
      expect(CHARACTER_SPRITES).toHaveLength(22)

      for (const sprite of CHARACTER_SPRITES) {
        const grid = renderCharacter(sprite)
        expect(grid).toHaveLength(H)
        expect(grid[0]).toHaveLength(W)

        // Each sprite should have some rendered pixels
        const filled = grid.flat().filter(c => c !== null).length
        expect(filled).toBeGreaterThan(20)
      }
    })

    it('renders consistently for the same input', () => {
      const sprite = CHARACTER_SPRITES[0]
      const grid1 = renderCharacter(sprite)
      const grid2 = renderCharacter(sprite)

      expect(grid1).toEqual(grid2)
    })
  })

  describe('poses', () => {
    const allPoses: PoseName[] = [
      'idle', 'walk1', 'walk2', 'dance1', 'dance2', 'pee', 'poop', 'vomit',
      'stab', 'shoot', 'panic1', 'panic2', 'sleep',
      'wave1', 'wave2', 'dead',
    ]

    it.each(allPoses)('renders pose "%s" with correct dimensions', (pose) => {
      const sprite = CHARACTER_SPRITES[0]
      const grid = renderCharacter(sprite, pose)

      expect(grid).toHaveLength(H)
      for (const row of grid) {
        expect(row).toHaveLength(W)
      }
    })

    it('idle and dance1 produce different outputs', () => {
      const sprite = CHARACTER_SPRITES[0]
      const idle = renderCharacter(sprite, 'idle')
      const dance = renderCharacter(sprite, 'dance1')

      expect(idle).not.toEqual(dance)
    })

    it('idle and dead produce different outputs', () => {
      const sprite = CHARACTER_SPRITES[0]
      const idle = renderCharacter(sprite, 'idle')
      const dead = renderCharacter(sprite, 'dead')

      expect(idle).not.toEqual(dead)
    })

    it('stab pose includes pixel overrides (weapon pixels)', () => {
      const sprite = CHARACTER_SPRITES[0]
      const idle = renderCharacter(sprite, 'idle')
      const stab = renderCharacter(sprite, 'stab')

      // Stab should differ from idle due to weapon overlay and arm position
      expect(stab).not.toEqual(idle)

      // Stab should have extra pixels from the weapon overlay
      const stabPixels = stab.flat().filter(c => c !== null).length
      const idlePixels = idle.flat().filter(c => c !== null).length
      expect(stabPixels).toBeGreaterThanOrEqual(idlePixels)
    })

    it('pee pose includes stream pixel overrides', () => {
      const sprite = CHARACTER_SPRITES[0]
      const pee = renderCharacter(sprite, 'pee')

      // Stream pixels are at y=14,15,16,17 area — check those rows have content
      // that differs from idle
      const idle = renderCharacter(sprite, 'idle')
      expect(pee).not.toEqual(idle)
    })

    it('walk1 and walk2 differ from idle (leg alternation)', () => {
      const sprite = CHARACTER_SPRITES[0]
      const idle = renderCharacter(sprite, 'idle')
      const walk1 = renderCharacter(sprite, 'walk1')
      const walk2 = renderCharacter(sprite, 'walk2')

      expect(walk1).not.toEqual(idle)
      expect(walk2).not.toEqual(idle)
    })

    it('walk1 and walk2 differ from each other', () => {
      const sprite = CHARACTER_SPRITES[0]
      const walk1 = renderCharacter(sprite, 'walk1')
      const walk2 = renderCharacter(sprite, 'walk2')

      expect(walk1).not.toEqual(walk2)
    })

    it('walk poses only modify leg rows (15-17)', () => {
      const sprite = CHARACTER_SPRITES[0]
      const idle = renderCharacter(sprite, 'idle')
      const walk1 = renderCharacter(sprite, 'walk1')

      // Rows 0-14 should be identical
      for (let y = 0; y < 15; y++) {
        expect(walk1[y]).toEqual(idle[y])
      }
      // At least one leg row should differ
      const legRowsDiffer = [15, 16, 17].some(y =>
        JSON.stringify(walk1[y]) !== JSON.stringify(idle[y])
      )
      expect(legRowsDiffer).toBe(true)
    })

    it('walk poses render for all character sprites', () => {
      for (const sprite of CHARACTER_SPRITES) {
        const w1 = renderCharacter(sprite, 'walk1')
        const w2 = renderCharacter(sprite, 'walk2')
        expect(w1).toHaveLength(H)
        expect(w2).toHaveLength(H)
        expect(w1[0]).toHaveLength(W)
        expect(w2[0]).toHaveLength(W)
      }
    })

    it('sleep pose includes Z pixel overrides', () => {
      const sprite = CHARACTER_SPRITES[0]
      const sleep = renderCharacter(sprite, 'sleep')
      const idle = renderCharacter(sprite, 'idle')

      // Sleep has pixelOverrides at [11,1], [12,0], [10,2] — top-right area
      // These should have accessory color pixels
      expect(sleep).not.toEqual(idle)
    })
  })

  describe('SILLY_ANIMATIONS', () => {
    it('has at least 10 animation sequences', () => {
      expect(SILLY_ANIMATIONS.length).toBeGreaterThanOrEqual(10)
    })

    it('each animation has a name, frames array, and frameMs', () => {
      for (const anim of SILLY_ANIMATIONS) {
        expect(anim.name).toBeTruthy()
        expect(anim.frames.length).toBeGreaterThan(0)
        expect(anim.frameMs).toBeGreaterThan(0)
      }
    })

    it('all animation frames reference valid pose names', () => {
      const validPoses: PoseName[] = [
        'idle', 'walk1', 'walk2', 'dance1', 'dance2', 'pee', 'poop', 'vomit',
        'stab', 'shoot', 'panic1', 'panic2', 'sleep',
        'wave1', 'wave2', 'dead',
      ]

      for (const anim of SILLY_ANIMATIONS) {
        for (const frame of anim.frames) {
          expect(validPoses).toContain(frame)
        }
      }
    })

    it('all animations can render every frame for every sprite', () => {
      // Stress test: render every frame of every animation for every character
      for (const sprite of CHARACTER_SPRITES) {
        for (const anim of SILLY_ANIMATIONS) {
          for (const frame of anim.frames) {
            const grid = renderCharacter(sprite, frame)
            expect(grid).toHaveLength(H)
            expect(grid[0]).toHaveLength(W)
          }
        }
      }
    })
  })

  describe('WALK_ANIMATION', () => {
    it('has exactly 2 frames (walk1 and walk2)', () => {
      expect(WALK_ANIMATION.frames).toEqual(['walk1', 'walk2'])
    })

    it('has a frame duration of 200ms', () => {
      expect(WALK_ANIMATION.frameMs).toBe(200)
    })

    it('all frames are valid PoseNames that render correctly', () => {
      const sprite = CHARACTER_SPRITES[0]
      for (const frame of WALK_ANIMATION.frames) {
        const grid = renderCharacter(sprite, frame)
        expect(grid).toHaveLength(H)
        expect(grid[0]).toHaveLength(W)
      }
    })
  })

  describe('getSpriteById', () => {
    it('returns a sprite for a valid id', () => {
      const sprite = getSpriteById('intern')
      expect(sprite).toBeDefined()
      expect(sprite!.id).toBe('intern')
    })

    it('returns undefined for an invalid id', () => {
      expect(getSpriteById('nonexistent')).toBeUndefined()
    })

    it('finds all 22 character sprites by id', () => {
      const expectedIds = [
        'intern', 'patient-zero', 'volunteer', 'whistleblower',
        'middle-mgmt', 'hall-monitor', 'influencer', 'politician',
        'prepper', 'medic', 'engineer', 'chef',
        'philosopher', 'child', 'therapist', 'con-artist',
        'nihilist', 'optimist', 'conspiracy', 'sleeper',
        'clone', 'mascot',
      ]

      for (const id of expectedIds) {
        const sprite = getSpriteById(id)
        expect(sprite).toBeDefined()
        expect(sprite!.id).toBe(id)
      }
    })
  })

  describe('CHARACTER_SPRITES data integrity', () => {
    it('all sprites have unique ids', () => {
      const ids = CHARACTER_SPRITES.map(s => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('all sprites reference valid body indices (0-2)', () => {
      for (const sprite of CHARACTER_SPRITES) {
        expect(sprite.body).toBeGreaterThanOrEqual(0)
        expect(sprite.body).toBeLessThanOrEqual(2)
      }
    })

    it('all sprites reference valid hair indices (0-7)', () => {
      for (const sprite of CHARACTER_SPRITES) {
        expect(sprite.hair).toBeGreaterThanOrEqual(0)
        expect(sprite.hair).toBeLessThanOrEqual(7)
      }
    })

    it('all sprites reference valid outfit indices (0-4)', () => {
      for (const sprite of CHARACTER_SPRITES) {
        expect(sprite.outfit).toBeGreaterThanOrEqual(0)
        expect(sprite.outfit).toBeLessThanOrEqual(4)
      }
    })

    it('all sprites reference valid accessory indices (0-6)', () => {
      for (const sprite of CHARACTER_SPRITES) {
        expect(sprite.accessory).toBeGreaterThanOrEqual(0)
        expect(sprite.accessory).toBeLessThanOrEqual(6)
      }
    })

    it('all palettes have required color fields', () => {
      for (const sprite of CHARACTER_SPRITES) {
        const p = sprite.palette
        expect(p.outline).toMatch(/^#/)
        expect(p.skin).toMatch(/^#/)
        expect(p.skinShadow).toMatch(/^#/)
        expect(p.hair).toMatch(/^#/)
        expect(p.hairHighlight).toMatch(/^#/)
        expect(p.outfitPrimary).toMatch(/^#/)
        expect(p.outfitSecondary).toMatch(/^#/)
        expect(p.shoe).toMatch(/^#/)
      }
    })

    it('sprites with accessories have accessory colors in palette', () => {
      const spritesWithAccessories = CHARACTER_SPRITES.filter(s => s.accessory > 0)
      expect(spritesWithAccessories.length).toBeGreaterThan(0)

      for (const sprite of spritesWithAccessories) {
        expect(sprite.palette.accessory).toBeDefined()
        expect(sprite.palette.accessory).toMatch(/^#/)
      }
    })
  })

  describe('layer compositing', () => {
    it('hair layer overrides body pixels in head area (rows 0-7)', () => {
      // Use a sprite with visible hair (not bald)
      const sprite = getSpriteById('intern')!
      const grid = renderCharacter(sprite)

      // Hair color should appear in the top rows
      const topRowColors = grid.slice(0, 4).flat().filter(Boolean) as string[]
      expect(topRowColors).toContain(sprite.palette.hair)
    })

    it('outfit layer overrides body pixels in torso area', () => {
      // Use a sprite with a lab coat (outfit 1) which has distinct secondary color
      const medic = getSpriteById('medic')!
      const grid = renderCharacter(medic)

      // Outfit colors should appear in the body area (rows 8-17)
      const bodyColors = grid.slice(8, 16).flat().filter(Boolean) as string[]
      expect(bodyColors).toContain(medic.palette.outfitPrimary)
    })

    it('accessory pixels appear on sprites with accessories', () => {
      // Hall monitor has accessory 5 (clipboard) with pixels in rows 10-13
      const hallMonitor = getSpriteById('hall-monitor')!
      expect(hallMonitor.accessory).toBe(5)

      const grid = renderCharacter(hallMonitor)
      const allColors = grid.flat().filter(Boolean) as string[]
      expect(allColors).toContain(hallMonitor.palette.accessory)
    })

    it('sprites without accessories do not crash', () => {
      const volunteer = getSpriteById('volunteer')!
      expect(volunteer.accessory).toBe(0)

      const grid = renderCharacter(volunteer)
      expect(grid).toHaveLength(H)
    })
  })
})
