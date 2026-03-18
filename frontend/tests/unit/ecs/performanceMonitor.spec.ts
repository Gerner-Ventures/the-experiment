/**
 * usePerformanceMonitor unit tests — ring buffer, frozen noop, system breakdown.
 */

import { createDevMonitor, createNoopMonitor } from '@/composables/usePerformanceMonitor'

describe('createNoopMonitor', () => {
  it('returns frozen percentile object', () => {
    const monitor = createNoopMonitor()
    const p = monitor.getPercentiles()

    expect(p).toEqual({ p50: 0, p95: 0, p99: 0 })
    expect(Object.isFrozen(p)).toBe(true)
  })

  it('returns same frozen object on repeated calls', () => {
    const monitor = createNoopMonitor()
    const p1 = monitor.getPercentiles()
    const p2 = monitor.getPercentiles()

    expect(p1).toBe(p2) // referential equality — no allocation
  })

  it('returns empty breakdown and metrics', () => {
    const monitor = createNoopMonitor()
    expect(monitor.getSystemBreakdown()).toEqual({})
    expect(monitor.exportMetrics()).toEqual([])
  })
})

describe('createDevMonitor ring buffer', () => {
  it('wraps around after RING_SIZE (300) frames', () => {
    const monitor = createDevMonitor()

    // Fill 350 frames — buffer is 300, so first 50 are overwritten
    for (let i = 0; i < 350; i++) {
      monitor.beginFrame()
      monitor.beginSystem('test')
      monitor.endSystem()
      monitor.endFrame(10)
    }

    // exportMetrics should return at most 300 frames
    const metrics = monitor.exportMetrics()
    expect(metrics.length).toBe(300)
  })

  it('tracks entity count per frame', () => {
    const monitor = createDevMonitor()

    monitor.beginFrame()
    monitor.endFrame(42)

    const metrics = monitor.exportMetrics()
    expect(metrics).toHaveLength(1)
    expect(metrics[0].entityCount).toBe(42)
  })

  it('computes percentiles correctly', () => {
    const monitor = createDevMonitor()

    // Simulate 100 frames with varying timing
    for (let i = 0; i < 100; i++) {
      monitor.beginFrame()
      // Spin to create measurable time
      const end = performance.now() + 0.01
      while (performance.now() < end) { /* spin */ }
      monitor.endFrame(10)
    }

    const p = monitor.getPercentiles()
    expect(p.p50).toBeGreaterThan(0)
    expect(p.p95).toBeGreaterThanOrEqual(p.p50)
    expect(p.p99).toBeGreaterThanOrEqual(p.p95)
  })

  it('returns zero percentiles when no frames recorded', () => {
    const monitor = createDevMonitor()
    const p = monitor.getPercentiles()
    expect(p).toEqual({ p50: 0, p95: 0, p99: 0 })
  })
})

describe('system breakdown', () => {
  it('tracks per-system average timing', () => {
    const monitor = createDevMonitor()

    for (let i = 0; i < 10; i++) {
      monitor.beginFrame()
      monitor.beginSystem('water')
      monitor.endSystem()
      monitor.beginSystem('pathfinding')
      const end = performance.now() + 0.01
      while (performance.now() < end) { /* spin */ }
      monitor.endSystem()
      monitor.endFrame(10)
    }

    const breakdown = monitor.getSystemBreakdown()
    expect(breakdown).toHaveProperty('water')
    expect(breakdown).toHaveProperty('pathfinding')
    expect(breakdown.pathfinding).toBeGreaterThan(0)
  })

  it('returns empty breakdown with no frames', () => {
    const monitor = createDevMonitor()
    expect(monitor.getSystemBreakdown()).toEqual({})
  })
})

describe('exportMetrics', () => {
  it('returns last N frames when count specified', () => {
    const monitor = createDevMonitor()

    for (let i = 0; i < 20; i++) {
      monitor.beginFrame()
      monitor.endFrame(i, 0)
    }

    const last5 = monitor.exportMetrics(5)
    expect(last5).toHaveLength(5)
    // Last exported frame should have entityCount = 19
    expect(last5[4].entityCount).toBe(19)
  })
})
