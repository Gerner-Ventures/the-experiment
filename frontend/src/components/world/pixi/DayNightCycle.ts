import { Container, Graphics, ColorMatrixFilter, BlurFilter, FillGradient } from 'pixi.js'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import type { RoundPhase } from '@/types/websocket'
import {
  PHASE_ARC_POSITIONS,
  type ThemeDayNightPalette,
  type PhasePalette,
} from '@/config/day-night-palettes'

gsap.registerPlugin(MotionPathPlugin)

/** Hex color string to numeric (e.g. '#ff0000' → 0xff0000) */
function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/** Interpolate between two hex color strings, t clamped to [0,1] */
function lerpColor(a: string, b: string, t: number): string {
  const tc = Math.max(0, Math.min(1, t))
  const an = hexToNum(a)
  const bn = hexToNum(b)
  const ar = (an >> 16) & 0xff, ag = (an >> 8) & 0xff, ab = an & 0xff
  const br = (bn >> 16) & 0xff, bg = (bn >> 8) & 0xff, bb = bn & 0xff
  const r = Math.round(ar + (br - ar) * tc)
  const g = Math.round(ag + (bg - ag) * tc)
  const b_ = Math.round(ab + (bb - ab) * tc)
  return `#${((r << 16) | (g << 8) | b_).toString(16).padStart(6, '0')}`
}

export class DayNightCycle {
  /** Sky gradient rect — add to app.stage at z=-1 */
  skyGraphics: Graphics
  /** Sun + moon + stars + shadow — add to app.stage at z=1 */
  celestialContainer: Container
  /** ColorMatrixFilter to apply on worldContainer */
  tintFilter: ColorMatrixFilter

  private palette: ThemeDayNightPalette
  private worldContainer: Container
  private width: number
  private height: number
  private elapsed = 0

  // Arc motion path
  private arcTween: gsap.core.Tween | null = null
  private activeTweens: (gsap.core.Tween | gsap.core.Timeline)[] = []
  private currentPhase: RoundPhase | null = null

  // Tracked brightness (avoids fragile matrix[0] reads)
  private currentBrightness: number

  // Celestial bodies
  private sunContainer: Container
  private moonContainer: Container
  private shadowGraphics: Graphics
  private starContainer: Container
  private starObjects: { gfx: Graphics; baseAlpha: number; phase: number }[] = []

  // Digital orb (Matrix theme)
  private digitalOrb: Container | null = null

  // Corona rays — individual line Graphics for per-frame property updates
  private coronaRayObjects: { gfx: Graphics; angle: number }[] = []

  // Sky gradient state for tweening
  private currentSkyTop: string
  private currentSkyBottom: string

  // Star position seeds (for proportional resize)
  private starSeeds: { nx: number; ny: number; baseAlpha: number; phase: number; radius: number }[] = []

  // Demo mode
  private demoTimer = 0
  private demoPhaseIndex = 0
  private readonly DEMO_PHASES: RoundPhase[] = ['dawn', 'morning', 'midday', 'afternoon', 'night']
  private isDemoMode = false

