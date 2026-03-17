/**
 * usePerformanceMonitor — Ring buffer performance instrumentation for ECS tick loop.
 *
 * Tracks per-frame and per-system timing and entity counts.
 * Zero-cost in production: all instrumentation is behind isDev().
 */

export interface SystemTiming {
  name: string
  startMs: number
  durationMs: number
}

export interface FrameMetrics {
  totalMs: number
  systems: SystemTiming[]
  entityCount: number
}

export interface PercentileResult {
  p50: number
  p95: number
  p99: number
}

export interface PerformanceMonitor {
  beginFrame(): void
  beginSystem(name: string): void
  endSystem(): void
  endFrame(entityCount: number): void
  getPercentiles(): PercentileResult
  getSystemBreakdown(): Record<string, number>
  exportMetrics(count?: number): FrameMetrics[]
}

const RING_SIZE = 300 // 5 seconds at 60fps

/** Create a no-op monitor for production builds */
function createNoopMonitor(): PerformanceMonitor {
  const noop: PercentileResult = Object.freeze({ p50: 0, p95: 0, p99: 0 })
  return {
    beginFrame() {},
    beginSystem() {},
    endSystem() {},
    endFrame() {},
    getPercentiles() { return noop },
    getSystemBreakdown() { return {} },
    exportMetrics() { return [] },
  }
}

/** Create a real monitor with ring buffer instrumentation */
function createDevMonitor(): PerformanceMonitor {
  const ring: (FrameMetrics | null)[] = new Array(RING_SIZE).fill(null)
  let writeIndex = 0
  let currentFrame: FrameMetrics | null = null

  function beginFrame(): void {
    currentFrame = {
      totalMs: performance.now(),
      systems: [],
      entityCount: 0,
    }
  }

  function beginSystem(name: string): void {
    if (!currentFrame) return
    currentFrame.systems.push({ name, startMs: performance.now(), durationMs: 0 })
  }

  function endSystem(): void {
    if (!currentFrame) return
    const sys = currentFrame.systems[currentFrame.systems.length - 1]
    if (sys) sys.durationMs = performance.now() - sys.startMs
  }

  function endFrame(entityCount: number): void {
    if (!currentFrame) return
    currentFrame.totalMs = performance.now() - currentFrame.totalMs
    currentFrame.entityCount = entityCount
    ring[writeIndex % RING_SIZE] = currentFrame
    writeIndex++
    currentFrame = null
  }

  function getFilledFrames(): FrameMetrics[] {
    const frames: FrameMetrics[] = []
    const start = writeIndex > RING_SIZE ? writeIndex - RING_SIZE : 0
    for (let i = start; i < writeIndex; i++) {
      const entry = ring[i % RING_SIZE]
      if (entry) frames.push(entry)
    }
    return frames
  }

  function getPercentiles(): PercentileResult {
    const frames = getFilledFrames()
    if (frames.length === 0) return { p50: 0, p95: 0, p99: 0 }

    const sorted = frames.map(f => f.totalMs).sort((a, b) => a - b)
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    }
  }

  function getSystemBreakdown(): Record<string, number> {
    const frames = getFilledFrames()
    if (frames.length === 0) return {}

    const totals: Record<string, number> = {}
    const counts: Record<string, number> = {}

    for (const frame of frames) {
      for (const sys of frame.systems) {
        totals[sys.name] = (totals[sys.name] ?? 0) + sys.durationMs
        counts[sys.name] = (counts[sys.name] ?? 0) + 1
      }
    }

    const averages: Record<string, number> = {}
    for (const name of Object.keys(totals)) {
      averages[name] = totals[name] / counts[name]
    }
    return averages
  }

  function exportMetrics(count?: number): FrameMetrics[] {
    const frames = getFilledFrames()
    if (count === undefined) return frames
    return frames.slice(-count)
  }

  return { beginFrame, beginSystem, endSystem, endFrame, getPercentiles, getSystemBreakdown, exportMetrics }
}

import { isDevMode } from '@/utils/env'

export function usePerformanceMonitor(): PerformanceMonitor {
  return isDevMode() ? createDevMonitor() : createNoopMonitor()
}

// Export for direct use in tests
export { createDevMonitor, createNoopMonitor }
