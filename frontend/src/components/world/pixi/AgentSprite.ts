import { Container, Graphics, Text, Texture, Sprite } from 'pixi.js'
import type { CharacterSprite, PoseName } from '@/config/character-sprites'
import { SILLY_ANIMATIONS, WALK_ANIMATION, renderSpriteToCanvas } from '@/config/character-sprites'
import { tileToScreen } from './isometric-utils'

/** Tile-to-tile movement speed: higher = faster. 4 = ~0.25s per tile (Pokemon-style). */
const MOVE_SPEED = 4

export class AgentSpriteObject {
  container: Container
  private pixiSprite: Sprite
  private nameLabel: Text
  private characterSprite: CharacterSprite
  private textureCache = new Map<PoseName, Texture>()

  tileX: number
  tileY: number
  targetTileX: number
  targetTileY: number
  private moveProgress = 1 // 1 = arrived

  private animTimer: ReturnType<typeof setTimeout> | null = null
  private actionTimer: ReturnType<typeof setTimeout> | null = null
  private walkTimer: ReturnType<typeof setInterval> | null = null
  private walkFrame = 0
  private currentAnimation: typeof SILLY_ANIMATIONS[number] | null = null
  private currentFrame = 0

  // Path following (tile-by-tile)
  private pathQueue: { x: number; y: number }[] = []
  private pathCallback: (() => void) | null = null

  constructor(
    public readonly id: string,
    public readonly name: string,
    characterSprite: CharacterSprite,
    startX: number,
    startY: number,
  ) {
    this.characterSprite = characterSprite
    this.tileX = startX
    this.tileY = startY
    this.targetTileX = startX
    this.targetTileY = startY

    this.container = new Container()
    this.container.sortableChildren = true

    // Create sprite
    const tex = this.getTexture('idle')
    this.pixiSprite = new Sprite(tex)
    this.pixiSprite.anchor.set(0.5, 1)
    this.pixiSprite.zIndex = 1
    this.container.addChild(this.pixiSprite)

    // Name label
    this.nameLabel = new Text({
      text: name,
      style: {
        fontFamily: 'JetBrains Mono Variable, monospace',
        fontSize: 8,
        fill: '#ffffff',
        align: 'center',
      },
    })
    this.nameLabel.anchor.set(0.5, 0)
    this.nameLabel.y = 4
    this.nameLabel.alpha = 0.6
    this.nameLabel.zIndex = 2
    this.container.addChild(this.nameLabel)

    // Position
    this.updateScreenPosition()
  }

  private getTexture(pose: PoseName): Texture {
    let tex = this.textureCache.get(pose)
    if (!tex) {
      tex = Texture.from(renderSpriteToCanvas(this.characterSprite, pose))
      this.textureCache.set(pose, tex)
    }
    return tex
  }

  setPose(pose: PoseName) {
    this.pixiSprite.texture = this.getTexture(pose)
  }

  private updateScreenPosition() {
    const screen = tileToScreen(this.tileX, this.tileY)
    this.container.x = screen.x
    this.container.y = screen.y
    this.container.zIndex = this.tileY * 100 + this.tileX
  }

  /** Move directly to a single adjacent tile (used by demo random walk) */
  moveTo(x: number, y: number) {
    this.pathQueue = []
    this.pathCallback = null
    this.targetTileX = x
    this.targetTileY = y
    this.moveProgress = 0
    if (!this.walkTimer) {
      this.startWalkCycle()
    }
  }

  /** Walk along a path of tiles, one step at a time. Calls onComplete when done. */
  followPath(path: { x: number; y: number }[], onComplete?: () => void) {
    this.pathQueue = [...path]
    this.pathCallback = onComplete ?? null
    console.debug(`[AgentSprite] ${this.name} following path of ${path.length} tiles`)

    if (path.length === 0) {
      // Already at destination
      const cb = this.pathCallback
      this.pathCallback = null
      cb?.()
      return
    }

    this.startWalkCycle()
    this.walkNextStep()
  }

  private walkNextStep() {
    if (this.pathQueue.length === 0) {
      this.stopWalkCycle()
      this.setPose('idle')
      const cb = this.pathCallback
      this.pathCallback = null
      cb?.()
      return
    }
    const next = this.pathQueue.shift()!
    this.targetTileX = next.x
    this.targetTileY = next.y
    this.moveProgress = 0
  }