  constructor(
    width: number,
    height: number,
    palette: ThemeDayNightPalette,
    worldContainer: Container,
  ) {
    this.palette = palette
    this.worldContainer = worldContainer
    this.width = width
    this.height = height

    // Default sky colors (midday)
    const midday = palette.phases.midday
    this.currentSkyTop = midday?.skyTop ?? '#87ceeb'
    this.currentSkyBottom = midday?.skyBottom ?? '#e0f0ff'
    this.currentBrightness = midday?.filterBrightness ?? 1.0

    // Sky gradient
    this.skyGraphics = new Graphics()
    this.skyGraphics.zIndex = -1
    this.drawSkyGradient()

    // Celestial container (screen-space, above world)
    this.celestialContainer = new Container()
    this.celestialContainer.zIndex = 1

    // Stars — individual Graphics objects so twinkle is alpha-only (no clear/rebuild)
    this.starContainer = new Container()
    this.starContainer.alpha = 0
    this.celestialContainer.addChild(this.starContainer)
    this.generateStars()

    // Shadow (below sun)
    this.shadowGraphics = new Graphics()
    this.celestialContainer.addChild(this.shadowGraphics)

    // Sun
    this.sunContainer = new Container()
    this.sunContainer.alpha = 0
    if (palette.celestialVariant === 'digital') {
      this.buildDigitalOrb()
    } else {
      this.buildSun()
    }
    this.celestialContainer.addChild(this.sunContainer)

    // Moon
    this.moonContainer = new Container()
    this.moonContainer.alpha = 0
    if (palette.celestialVariant === 'digital') {
      this.buildDigitalMoon()
    } else {
      this.buildMoon()
    }
    this.celestialContainer.addChild(this.moonContainer)

    // Tint filter on world
    this.tintFilter = new ColorMatrixFilter()
    this.tintFilter.brightness(this.currentBrightness, false)
    worldContainer.filters = worldContainer.filters
      ? [...worldContainer.filters, this.tintFilter]
      : [this.tintFilter]

    // Build arc path
    this.buildArcTween()
  }

