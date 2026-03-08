import { Container, Graphics, Text, Texture, Sprite } from 'pixi.js'
import type { HDCharacterDef, HDPoseName, HDAnimationDef } from '@/config/sprites/hd/types'
import { getHDSpriteById } from '@/config/sprites/hd/characters'
import { HDFrameCache } from '@/config/sprites/hd/cache'
import { HD_SILLY_ANIMATIONS, getHDAnimation, getHDAnimationForAction } from '@/config/sprites/hd/animations'
import {
  MOVE_SPEED,
  HD_FEET_OFFSET_Y, HD_HEAD_TOP_OFFSET_Y,
  HD_SELECTION_RING, HD_HIGHLIGHT_RING,
  AGENT_NAME_LABEL,
} from '@/config/sprites/hd/theme'
import { tileToScreen } from './isometric-utils'

export class AgentSpriteObject {
  container: Container
  private pixiSprite: Sprite
  private nameLabel: Text
  private hdCharacter: HDCharacterDef
  private textureCache = new Map<string, Texture>()

  tileX: number
  tileY: number
  targetTileX: number
  targetTileY: number
  private moveProgress = 1 // 1 = arrived

  private animTimer: ReturnType<typeof setTimeout> | null = null
  private actionTimer: ReturnType<typeof setTimeout> | null = null
  private walkTimer: ReturnType<typeof setInterval> | null = null
  private walkFrame = 0
  private currentHDAnimation: HDAnimationDef | null = null
  private currentFrame = 0
  private animCompleteCallback: (() => void) | null = null

  // Path following (tile-by-tile)
  private pathQueue: { x: number; y: number }[] = []
  private pathCallback: (() => void) | null = null

  constructor(
    public readonly id: string,
    public readonly name: string,
    characterIdOrDef: { id: string },
    startX: number,
    startY: number,
  ) {
    // Resolve HD character definition
    this.hdCharacter = (typeof characterIdOrDef === 'object' && 'basePalette' in characterIdOrDef)
      ? characterIdOrDef as HDCharacterDef
      : getHDSpriteById(characterIdOrDef.id)!

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

    // Name label — positioned above character head
    this.nameLabel = new Text({
      text: name,
      style: {
        fontFamily: AGENT_NAME_LABEL.fontFamily,
        fontSize: AGENT_NAME_LABEL.fontSize,
        fill: AGENT_NAME_LABEL.fill,
        align: 'center',
      },
    })
    this.nameLabel.anchor.set(0.5, 1)
    this.nameLabel.y = HD_HEAD_TOP_OFFSET_Y
    this.nameLabel.alpha = AGENT_NAME_LABEL.alpha
    this.nameLabel.zIndex = 2
    this.container.addChild(this.nameLabel)

    // Position
    this.updateScreenPosition()
  }

  private getTexture(pose: string): Texture {
    let tex = this.textureCache.get(pose)
    if (!tex) {
      const canvas = HDFrameCache.get(this.hdCharacter, pose as HDPoseName)
      tex = Texture.from(canvas)
      this.textureCache.set(pose, tex)
    }
    return tex
  }

  setPose(pose: string) {
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
    const hdWalk = getHDAnimation('walk')
    this.setPose(hdWalk.poses[0])
    this.walkTimer = setInterval(() => {
      this.walkFrame = (this.walkFrame + 1) % hdWalk.poses.length
      this.setPose(hdWalk.poses[this.walkFrame])
    }, Math.round(1000 / (60 * hdWalk.speed)))
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
      this.container.x = fromScreen.x + (toScreen.x - fromScreen.x) * this.moveProgress
      this.container.y = fromScreen.y + (toScreen.y - fromScreen.y) * this.moveProgress
      this.container.zIndex = this.targetTileY * 100 + this.targetTileX

      if (this.moveProgress >= 1) {
        this.tileX = this.targetTileX
        this.tileY = this.targetTileY
        this.updateScreenPosition()

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

  /**
   * Play a named animation (looks up from HD animation registry).
   * Always returns a valid animation (falls back to wave if not found).
   */
  playAnimationByName(animName: string, onComplete?: () => void) {
    const hdAnim = getHDAnimationForAction(animName) ?? getHDAnimation(animName)
    this.playHDAnimation(hdAnim, onComplete)
  }

  playHDAnimation(anim: HDAnimationDef, onComplete?: () => void) {
    this.stopAnimation()
    this.currentHDAnimation = anim
    this.currentFrame = 0
    this.animCompleteCallback = onComplete ?? null
    this.advanceHDFrame()
  }

  private advanceHDFrame() {
    if (!this.currentHDAnimation) return
    const anim = this.currentHDAnimation
    if (this.currentFrame >= anim.poses.length) {
      if (anim.loop) {
        this.currentFrame = 0
      } else {
        const cb = this.animCompleteCallback
        this.currentHDAnimation = null
        this.animCompleteCallback = null
        this.setPose('idle')
        cb?.()
        return
      }
    }
    this.setPose(anim.poses[this.currentFrame])
    this.currentFrame++
    const frameMs = Math.round(1000 / (60 * anim.speed))
    this.animTimer = setTimeout(() => this.advanceHDFrame(), frameMs)
  }

  get isAnimating(): boolean {
    return this.currentHDAnimation !== null
  }

  startRandomBehavior(getNeighbors: (x: number, y: number) => { x: number; y: number }[]) {
    if (this.actionTimer) return

    const doAction = () => {
      if (this.isMoving || this.isAnimating) {
        this.actionTimer = setTimeout(doAction, 500)
        return
      }

      const roll = Math.random()
      if (roll < 0.5) {
        const neighbors = getNeighbors(this.tileX, this.tileY)
        if (neighbors.length > 0) {
          const target = neighbors[Math.floor(Math.random() * neighbors.length)]
          this.moveTo(target.x, target.y)
        }
      } else {
        const hdAnim = HD_SILLY_ANIMATIONS[Math.floor(Math.random() * HD_SILLY_ANIMATIONS.length)]
        this.playHDAnimation(hdAnim)
      }

      const delay = 1000 + Math.random() * 3000
      this.actionTimer = setTimeout(doAction, delay)
    }

    this.actionTimer = setTimeout(doAction, Math.random() * 2000)
  }

  stopAnimation() {
    if (this.animTimer) {
      clearTimeout(this.animTimer)
      this.animTimer = null
    }
    this.currentHDAnimation = null
    this.currentFrame = 0
    this.animCompleteCallback = null
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

  // ─── Selection ring ───

  addSelectionRing() {
    const s = HD_SELECTION_RING
    const ring = new Graphics()
    ring.ellipse(0, HD_FEET_OFFSET_Y, s.rx, s.ry)
    ring.stroke({ color: s.color, width: s.strokeWidth, alpha: s.alpha })
    ring.label = 'selection-ring'
    this.container.addChildAt(ring, 0)
  }

  removeSelectionRing() {
    const ring = this.container.children.find(c => c.label === 'selection-ring')
    if (ring) this.container.removeChild(ring)
  }

  // ─── Target highlight ring ───

  setHighlight(color: string) {
    this.clearHighlight()
    const h = HD_HIGHLIGHT_RING
    const ring = new Graphics()
    ring.ellipse(0, HD_FEET_OFFSET_Y, h.rx, h.ry)
    ring.stroke({ color, width: h.strokeWidth, alpha: h.alpha })
    ring.label = 'highlight-ring'
    this.container.addChildAt(ring, 0)
  }

  clearHighlight() {
    const ring = this.container.children.find(c => c.label === 'highlight-ring')
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
