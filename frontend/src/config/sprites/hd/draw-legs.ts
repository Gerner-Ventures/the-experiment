import type { FullPalette, PixelGrid, LegPose } from './types'
import { px, rc } from './grid-helpers'

// ─── Legs Renderer ───

export function drawLegs(
  g: PixelGrid,
  c: FullPalette,
  tX: number,
  legY: number,
  leftLeg: LegPose,
  rightLeg: LegPose,
): void {
  // For combined leg poses, we handle common walk/combat/standing patterns
  if (leftLeg === 'walk_back' && rightLeg === 'walk_fwd') {
    // walk1: left back, right forward
    rc(g, tX + 1, legY, 4, 7, c.o1); rc(g, tX + 1, legY, 1, 7, c.os); rc(g, tX + 3, legY, 1, 7, c.oh)
    rc(g, tX + 7, legY, 4, 6, c.o1); rc(g, tX + 10, legY, 1, 6, c.os)
    rc(g, tX, legY + 7, 5, 2, c.s1); rc(g, tX, legY + 8, 5, 1, c.s2); px(g, tX + 4, legY + 7, c.s3)
    rc(g, tX + 7, legY + 6, 4, 2, c.s1); rc(g, tX + 7, legY + 7, 4, 1, c.s2)
    return
  }

  if (leftLeg === 'walk_fwd' && rightLeg === 'walk_back') {
    // walk2: left forward, right back
    rc(g, tX + 1, legY, 4, 6, c.o1); rc(g, tX + 1, legY, 1, 6, c.os)
    rc(g, tX + 7, legY, 4, 7, c.o1); rc(g, tX + 10, legY, 1, 7, c.os); rc(g, tX + 9, legY, 1, 7, c.oh)
    rc(g, tX + 1, legY + 6, 4, 2, c.s1); rc(g, tX + 1, legY + 7, 4, 1, c.s2)
    rc(g, tX + 6, legY + 7, 6, 2, c.s1); rc(g, tX + 6, legY + 8, 6, 1, c.s2); px(g, tX + 11, legY + 7, c.s3)
    return
  }

  if (rightLeg === 'kick_wind') {
    // kick1: right leg pulled back
    rc(g, tX + 1, legY, 4, 8, c.o1); rc(g, tX + 1, legY, 1, 8, c.os); rc(g, tX + 3, legY, 1, 8, c.oh)
    rc(g, tX + 8, legY, 4, 5, c.o1); rc(g, tX + 11, legY, 1, 5, c.os)
    rc(g, tX, legY + 8, 6, 2, c.s1); rc(g, tX, legY + 9, 6, 1, c.s2); px(g, tX + 5, legY + 8, c.s3)
    rc(g, tX + 8, legY + 5, 4, 2, c.s1); rc(g, tX + 8, legY + 6, 4, 1, c.s2)
    return
  }

  if (rightLeg === 'kick_extend') {
    // kick2: right leg extended horizontal
    rc(g, tX + 1, legY, 4, 8, c.o1); rc(g, tX + 1, legY, 1, 8, c.os); rc(g, tX + 3, legY, 1, 8, c.oh)
    rc(g, tX + 7, legY + 2, 8, 3, c.o1); rc(g, tX + 7, legY + 2, 8, 1, c.os); rc(g, tX + 7, legY + 4, 8, 1, c.oh)
    rc(g, tX + 15, legY + 1, 3, 4, c.s1); rc(g, tX + 15, legY + 1, 3, 1, c.s3); rc(g, tX + 15, legY + 4, 3, 1, c.s2)
    rc(g, tX, legY + 8, 6, 2, c.s1); rc(g, tX, legY + 9, 6, 1, c.s2); px(g, tX + 5, legY + 8, c.s3)
    // Impact stars
    px(g, tX + 18, legY + 2, '#ffff44'); px(g, tX + 19, legY + 1, '#ffff44'); px(g, tX + 19, legY + 3, '#ffaa22')
    return
  }

  if (leftLeg === 'wide' || rightLeg === 'wide') {
    // Wide stance
    rc(g, tX, legY, 4, 8, c.o1); rc(g, tX, legY, 1, 8, c.os); rc(g, tX + 3, legY, 1, 8, c.oh)
    rc(g, tX + 8, legY, 4, 8, c.o1); rc(g, tX + 11, legY, 1, 8, c.os); rc(g, tX + 8, legY, 1, 8, c.oh)
    rc(g, tX - 1, legY + 8, 6, 2, c.s1); rc(g, tX - 1, legY + 9, 6, 1, c.s2)
    rc(g, tX + 7, legY + 8, 6, 2, c.s1); rc(g, tX + 7, legY + 9, 6, 1, c.s2)
    rc(g, tX + 4, legY, 4, 5, c.ao)
    return
  }

  if (rightLeg === 'lunge') {
    // Lunge forward
    rc(g, tX + 1, legY, 4, 8, c.o1); rc(g, tX + 1, legY, 1, 8, c.os); rc(g, tX + 4, legY, 1, 8, c.oh)
    rc(g, tX + 7, legY, 5, 7, c.o1); rc(g, tX + 11, legY, 1, 7, c.os)
    rc(g, tX, legY + 8, 6, 2, c.s1); rc(g, tX, legY + 9, 6, 1, c.s2)
    rc(g, tX + 7, legY + 7, 6, 2, c.s1); rc(g, tX + 7, legY + 8, 6, 1, c.s2)
    rc(g, tX + 5, legY, 2, 5, c.ao)
    return
  }

  if (leftLeg === 'kneel' || rightLeg === 'kneel') {
    // Kneeling
    rc(g, tX + 1, legY, 4, 5, c.o1); rc(g, tX + 1, legY, 1, 5, c.os)
    rc(g, tX + 1, legY + 5, 8, 3, c.o1); rc(g, tX + 1, legY + 5, 1, 3, c.os)
    rc(g, tX, legY + 8, 10, 2, c.s1); rc(g, tX, legY + 9, 10, 1, c.s2)
    return
  }

  if (leftLeg === 'squat' || rightLeg === 'squat') {
    // Squatting
    rc(g, tX + 1, legY, 4, 4, c.o1); rc(g, tX + 1, legY, 1, 4, c.os)
    rc(g, tX + 7, legY, 4, 4, c.o1); rc(g, tX + 10, legY, 1, 4, c.os)
    rc(g, tX, legY + 4, 5, 4, c.o1); rc(g, tX + 7, legY + 4, 5, 4, c.o1)
    rc(g, tX, legY + 8, 6, 2, c.s1); rc(g, tX + 6, legY + 8, 6, 2, c.s1)
    rc(g, tX, legY + 9, 6, 1, c.s2); rc(g, tX + 6, legY + 9, 6, 1, c.s2)
    return
  }

  if (leftLeg === 'lying' || rightLeg === 'lying') {
    // Lying flat
    rc(g, tX, legY, 12, 3, c.o1)
    rc(g, tX, legY, 12, 1, c.os)
    rc(g, tX + 12, legY, 4, 3, c.s1)
    rc(g, tX + 12, legY + 2, 4, 1, c.s2)
    return
  }

  // Default: standing with 3D shading
  rc(g, tX + 1, legY, 4, 8, c.o1); rc(g, tX + 1, legY, 1, 8, c.os); rc(g, tX + 4, legY, 1, 8, c.oh)
  rc(g, tX + 7, legY, 4, 8, c.o1); rc(g, tX + 10, legY, 1, 8, c.os); rc(g, tX + 7, legY, 1, 8, c.oh)
  rc(g, tX, legY + 8, 6, 2, c.s1); rc(g, tX, legY + 9, 6, 1, c.s2); px(g, tX + 5, legY + 8, c.s3)
  rc(g, tX + 6, legY + 8, 6, 2, c.s1); rc(g, tX + 6, legY + 9, 6, 1, c.s2); px(g, tX + 11, legY + 8, c.s3)
  // AO between legs
  rc(g, tX + 5, legY, 2, 5, c.ao)
  rc(g, tX + 4, legY, 1, 3, c.ob); rc(g, tX + 7, legY, 1, 3, c.ob)
}