  private buildSun(): void {
    const body = new Graphics()
    body.circle(0, 0, 14)
    body.fill(hexToNum(this.palette.sunColor))
    this.sunContainer.addChild(body)

    // Glow
    const glow = new Graphics()
    glow.circle(0, 0, 20)
    glow.fill({ color: hexToNum(this.palette.sunGlowColor), alpha: 0.3 })
    glow.filters = [new BlurFilter({ strength: 8 })]
    this.sunContainer.addChild(glow)

    // Corona rays — pre-built as individual Graphics for efficient per-frame updates
    const color = hexToNum(this.palette.sunGlowColor)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const rayGfx = new Graphics()
      this.drawSingleRay(rayGfx, angle, 22, color)
      this.sunContainer.addChild(rayGfx)
      this.coronaRayObjects.push({ gfx: rayGfx, angle })
    }
  }

  private drawSingleRay(gfx: Graphics, angle: number, len: number, color: number): void {
    gfx.clear()
    gfx.moveTo(Math.cos(angle) * 16, Math.sin(angle) * 16)
    gfx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len)
    gfx.stroke({ color, width: 1.5, alpha: 0.4 })
  }

  private buildMoon(): void {
    // Body
    const body = new Graphics()
    body.circle(0, 0, 10)
    body.fill(hexToNum(this.palette.moonColor))
    this.moonContainer.addChild(body)

    // Crescent overlay — use night sky color from palette for proper theme matching
    const nightPalette = this.palette.phases.night
    const crescentColor = nightPalette ? hexToNum(nightPalette.skyTop) : 0x0a1428
    const crescent = new Graphics()
    crescent.circle(4, -2, 8)
    crescent.fill({ color: crescentColor, alpha: 0.9 })
    this.moonContainer.addChild(crescent)

    // Craters
    const craters = new Graphics()
    craters.circle(-3, 2, 1.5)
    craters.circle(-1, -3, 1)
    craters.circle(2, 4, 1)
    craters.fill({ color: hexToNum(this.palette.moonColor), alpha: 0.5 })
    this.moonContainer.addChild(craters)

    // Glow
    const glow = new Graphics()
    glow.circle(0, 0, 16)
    glow.fill({ color: hexToNum(this.palette.moonGlowColor), alpha: 0.2 })
    glow.filters = [new BlurFilter({ strength: 6 })]
    this.moonContainer.addChild(glow)
  }

  private buildDigitalOrb(): void {
    this.digitalOrb = new Container()

    const core = new Graphics()
    core.circle(0, 0, 12)
    core.fill({ color: hexToNum(this.palette.sunColor), alpha: 0.8 })
    this.digitalOrb.addChild(core)

    const ring = new Graphics()
    ring.circle(0, 0, 18)
    ring.stroke({ color: hexToNum(this.palette.sunColor), width: 1.5, alpha: 0.5 })
    this.digitalOrb.addChild(ring)

    const glow = new Graphics()
    glow.circle(0, 0, 24)
    glow.fill({ color: hexToNum(this.palette.sunGlowColor), alpha: 0.15 })
    glow.filters = [new BlurFilter({ strength: 10 })]
    this.digitalOrb.addChild(glow)

    this.sunContainer.addChild(this.digitalOrb)
  }

  private buildDigitalMoon(): void {
    const core = new Graphics()
    core.circle(0, 0, 10)
    core.fill({ color: hexToNum(this.palette.moonColor), alpha: 0.5 })
    this.moonContainer.addChild(core)

    const ring = new Graphics()
    ring.circle(0, 0, 14)
    ring.stroke({ color: hexToNum(this.palette.moonColor), width: 1, alpha: 0.3 })
    this.moonContainer.addChild(ring)
  }

  private generateStars(): void {
    // Destroy previous star Graphics
    for (const star of this.starObjects) {
      star.gfx.destroy()
    }
    this.starObjects = []

    const count = 50
    // Generate or reuse seeds (seeds store normalized 0-1 positions)
    if (this.starSeeds.length === 0) {
      for (let i = 0; i < count; i++) {
        this.starSeeds.push({
          nx: Math.random(),
          ny: Math.random() * 0.6,
          baseAlpha: 0.3 + Math.random() * 0.7,
          phase: Math.random() * Math.PI * 2,
          radius: 0.5 + Math.random() * 1.5,
        })
      }
    }

    for (const seed of this.starSeeds) {
      const gfx = new Graphics()
      gfx.circle(0, 0, seed.radius)
      gfx.fill({ color: 0xffffff, alpha: seed.baseAlpha })
      gfx.x = seed.nx * this.width
      gfx.y = seed.ny * this.height
      this.starContainer.addChild(gfx)
      this.starObjects.push({ gfx, baseAlpha: seed.baseAlpha, phase: seed.phase })
    }
  }

  private getArcPath(): { x: number; y: number }[] {
    const padX = this.width * 0.1
    const horizonY = this.height * 0.85
    const apexY = this.height * 0.08

    return [
      { x: padX, y: horizonY },
      { x: this.width * 0.25, y: apexY + 40 },
      { x: this.width * 0.5, y: apexY },
      { x: this.width * 0.75, y: apexY + 40 },
      { x: this.width - padX, y: horizonY },
    ]
  }

  private buildArcTween(): void {
    this.sunContainer.x = this.width * 0.5
    this.sunContainer.y = this.height * 0.08

    this.arcTween = gsap.to(this.sunContainer, {
      motionPath: {
        path: this.getArcPath(),
        curviness: 1.5,
      },
      duration: 1,
      paused: true,
      onUpdate: () => this.updateShadowAndScale(),
    })
  }

  private updateShadowAndScale(): void {
    const horizonY = this.height * 0.85
    const apexY = this.height * 0.08
    const sunY = this.sunContainer.y

    // Altitude: 0 at horizon, 1 at apex
    const altitude = Math.max(0, Math.min(1, 1 - (sunY - apexY) / (horizonY - apexY)))

    // Scale: larger at midday (overhead), smaller near horizon
    const scale = 0.6 + altitude * 0.4
    this.sunContainer.scale.set(scale)

    // Shadow
    this.shadowGraphics.clear()
    if (this.sunContainer.alpha > 0.1) {
      const shadowRx = 20 + altitude * 30
      const shadowRy = 3 + altitude * 5
      const shadowAlpha = 0.05 + altitude * 0.15
      const shadowY = sunY + 60 + (1 - altitude) * 40
      this.shadowGraphics.ellipse(this.sunContainer.x, shadowY, shadowRx, shadowRy)
      this.shadowGraphics.fill({ color: 0x000000, alpha: shadowAlpha })
    }
  }

  private drawSkyGradient(): void {
    this.skyGraphics.clear()
    const topColor = hexToNum(this.currentSkyTop)
    const bottomColor = hexToNum(this.currentSkyBottom)

    // Use PixiJS v8 native FillGradient for smooth sky
    const gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: this.height },
      colorStops: [
        { offset: 0, color: topColor },
        { offset: 1, color: bottomColor },
      ],
    })

    this.skyGraphics.rect(0, 0, this.width, this.height)
    this.skyGraphics.fill(gradient)
  }

  /** Kill all active transition tweens and clear the tracking array */
  private killActiveTweens(): void {
    for (const tween of this.activeTweens) {
      tween.kill()
    }
    this.activeTweens = []
    // Also kill any tweens targeting the arc tween object itself
    if (this.arcTween) {
      gsap.killTweensOf(this.arcTween)
    }
  }

  setPhase(phase: RoundPhase): void {
    if (phase === 'gm_plan') return
    if (phase === this.currentPhase) return

    const targetPalette = this.palette.phases[phase]
    if (!targetPalette) return

    // Kill all in-progress transition tweens
    this.killActiveTweens()

    // Night→dawn wrap: fade-through transition
    if (this.currentPhase === 'night' && phase === 'dawn') {
      this.transitionNightToDawn(targetPalette)
      this.currentPhase = phase
      return
    }

    const targetArcT = PHASE_ARC_POSITIONS[phase]

    // Tween arc position
    if (this.arcTween && targetArcT >= 0 && targetArcT <= 1) {
      this.activeTweens.push(
        gsap.to(this.arcTween, {
          progress: targetArcT,
          duration: 2,
          ease: 'power2.inOut',
        }),
      )
    }

    // Tween filter brightness via tracked variable
    const brightnessProxy = { value: this.currentBrightness }
    this.activeTweens.push(
      gsap.to(brightnessProxy, {
        value: targetPalette.filterBrightness,
        duration: 2,
        ease: 'power2.inOut',
        onUpdate: () => {
          this.currentBrightness = brightnessProxy.value
          this.tintFilter.brightness(this.currentBrightness, false)
        },
      }),
    )

    // Tween celestial body visibility
    this.activeTweens.push(
      gsap.to(this.sunContainer, { alpha: targetPalette.sunAlpha, duration: 2, ease: 'power2.inOut' }),
      gsap.to(this.moonContainer, { alpha: targetPalette.moonAlpha, duration: 2, ease: 'power2.inOut' }),
      gsap.to(this.starContainer, { alpha: targetPalette.starOpacity, duration: 2, ease: 'power2.inOut' }),
    )

    // Tween sky colors
    const startTop = this.currentSkyTop
    const startBottom = this.currentSkyBottom
    const skyProxy = { t: 0 }
    this.activeTweens.push(
      gsap.to(skyProxy, {
        t: 1,
        duration: 2,
        ease: 'power2.inOut',
        onUpdate: () => {
          this.currentSkyTop = lerpColor(startTop, targetPalette.skyTop, skyProxy.t)
          this.currentSkyBottom = lerpColor(startBottom, targetPalette.skyBottom, skyProxy.t)
          this.drawSkyGradient()
        },
      }),
    )

    // Position moon at center-top during night
    if (phase === 'night') {
      this.moonContainer.x = this.width * 0.5
      this.moonContainer.y = this.height * 0.15
    }

    this.currentPhase = phase
  }

  private transitionNightToDawn(dawnPalette: PhasePalette): void {
    const tl = gsap.timeline()
    const startTop = this.currentSkyTop
    const startBottom = this.currentSkyBottom

    // 1. Fade out moon + stars
    tl.to(this.moonContainer, { alpha: 0, duration: 0.8 })
    tl.to(this.starContainer, { alpha: 0, duration: 0.8 }, '<')

    // 2. Reset arc to dawn position
    tl.call(() => {
      if (this.arcTween) {
        this.arcTween.progress(PHASE_ARC_POSITIONS.dawn)
      }
    })

    // 3. Fade in sun + update filter + sky
    tl.to(this.sunContainer, { alpha: dawnPalette.sunAlpha, duration: 1.2 })

    // Use tracked brightness rather than hardcoded value
    const proxy = { brightness: this.currentBrightness, t: 0 }
    tl.to(proxy, {
      brightness: dawnPalette.filterBrightness,
      t: 1,
      duration: 1.2,
      onUpdate: () => {
        this.currentBrightness = proxy.brightness
        this.tintFilter.brightness(this.currentBrightness, false)
        this.currentSkyTop = lerpColor(startTop, dawnPalette.skyTop, proxy.t)
        this.currentSkyBottom = lerpColor(startBottom, dawnPalette.skyBottom, proxy.t)
        this.drawSkyGradient()
      },
    }, '<')

    this.activeTweens.push(tl)
  }

  /** Called every frame from the PixiJS ticker */
  update(dt: number): void {
    this.elapsed += dt

    // Star twinkle — alpha-only updates, no Graphics rebuild
    if (this.starContainer.alpha > 0.01) {
      for (const star of this.starObjects) {
        const twinkle = 0.5 + 0.5 * Math.sin(this.elapsed * 1.5 + star.phase)
        star.gfx.alpha = star.baseAlpha * twinkle
      }
    }

    // Corona ray shimmer — redraw individual ray Graphics (8 tiny objects)
    if (this.coronaRayObjects.length > 0 && this.sunContainer.alpha > 0.01) {
      const color = hexToNum(this.palette.sunGlowColor)
      for (let i = 0; i < this.coronaRayObjects.length; i++) {
        const ray = this.coronaRayObjects[i]
        const shimmer = Math.sin(this.elapsed * 2 + i * 1.3) * 4
        this.drawSingleRay(ray.gfx, ray.angle, 22 + shimmer, color)
      }
    }

    // Digital orb pulse
    if (this.digitalOrb && this.sunContainer.alpha > 0.01) {
      this.digitalOrb.alpha = 0.7 + 0.3 * Math.sin(this.elapsed * 3)
    }

    // Demo mode auto-cycling
    if (this.isDemoMode) {
      this.demoTimer += dt
      if (this.demoTimer > 10) {
        this.demoTimer = 0
        this.demoPhaseIndex = (this.demoPhaseIndex + 1) % this.DEMO_PHASES.length
        this.setPhase(this.DEMO_PHASES[this.demoPhaseIndex])
      }
    }
  }

  startDemoCycle(): void {
    this.isDemoMode = true
    this.setPhase('dawn')
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height

    // Save current arc progress
    const currentProgress = this.arcTween?.progress() ?? 0.5
    this.arcTween?.kill()

    // Rebuild arc
    this.buildArcTween()
    if (this.arcTween) {
      this.arcTween.progress(currentProgress)
    }

    // Redraw sky
    this.drawSkyGradient()

    // Reposition stars proportionally (no randomization — uses stable seeds)
    for (let i = 0; i < this.starObjects.length; i++) {
      const seed = this.starSeeds[i]
      this.starObjects[i].gfx.x = seed.nx * this.width
      this.starObjects[i].gfx.y = seed.ny * this.height
    }

    // Reposition moon if visible
    if (this.moonContainer.alpha > 0) {
      this.moonContainer.x = this.width * 0.5
      this.moonContainer.y = this.height * 0.15
    }
  }

  destroy(): void {
    // Kill all tracked GSAP tweens
    this.killActiveTweens()
    this.arcTween?.kill()

    // Kill any remaining tweens on display objects
    gsap.killTweensOf(this.sunContainer)
    gsap.killTweensOf(this.moonContainer)
    gsap.killTweensOf(this.starContainer)

    // Remove tint filter from worldContainer
    if (this.worldContainer.filters) {
      const filters = Array.isArray(this.worldContainer.filters)
        ? this.worldContainer.filters
        : [this.worldContainer.filters]
      this.worldContainer.filters = filters.filter(f => f !== this.tintFilter)
    }

    this.skyGraphics.destroy({ children: true })
    this.celestialContainer.destroy({ children: true })
  }
}
