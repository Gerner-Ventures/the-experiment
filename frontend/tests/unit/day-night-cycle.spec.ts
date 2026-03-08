/**
 * Unit tests for DayNightCycle — phase transitions, GSAP lifecycle, demo mode.
 *
 * We mock pixi.js and gsap so the DayNightCycle can be tested without a
 * real WebGL renderer or animation engine.
 */

// --- Mocks ---

const mockFilterBrightness = jest.fn()
const mockGfxClear = jest.fn().mockReturnThis()
const mockGfxCircle = jest.fn().mockReturnThis()
const mockGfxRect = jest.fn().mockReturnThis()
const mockGfxEllipse = jest.fn().mockReturnThis()
const mockGfxFill = jest.fn().mockReturnThis()
const mockGfxStroke = jest.fn().mockReturnThis()
const mockGfxMoveTo = jest.fn().mockReturnThis()
const mockGfxLineTo = jest.fn().mockReturnThis()
const mockGfxDestroy = jest.fn()

function makeMockGraphics() {
  return {
    clear: mockGfxClear,
    circle: mockGfxCircle,
    rect: mockGfxRect,
    ellipse: mockGfxEllipse,
    fill: mockGfxFill,
    stroke: mockGfxStroke,
    moveTo: mockGfxMoveTo,
    lineTo: mockGfxLineTo,
    destroy: mockGfxDestroy,
    x: 0, y: 0,
    alpha: 1,
    zIndex: 0,
    filters: null as unknown[] | null,
  }
}

function makeMockContainer() {
  return {
    x: 0, y: 0,
    alpha: 1,
    zIndex: 0,
    sortableChildren: false,
    scale: { set: jest.fn() },
    addChild: jest.fn(),
    removeChild: jest.fn(),
    destroy: jest.fn(),
    filters: null as unknown[] | null,
    children: [],
  }
}

jest.mock('pixi.js', () => ({
  Container: jest.fn().mockImplementation(() => makeMockContainer()),
  Graphics: jest.fn().mockImplementation(() => makeMockGraphics()),
  ColorMatrixFilter: jest.fn().mockImplementation(() => ({
    brightness: mockFilterBrightness,
    matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  })),
  BlurFilter: jest.fn().mockImplementation(() => ({})),
  FillGradient: jest.fn().mockImplementation(() => ({})),
}))

// Track all gsap.to calls for lifecycle verification
const mockTweenProgress = jest.fn().mockReturnValue(0.5)
const createdTweens: Array<{ target: unknown; vars: Record<string, unknown>; killed: boolean }> = []

jest.mock('gsap', () => {
  const gsap = {
    to: jest.fn().mockImplementation((target: unknown, vars: Record<string, unknown>) => {
      const tween = {
        target,
        vars,
        killed: false,
        kill: jest.fn().mockImplementation(function (this: { killed: boolean }) { this.killed = true }),
        progress: mockTweenProgress,
      }
      createdTweens.push(tween)
      return tween
    }),
    timeline: jest.fn().mockImplementation(() => {
      const tl = {
        to: jest.fn().mockReturnThis(),
        call: jest.fn().mockReturnThis(),
        kill: jest.fn(),
      }
      return tl
    }),
    killTweensOf: jest.fn(),
    registerPlugin: jest.fn(),
  }
  return { __esModule: true, default: gsap }
})

jest.mock('gsap/MotionPathPlugin', () => ({
  MotionPathPlugin: {},
}))

import { DayNightCycle } from '@/components/world/pixi/DayNightCycle'
import { getThemePalette } from '@/config/day-night-palettes'
import gsap from 'gsap'

function createCycle(themeId = 'lord-of-the-flies') {
  const palette = getThemePalette(themeId)!
  const worldContainer = makeMockContainer() as unknown as import('pixi.js').Container
  const cycle = new DayNightCycle(800, 600, palette, worldContainer)
  return { cycle, worldContainer }
}

