import { Container, Graphics, Text, Texture, Sprite } from 'pixi.js'
import type { CharacterSprite, PoseName } from '@/config/character-sprites'
import { renderCharacter, SILLY_ANIMATIONS } from '@/config/character-sprites'
import { tileToScreen } from './isometric-utils'

const PIXEL_SCALE = 2
const SPRITE_W = 14
const SPRITE_H = 18

function renderToTexture(sprite: CharacterSprite, pose: PoseName): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_W * PIXEL_SCALE
  canvas.height = SPRITE_H * PIXEL_SCALE
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const grid = renderCharacter(sprite, pose)
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const color = grid[y][x]
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(x * PIXEL_SCALE, y * PIXEL_SCALE, PIXEL_SCALE, PIXEL_SCALE)
      }
    }
  }

  return Texture.from(canvas)
}

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
  private currentAnimation: typeof SILLY_ANIMATIONS[number] | null = null
  private currentFrame = 0

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
      tex = renderToTexture(this.characterSprite, pose)
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

  moveTo(x: number, y: number) {
    this.targetTileX = x
    this.targetTileY = y
    this.moveProgress = 0
  }

  update(dt: number) {
    if (this.moveProgress < 1) {
      this.moveProgress = Math.min(1, this.moveProgress + dt * 2)
      const fromScreen = tileToScreen(this.tileX, this.tileY)
      const toScreen = tileToScreen(this.targetTileX, this.targetTileY)
      // Ease out
      const t = 1 - Math.pow(1 - this.moveProgress, 3)
      this.container.x = fromScreen.x + (toScreen.x - fromScreen.x) * t
      this.container.y = fromScreen.y + (toScreen.y - fromScreen.y) * t
      this.container.zIndex = this.targetTileY * 100 + this.targetTileX

      if (this.moveProgress >= 1) {
        this.tileX = this.targetTileX
        this.tileY = this.targetTileY
        this.updateScreenPosition()
      }
    }
  }

  get isMoving(): boolean {
    return this.moveProgress < 1
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
