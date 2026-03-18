import { Container, Graphics, Text, Texture, Sprite } from 'pixi.js'
import type { HDCharacterDef, HDPoseName } from '@/config/sprites/hd/types'
import { getHDSpriteById } from '@/config/sprites/hd/characters'
import { HDFrameCache } from '@/config/sprites/hd/cache'
import {
  HD_FEET_OFFSET_Y, HD_HEAD_TOP_OFFSET_Y,
  HD_SELECTION_RING, HD_HIGHLIGHT_RING,
  AGENT_NAME_LABEL,
} from '@/config/sprites/hd/theme'
import { tileToScreen } from './isometric-utils'

/**
 * AgentSpriteObject — PixiJS display wrapper for a single agent.
 *
 * Owns: Container, sprite, name label, texture cache, selection/highlight rings.
 * Does NOT own: movement, animation, pathfinding (all driven by ECS systems
 * via setPose() and container.x/y writes from the RenderBridge).
 */
export class AgentSpriteObject {
  container: Container
  private pixiSprite: Sprite
  private nameLabel: Text
  private hdCharacter: HDCharacterDef
  private textureCache = new Map<string, Texture>()

  tileX: number
  tileY: number

  private idleCallbackHandle: number | null = null

  constructor(
    public readonly id: string,
    public readonly name: string,
    characterIdOrDef: { id: string },
    startX: number,
    startY: number,
  ) {
    // Resolve HD character definition
    const resolved = (typeof characterIdOrDef === 'object' && 'basePalette' in characterIdOrDef)
      ? characterIdOrDef as HDCharacterDef
      : getHDSpriteById(characterIdOrDef.id)
    if (!resolved) {
      console.error(`[AgentSprite] Unknown character ID: ${characterIdOrDef.id}, falling back to first available`)
    }
    this.hdCharacter = resolved ?? getHDSpriteById('lotf_ralph')!

    this.tileX = startX
    this.tileY = startY

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
    const screen = tileToScreen(startX, startY)
    this.container.x = screen.x
    this.container.y = screen.y
    this.container.zIndex = startY * 100 + startX

    // Pre-render common poses in idle time (idle already cached from getTexture above)
    if (typeof requestIdleCallback === 'function') {
      const char = this.hdCharacter
      this.idleCallbackHandle = requestIdleCallback(() => {
        this.idleCallbackHandle = null
        HDFrameCache.prerender(char, [
          'walk1', 'walk2', 'talk1', 'talk2',
          'wave1', 'wave2', 'punch1', 'punch2',
        ] as HDPoseName[])
      })
    }
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

  /** Set the sprite's current pose (called by renderSyncSystem via RenderBridge) */
  setPose(pose: string) {
    this.pixiSprite.texture = this.getTexture(pose)
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
    if (this.idleCallbackHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.idleCallbackHandle)
      this.idleCallbackHandle = null
    }
    for (const tex of this.textureCache.values()) {
      tex.destroy(true)
    }
    this.textureCache.clear()
    this.container.destroy({ children: true })
  }
}