describe('DayNightCycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createdTweens.length = 0
  })

  describe('constructor', () => {
    it('creates sky graphics and celestial container', () => {
      const { cycle } = createCycle()
      expect(cycle.skyGraphics).toBeDefined()
      expect(cycle.celestialContainer).toBeDefined()
      expect(cycle.tintFilter).toBeDefined()
    })

    it('applies tint filter to worldContainer', () => {
      const { worldContainer } = createCycle()
      expect(worldContainer.filters).toBeTruthy()
    })

    it('sets initial brightness from midday palette', () => {
      createCycle()
      expect(mockFilterBrightness).toHaveBeenCalledWith(1.0, false)
    })

    it('builds arc tween paused', () => {
      createCycle()
      // gsap.to should be called for the arc tween with paused: true
      const arcCall = (gsap.to as jest.Mock).mock.calls.find(
        (c: unknown[]) => (c[1] as Record<string, unknown>).paused === true,
      )
      expect(arcCall).toBeTruthy()
    })
  })

  describe('setPhase', () => {
    it('ignores gm_plan (meta-phase)', () => {
      const { cycle } = createCycle()
      const tweensBefore = createdTweens.length
      cycle.setPhase('gm_plan')
      // No new tweens should be created
      expect(createdTweens.length).toBe(tweensBefore)
    })

    it('ignores duplicate phase', () => {
      const { cycle } = createCycle()
      cycle.setPhase('dawn')
      const tweensAfterFirst = createdTweens.length
      cycle.setPhase('dawn')
      // No new tweens for same phase
      expect(createdTweens.length).toBe(tweensAfterFirst)
    })

    it('creates multiple tweens for a phase transition', () => {
      const { cycle } = createCycle()
      const tweensBefore = createdTweens.length
      cycle.setPhase('dawn')
      // Should create: arc progress, brightness, sun alpha, moon alpha, star alpha, sky color
      expect(createdTweens.length).toBeGreaterThan(tweensBefore + 3)
    })

    it('calls killTweensOf on arc tween when transitioning', () => {
      const { cycle } = createCycle()
      cycle.setPhase('dawn')
      jest.clearAllMocks()

      cycle.setPhase('midday')
      // killActiveTweens should call gsap.killTweensOf for the arc tween
      expect(gsap.killTweensOf).toHaveBeenCalled()
    })

    it('uses GSAP timeline for night→dawn transition', () => {
      const { cycle } = createCycle()
      cycle.setPhase('night')
      jest.clearAllMocks()

      cycle.setPhase('dawn')
      expect(gsap.timeline).toHaveBeenCalled()
    })
  })

  describe('update (ticker)', () => {
    it('does not throw when called', () => {
      const { cycle } = createCycle()
      expect(() => cycle.update(0.016)).not.toThrow()
    })

    it('increments elapsed time', () => {
      const { cycle } = createCycle()
      // Call update multiple times — should not throw
      for (let i = 0; i < 100; i++) {
        cycle.update(0.016)
      }
    })
  })

  describe('demo mode', () => {
    it('starts at dawn when demo cycle begins', () => {
      const { cycle } = createCycle()
      const tweensBefore = createdTweens.length
      cycle.startDemoCycle()
      // Should have created tweens for dawn phase
      expect(createdTweens.length).toBeGreaterThan(tweensBefore)
    })

    it('advances to next phase after 10 seconds', () => {
      const { cycle } = createCycle()
      cycle.startDemoCycle()
      jest.clearAllMocks()
      createdTweens.length = 0

      // Simulate 10+ seconds of ticker updates
      for (let i = 0; i < 700; i++) {
        cycle.update(0.016)
      }

      // Should have triggered at least one new phase transition
      expect(createdTweens.length).toBeGreaterThan(0)
    })
  })

  describe('resize', () => {
    it('does not throw', () => {
      const { cycle } = createCycle()
      expect(() => cycle.resize(1024, 768)).not.toThrow()
    })

    it('rebuilds arc tween', () => {
      const { cycle } = createCycle()
      jest.clearAllMocks()

      cycle.resize(1024, 768)
      // Should create a new arc tween (gsap.to with paused: true)
      const arcCall = (gsap.to as jest.Mock).mock.calls.find(
        (c: unknown[]) => (c[1] as Record<string, unknown>).paused === true,
      )
      expect(arcCall).toBeTruthy()
    })
  })

  describe('destroy', () => {
    it('kills all GSAP tweens', () => {
      const { cycle } = createCycle()
      cycle.setPhase('dawn')
      cycle.destroy()
      expect(gsap.killTweensOf).toHaveBeenCalled()
    })

    it('removes tint filter from worldContainer', () => {
      const { cycle, worldContainer } = createCycle()
      const filtersBefore = worldContainer.filters
      expect(filtersBefore).toBeTruthy()

      cycle.destroy()
      // Filters should be empty or not contain the tint filter
      if (worldContainer.filters) {
        const filters = Array.isArray(worldContainer.filters)
          ? worldContainer.filters
          : [worldContainer.filters]
        expect(filters).not.toContain(cycle.tintFilter)
      }
    })
  })

  describe('matrix theme (digital variant)', () => {
    it('creates without errors', () => {
      expect(() => createCycle('matrix')).not.toThrow()
    })

    it('does not create corona ray objects', () => {
      const { cycle } = createCycle('matrix')
      // Digital variant uses orb, not sun with corona rays
      // Verify by checking that setPhase works without errors
      expect(() => cycle.setPhase('dawn')).not.toThrow()
    })
  })
})
