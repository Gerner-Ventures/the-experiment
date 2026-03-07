import { Container } from 'pixi.js'

const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const PAN_SPEED = 8

export class CameraController {
  private world: Container
  private screenWidth: number
  private screenHeight: number
  private zoom = 1
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
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      this.setZoom(this.zoom * delta)
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
  }

  update() {
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) this.world.x += PAN_SPEED
    if (this.keys.has('ArrowRight') || this.keys.has('d')) this.world.x -= PAN_SPEED
    if (this.keys.has('ArrowUp') || this.keys.has('w')) this.world.y += PAN_SPEED
    if (this.keys.has('ArrowDown') || this.keys.has('s')) this.world.y -= PAN_SPEED

    if (this.keys.has('=') || this.keys.has('+')) this.setZoom(this.zoom * 1.02)
    if (this.keys.has('-')) this.setZoom(this.zoom * 0.98)
  }

  setZoom(level: number) {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level))
    this.world.scale.set(this.zoom)
  }

  centerOn(screenX: number, screenY: number) {
    this.world.x = this.screenWidth / 2 - screenX * this.zoom
    this.world.y = this.screenHeight / 2 - screenY * this.zoom
  }

  resize(width: number, height: number) {
    this.screenWidth = width
    this.screenHeight = height
  }

  destroy(canvas: HTMLCanvasElement) {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    canvas.removeEventListener('wheel', this.onWheel)
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
  }
}
