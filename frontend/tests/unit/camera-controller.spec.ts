/**
 * Unit tests for CameraController — zoom dampening, lerp, centering, resize.
 *
 * We mock pixi.js Container and create a minimal canvas stub so the
 * CameraController can be tested without a real PixiJS renderer.
 */

// Mock pixi.js before importing CameraController
jest.mock('pixi.js', () => ({
  Container: jest.fn().mockImplementation(() => ({
    x: 0,
    y: 0,
    scale: { set: jest.fn() },
    sortableChildren: false,
  })),
}))

import { Container } from 'pixi.js'
import { CameraController } from '@/components/world/pixi/CameraController'

// jsdom does not provide PointerEvent — polyfill it from MouseEvent
if (typeof globalThis.PointerEvent === 'undefined') {
  (globalThis as Record<string, unknown>).PointerEvent = class PointerEvent extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, init?: PointerEventInit) {
      super(type, init)
      this.pointerId = init?.pointerId ?? 0
    }
  }
}

function makeWorld() {
  const world = new Container() as unknown as Container & {
    x: number
    y: number
    scale: { set: jest.Mock }
  }
  return world
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  return canvas
}

describe('CameraController', () => {
  let world: ReturnType<typeof makeWorld>
  let canvas: HTMLCanvasElement
  let camera: CameraController

  beforeEach(() => {
    world = makeWorld()
    canvas = makeCanvas()
    camera = new CameraController(world, canvas, 800, 600)
  })

  afterEach(() => {
    camera.destroy(canvas)
  })

  describe('constructor', () => {
    it('centers world on screen', () => {
      expect(world.x).toBe(400) // 800 / 2
      expect(world.y).toBe(300) // 600 / 2
    })
  })

  describe('setZoom', () => {
    it('sets zoom immediately and calls scale.set', () => {
      camera.setZoom(2)
      expect(world.scale.set).toHaveBeenCalledWith(2)
    })

    it('clamps zoom to minimum (0.3)', () => {
      camera.setZoom(0.1)
      expect(world.scale.set).toHaveBeenCalledWith(0.3)
    })

    it('clamps zoom to maximum (3)', () => {
      camera.setZoom(5)
      expect(world.scale.set).toHaveBeenCalledWith(3)
    })

    it('does not trigger lerp on next update (snap)', () => {
      camera.setZoom(2)
      world.scale.set.mockClear()
      // After setZoom, zoom === targetZoom, so update should not call scale.set
      camera.update()
      expect(world.scale.set).not.toHaveBeenCalled()
    })
  })

  describe('setTargetZoom', () => {
    it('does not immediately change scale', () => {
      world.scale.set.mockClear()
      camera.setTargetZoom(2)
      // scale.set should not be called until update()
      expect(world.scale.set).not.toHaveBeenCalled()
    })

    it('clamps target to minimum', () => {
      camera.setTargetZoom(0.01)
      // Run many updates to converge
      for (let i = 0; i < 200; i++) camera.update()
      // Should have converged near 0.3
      const lastCall = world.scale.set.mock.calls[world.scale.set.mock.calls.length - 1]
      expect(lastCall[0]).toBeCloseTo(0.3, 2)
    })

    it('clamps target to maximum', () => {
      camera.setTargetZoom(10)
      for (let i = 0; i < 200; i++) camera.update()
      const lastCall = world.scale.set.mock.calls[world.scale.set.mock.calls.length - 1]
      expect(lastCall[0]).toBeCloseTo(3, 2)
    })
  })

  describe('update — lerp zoom', () => {
    it('gradually approaches target zoom', () => {
      camera.setTargetZoom(2)

      // After one update, zoom should move toward 2 but not reach it
      camera.update()
      const firstCall = world.scale.set.mock.calls[0][0]
      expect(firstCall).toBeGreaterThan(1)
      expect(firstCall).toBeLessThan(2)

      // After many updates, zoom should converge to target
      for (let i = 0; i < 100; i++) camera.update()
      const lastCall = world.scale.set.mock.calls[world.scale.set.mock.calls.length - 1]
      expect(lastCall[0]).toBeCloseTo(2, 2)
    })

    it('does not call scale.set when zoom equals target', () => {
      camera.setZoom(1.5)
      world.scale.set.mockClear()
      camera.update()
      expect(world.scale.set).not.toHaveBeenCalled()
    })

    it('adjusts world position to keep viewport center stable during zoom', () => {
      // Set world to a known offset
      world.x = 100
      world.y = 50
      camera.setTargetZoom(2)

      const prevX = world.x
      const prevY = world.y

      camera.update()

      // World position should shift during zoom to keep center stable
      // (unless world is already at screen center)
      expect(world.x).not.toBe(prevX)
      expect(world.y).not.toBe(prevY)
    })
  })

  describe('centerOn', () => {
    it('positions world so given screen coord is at viewport center', () => {
      camera.setZoom(1)
      camera.centerOn(200, 100)
      // world.x = screenWidth/2 - screenX * zoom = 400 - 200 = 200
      // world.y = screenHeight/2 - screenY * zoom = 300 - 100 = 200
      expect(world.x).toBe(200)
      expect(world.y).toBe(200)
    })

    it('accounts for zoom level when centering', () => {
      camera.setZoom(2)
      camera.centerOn(200, 100)
      // world.x = 400 - 200 * 2 = 0
      // world.y = 300 - 100 * 2 = 100
      expect(world.x).toBe(0)
      expect(world.y).toBe(100)
    })
  })

  describe('resize', () => {
    it('shifts world position to keep the same center point', () => {
      camera.centerOn(100, 100)
      const prevX = world.x
      const prevY = world.y

      // Resize from 800x600 to 1000x800
      camera.resize(1000, 800)

      // dx = 1000/2 - 800/2 = 100, dy = 800/2 - 600/2 = 100
      expect(world.x).toBe(prevX + 100)
      expect(world.y).toBe(prevY + 100)
    })

    it('handles shrinking viewport', () => {
      world.x = 400
      world.y = 300

      camera.resize(600, 400)

      // dx = 600/2 - 800/2 = -100, dy = 400/2 - 600/2 = -100
      expect(world.x).toBe(300)
      expect(world.y).toBe(200)
    })
  })

  describe('keyboard panning', () => {
    it('pans world when arrow keys are held', () => {
      const initialX = world.x
      const initialY = world.y

      // Simulate ArrowRight keydown
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      camera.update()

      expect(world.x).toBe(initialX - 8) // PAN_SPEED = 8, right = negative x
      expect(world.y).toBe(initialY)

      // Clean up
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }))
    })

    it('pans with WASD keys', () => {
      const initialY = world.y

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
      camera.update()

      expect(world.y).toBe(initialY + 8) // up = positive y

      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }))
    })
  })

  describe('wheel zoom normalization', () => {
    it('handles mouse wheel (large deltaY ~100) as full zoom step', () => {
      camera.setZoom(1)
      world.scale.set.mockClear()

      // Simulate mouse wheel scroll down (deltaY = 100, deltaMode = 0)
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 100,
        deltaMode: 0,
        bubbles: true,
      }))

      // Should set target zoom. Run an update to see the lerp begin
      camera.update()
      expect(world.scale.set).toHaveBeenCalled()
      // Zoom should decrease (scroll down = zoom out)
      const zoomValue = world.scale.set.mock.calls[0][0]
      expect(zoomValue).toBeLessThan(1)
    })

    it('handles trackpad pinch (small deltaY) as proportional step', () => {
      camera.setZoom(1)
      world.scale.set.mockClear()

      // Simulate several trackpad pinch events (deltaY = 10 each, deltaMode = 0)
      // 10/100 = 0.1 normalized → target moves by 0.1 * 0.03 = 0.003 per event
      for (let i = 0; i < 5; i++) {
        canvas.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 10,
          deltaMode: 0,
          bubbles: true,
        }))
      }

      camera.update()
      expect(world.scale.set).toHaveBeenCalled()
      const zoomValue = world.scale.set.mock.calls[0][0]
      // Should zoom out (scroll down) but much less than a full mouse wheel
      expect(zoomValue).toBeLessThan(1)
      expect(zoomValue).toBeGreaterThan(0.98)
    })

    it('handles deltaMode=1 (line-based scroll)', () => {
      camera.setZoom(1)
      world.scale.set.mockClear()

      // deltaMode=1, deltaY=3 lines → raw = 3 * 16 = 48
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 3,
        deltaMode: 1,
        bubbles: true,
      }))

      camera.update()
      expect(world.scale.set).toHaveBeenCalled()
      const zoomValue = world.scale.set.mock.calls[0][0]
      expect(zoomValue).toBeLessThan(1)
    })
  })

  describe('pointer dragging', () => {
    it('pans world when dragging', () => {
      const initialX = world.x
      const initialY = world.y

      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }))

      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 150,
        clientY: 120,
      }))

      expect(world.x).toBe(initialX + 50)
      expect(world.y).toBe(initialY + 20)

      window.dispatchEvent(new PointerEvent('pointerup', {}))
    })

    it('does not pan when not dragging', () => {
      const initialX = world.x

      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 200,
        clientY: 200,
      }))

      expect(world.x).toBe(initialX)
    })

    it('stops dragging on pointercancel', () => {
      const initialX = world.x

      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }))

      window.dispatchEvent(new PointerEvent('pointercancel', {}))

      // Now pointermove should not pan
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 200,
        clientY: 200,
      }))

      // x should only reflect the initial pointerdown positioning, not the move
      expect(world.x).toBe(initialX)
    })
  })

  describe('destroy', () => {
    it('removes event listeners so updates stop working', () => {
      camera.destroy(canvas)

      const initialX = world.x
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      camera.update()

      // Key should not have been registered since listeners were removed
      expect(world.x).toBe(initialX)
    })
  })
})
