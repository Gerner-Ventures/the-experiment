import { POSES } from '@/config/sprites/poses'
import { GRID_W, GRID_H } from '@/config/sprites/constants'
import type { PoseName } from '@/config/sprites/types'

describe('poses', () => {
  const poseEntries = Object.entries(POSES) as [PoseName, typeof POSES[PoseName]][]

  it('every pose bodyOverride row string is exactly GRID_W (14) chars', () => {
    for (const [, pose] of poseEntries) {
      for (const [, rowData] of pose.bodyOverrides) {
        expect(rowData).toHaveLength(GRID_W)
      }
    }
  })

  it('every pose bodyOverride row index is within [0, GRID_H)', () => {
    for (const [, pose] of poseEntries) {
      for (const [rowIdx] of pose.bodyOverrides) {
        expect(rowIdx).toBeGreaterThanOrEqual(0)
        expect(rowIdx).toBeLessThan(GRID_H)
      }
    }
  })

  it('every pixelOverride coordinate is within bounds', () => {
    for (const [, pose] of poseEntries) {
      if (!pose.pixelOverrides) continue
      for (const [x, y, colorKey] of pose.pixelOverrides) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(GRID_W)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThan(GRID_H)
        expect(typeof colorKey).toBe('string')
        expect(colorKey.length).toBe(1)
      }
    }
  })

  it('new poses (talk1, rally1, gather1, argue1, think, investigate1, observe) exist and are distinct from idle', () => {
    const newPoses: PoseName[] = ['talk1', 'rally1', 'gather1', 'argue1', 'think', 'investigate1', 'observe']
    const idleOverrides = JSON.stringify(POSES.idle.bodyOverrides)

    for (const poseName of newPoses) {
      const pose = POSES[poseName]
      expect(pose).toBeDefined()
      expect(pose.bodyOverrides.length).toBeGreaterThan(0)
      expect(JSON.stringify(pose.bodyOverrides)).not.toBe(idleOverrides)
    }
  })

  it('all PoseName values in the type have corresponding POSES entries', () => {
    // Exhaustive list from the PoseName type union
    const allPoseNames: PoseName[] = [
      'idle',
      'walk1', 'walk2',
      'dance1', 'dance2',
      'pee', 'poop', 'vomit',
      'stab', 'shoot',
      'panic1', 'panic2',
      'sleep',
      'wave1', 'wave2',
      'dead',
      'talk1', 'talk2',
      'rally1', 'rally2',
      'gather1', 'gather2',
      'argue1', 'argue2',
      'think',
      'investigate1', 'investigate2',
      'observe',
    ]

    for (const poseName of allPoseNames) {
      expect(POSES[poseName]).toBeDefined()
    }

    // And verify count matches
    expect(Object.keys(POSES)).toHaveLength(allPoseNames.length)
  })
})
