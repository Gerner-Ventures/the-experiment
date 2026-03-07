import { Container, Graphics, Text } from 'pixi.js'
import type { AmbientConfig } from '@/types/world'

export class AmbientOverlay {
  container: Container
  private particles: { x: number; y: number; speed: number; char?: string }[] = []
  private graphics: Graphics
  private overlayType: AmbientConfig['overlay']
  private overlayOpacity: number
  private width: number
  private height: number

  constructor(width: number, height: number, config: AmbientConfig) {
    this.container = new Container()
    this.container.zIndex = 1000
    this.width = width
    this.height = height
    this.overlayType = config.overlay
    this.overlayOpacity = config.overlayOpacity ?? 0.1

    // Fog tint
    if (config.fogColor && config.fogOpacity) {
      const fog = new Graphics()
      fog.rect(-width, -height, width * 3, height * 3)
      fog.fill({ color: config.fogColor, alpha: config.fogOpacity })
      this.container.addChild(fog)
    }

    // Scanlines
    if (config.scanlines) {
      const scanlines = new Graphics()
      for (let y = -height; y < height * 2; y += 4) {
        scanlines.rect(-width, y, width * 3, 1)
      }
      scanlines.fill({ color: '#000000', alpha: 0.08 })
      this.container.addChild(scanlines)
    }

    // Particle layer
    this.graphics = new Graphics()
    this.container.addChild(this.graphics)

    if (this.overlayType) {
      this.initParticles()
    }
  }

  private initParticles() {
    const count = this.overlayType === 'code' ? 50 : 80
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: (Math.random() - 0.5) * this.width * 3,
        y: (Math.random() - 0.5) * this.height * 3,
        speed: 0.5 + Math.random() * 2,
        char: this.overlayType === 'code' ? this.randomCodeChar() : undefined,
      })
    }

    // For code rain, use Text objects
    if (this.overlayType === 'code') {
      for (const p of this.particles) {
        const t = new Text({
          text: p.char ?? '0',
          style: {
            fontFamily: 'JetBrains Mono Variable, monospace',
            fontSize: 10,
            fill: '#00ff41',
          },
        })
        t.x = p.x
        t.y = p.y
        t.alpha = this.overlayOpacity * (0.3 + Math.random() * 0.7)
        this.container.addChild(t)
      }
    }
  }

  private randomCodeChar(): string {
    const chars = '01アイウエオカキクケコサシスセソ'
    return chars[Math.floor(Math.random() * chars.length)]
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_dt: number) {
    if (!this.overlayType || this.overlayType === 'code') return

    this.graphics.clear()
    for (const p of this.particles) {
      p.y += p.speed
      if (p.y > this.height * 2) {
        p.y = -this.height
        p.x = (Math.random() - 0.5) * this.width * 3
      }

      switch (this.overlayType) {
        case 'rain':
          this.graphics.moveTo(p.x, p.y)
          this.graphics.lineTo(p.x, p.y + 6)
          this.graphics.stroke({ color: '#aaccff', width: 1, alpha: this.overlayOpacity * 0.5 })
          break
        case 'dust':
          this.graphics.circle(p.x, p.y, 1.5)
          this.graphics.fill({ color: '#d4a04a', alpha: this.overlayOpacity * 0.4 })
          break
        case 'smog':
          this.graphics.circle(p.x, p.y, 3)
          this.graphics.fill({ color: '#333333', alpha: this.overlayOpacity * 0.2 })
          break
      }
    }
  }

  destroy() {
    this.container.destroy({ children: true })
  }
}