  private startWalkCycle() {
    this.stopWalkCycle()
    this.walkFrame = 0
    this.setPose(WALK_ANIMATION.frames[0])
    this.walkTimer = setInterval(() => {
      this.walkFrame = (this.walkFrame + 1) % WALK_ANIMATION.frames.length
      this.setPose(WALK_ANIMATION.frames[this.walkFrame])
    }, WALK_ANIMATION.frameMs)
  }

  private stopWalkCycle() {
    if (this.walkTimer) {
      clearInterval(this.walkTimer)
      this.walkTimer = null
    }
  }

  update(dt: number) {
    if (this.moveProgress < 1) {
      this.moveProgress = Math.min(1, this.moveProgress + dt * MOVE_SPEED)
      const fromScreen = tileToScreen(this.tileX, this.tileY)
      const toScreen = tileToScreen(this.targetTileX, this.targetTileY)
      // Linear interpolation for tile-by-tile walking (no easing)
      this.container.x = fromScreen.x + (toScreen.x - fromScreen.x) * this.moveProgress
      this.container.y = fromScreen.y + (toScreen.y - fromScreen.y) * this.moveProgress
      this.container.zIndex = this.targetTileY * 100 + this.targetTileX

      if (this.moveProgress >= 1) {
        this.tileX = this.targetTileX
        this.tileY = this.targetTileY
        this.updateScreenPosition()

        // If following a path, continue to next tile
        if (this.pathQueue.length > 0) {
          this.walkNextStep()
        } else {
          this.stopWalkCycle()
          this.setPose('idle')
          const cb = this.pathCallback
          this.pathCallback = null
          cb?.()
        }
      }
    }
  }

  get isMoving(): boolean {
    return this.moveProgress < 1 || this.pathQueue.length > 0
  }

  playAnimation(anim: typeof SILLY_ANIMATIONS[number]) {
    this.stopAnimation()
    this.currentAnimation = anim
    this.currentFrame = 0
    this.advanceFrame()
  }

  private advanceFrame() {
    if (!this.currentAnimation) return
    if (this.currentFrame >= this.currentAnimation.frames.length) {
      this.currentAnimation = null
      this.setPose('idle')
      return
    }
    this.setPose(this.currentAnimation.frames[this.currentFrame])
    this.currentFrame++
    this.animTimer = setTimeout(() => this.advanceFrame(), this.currentAnimation!.frameMs)
  }

  get isAnimating(): boolean {
    return this.currentAnimation !== null
  }

  startRandomBehavior(getNeighbors: (x: number, y: number) => { x: number; y: number }[]) {
    // Guard against double-start
    if (this.actionTimer) return

    const doAction = () => {
      if (this.isMoving || this.isAnimating) {
        this.actionTimer = setTimeout(doAction, 500)
        return
      }

      const roll = Math.random()
      if (roll < 0.5) {
        // Random walk
        const neighbors = getNeighbors(this.tileX, this.tileY)
        if (neighbors.length > 0) {
          const target = neighbors[Math.floor(Math.random() * neighbors.length)]
          this.moveTo(target.x, target.y)
        }
      } else {
        // Random silly animation
        const anim = SILLY_ANIMATIONS[Math.floor(Math.random() * SILLY_ANIMATIONS.length)]
        this.playAnimation(anim)
      }

      const delay = 1000 + Math.random() * 3000
      this.actionTimer = setTimeout(doAction, delay)
    }

    // Start after a random initial delay
    this.actionTimer = setTimeout(doAction, Math.random() * 2000)
  }

  stopAnimation() {
    if (this.animTimer) {
      clearTimeout(this.animTimer)
      this.animTimer = null
    }
    this.currentAnimation = null
    this.currentFrame = 0
  }

  stopAllBehavior() {
    this.stopAnimation()
    this.stopWalkCycle()
    this.pathQueue = []
    const cb = this.pathCallback
    this.pathCallback = null
    cb?.()
    if (this.actionTimer) {
      clearTimeout(this.actionTimer)
      this.actionTimer = null
    }
  }

  addSelectionRing() {
    const ring = new Graphics()
    ring.ellipse(0, 0, 20, 10)
    ring.stroke({ color: '#00e5a0', width: 2, alpha: 0.8 })
    ring.label = 'selection-ring'
    this.container.addChildAt(ring, 0)
  }

  removeSelectionRing() {
    const ring = this.container.children.find(c => c.label === 'selection-ring')
    if (ring) this.container.removeChild(ring)
  }

  destroy() {
    this.stopAllBehavior()
    for (const tex of this.textureCache.values()) {
      tex.destroy(true)
    }
    this.textureCache.clear()
    this.container.destroy({ children: true })
  }
}
