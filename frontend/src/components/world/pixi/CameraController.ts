import { Container } from 'pixi.js'

const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const PAN_SPEED = 8

/** Dampening factor for scroll zoom (lower = smoother). */
const ZOOM_STEP = 0.03
/** Lerp speed for smooth zoom transitions (0–1, higher = faster snap). */
const ZOOM_LERP = 0.15

export class CameraController {
  private world: Container
  private screenWidth: number
  private screenHeight: number
  private zoom = 1
  /** Target zoom level that the current zoom lerps toward. */
  private targetZoom = 1
  private dragging = false
  private lastPointer = { x: 0, y: 0 }
  private keys = new Set<string>()

  private onKeyDown: (e: KeyboardEvent) => void
  private onKeyUp: (e: KeyboardEvent) => void
  private onWheel: (e: WheelEvent) => void
  private onPointerDown: (e: PointerEvent) => void
  private onPointerMove: (e: PointerEvent) => void
  private onPointerUp: () => void

  constructor(world: Container, canvas: HTMLCanvasElement, screenWidth: number, screenHeight: number) {
    this.world = world
    this.screenWidth = screenWidth
    this.screenHeight = screenHeight

    // Center world on screen
    world.x = screenWidth / 2
    world.y = screenHeight / 2

    this.onKeyDown = (e: KeyboardEvent) => this.keys.add(e.key)
    this.onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key)

    this.onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Normalize deltaY across browsers/devices. Mouse wheel fires ~100-120px
      // per tick while trackpad fires many small events. Dividing by 100 before
      // clamping preserves per-event magnitude differences.
      const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      const normalized = Math.max(-1, Math.min(1, raw / 100))
      const factor = 1 - normalized * ZOOM_STEP
      this.setTargetZoom(this.targetZoom * factor)
    }

    this.onPointerDown = (e: PointerEvent) => {
      this.dragging = true
      this.lastPointer = { x: e.clientX, y: e.clientY }
    }

    this.onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return
      const dx = e.clientX - this.lastPointer.x
      const dy = e.clientY - this.lastPointer.y
      this.world.x += dx
      this.world.y += dy
      this.lastPointer = { x: e.clientX, y: e.clientY }
    }

    this.onPointerUp = () => {
      this.dragging = false
    }

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
  }

  update() {
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) this.world.x += PAN_SPEED
    if (this.keys.has('ArrowRight') || this.keys.has('d')) this.world.x -= PAN_SPEED
    if (this.keys.has('ArrowUp') || this.keys.has('w')) this.world.y += PAN_SPEED
    if (this.keys.has('ArrowDown') || this.keys.has('s')) this.world.y -= PAN_SPEED

    if (this.keys.has('=') || this.keys.has('+')) this.setTargetZoom(this.targetZoom * 1.02)
    if (this.keys.has('-')) this.setTargetZoom(this.targetZoom * 0.98)

    // Lerp current zoom toward target for smooth transitions
    if (Math.abs(this.zoom - this.targetZoom) > 0.001) {
      // Zoom toward/away from screen center to keep the focal point stable
      const prevZoom = this.zoom
      this.zoom += (this.targetZoom - this.zoom) * ZOOM_LERP
      this.world.scale.set(this.zoom)

      // Adjust position so zoom centers on the viewport middle
      const cx = this.screenWidth / 2
      const cy = this.screenHeight / 2
      const ratio = this.zoom / prevZoom
      this.world.x = cx - (cx - this.world.x) * ratio
      this.world.y = cy - (cy - this.world.y) * ratio
    }
  }

  /** Immediately snap to a zoom level, bypassing smooth lerp transition. */
  setZoom(level: number) {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level))
    this.targetZoom = this.zoom
    this.world.scale.set(this.zoom)
  }

  /** Set the zoom target; the actual zoom will lerp toward it each frame. */
  setTargetZoom(level: number) {
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level))
  }

  centerOn(screenX: number, screenY: number) {
    this.world.x = this.screenWidth / 2 - screenX * this.zoom
    this.world.y = this.screenHeight / 2 - screenY * this.zoom
  }

  resize(width: number, height: number) {
    // Re-center the camera when the viewport changes so the map stays centered
    const cx = this.screenWidth / 2
    const cy = this.screenHeight / 2
    const dx = width / 2 - cx
    const dy = height / 2 - cy

    this.screenWidth = width
    this.screenHeight = height

    this.world.x += dx
    this.world.y += dy
  }

  destroy(canvas: HTMLCanvasElement) {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    canvas.removeEventListener('wheel', this.onWheel)
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
  }
}
