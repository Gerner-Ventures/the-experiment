import type { FullPalette, PixelGrid, FaceExpression, BodyDynamics } from './types'
import { px, rc } from './grid-helpers'

// ─── Head Renderer ───

export function drawHead(
  g: PixelGrid,
  c: FullPalette,
  face: FaceExpression,
  dynamics: BodyDynamics,
  small: boolean,
): { headX: number; headY: number; headW: number; headH: number } {
  const headX = 10 + dynamics.lean
  const headY = (small ? 8 : 3) + dynamics.bob
  const headW = 12
  const headH = small ? 10 : 12

  // Rounded head fill
  rc(g, headX + 2, headY, headW - 4, 1, c.sk)
  rc(g, headX + 1, headY + 1, headW - 2, 1, c.sk)
  rc(g, headX, headY + 2, headW, headH - 4, c.sk)
  rc(g, headX + 1, headY + headH - 2, headW - 2, 1, c.sk)
  rc(g, headX + 2, headY + headH - 1, headW - 4, 1, c.sk)

  // 3D shading
  rc(g, headX, headY + 2, 2, headH - 4, c.ss)
  rc(g, headX + 1, headY + 1, 1, 1, c.ss)
  rc(g, headX + 2, headY + 2, 1, headH - 5, c.sd)
  rc(g, headX + headW - 2, headY + 3, 1, headH - 7, c.sh)
  rc(g, headX + headW - 1, headY + 3, 1, headH - 7, c.rim)
  rc(g, headX + 4, headY, 4, 1, c.sh)
  // Cheeks
  px(g, headX + 2, headY + 8, c.ch)
  px(g, headX + headW - 3, headY + 8, c.ch)

  // ─── Eyes ───
  const eyeY = headY + 5
  const leX = headX + 2
  const reX = headX + 7

  // Pupil offset
  let pupOx = 0
  let pupOy = 0
  if (face.pupils === 'right') pupOx = 1
  else if (face.pupils === 'left') pupOx = -1
  else if (face.pupils === 'up_right') { pupOx = 1; pupOy = -1 }
  else if (face.pupils === 'up') pupOy = -1

  if (face.eyes === 'blink') {
    // Full blink — closed line
    rc(g, leX, eyeY + 1, 3, 1, c.ol)
    rc(g, reX, eyeY + 1, 3, 1, c.ol)
  } else if (face.eyes === 'halfblink') {
    // Half-blink — eyelid
    rc(g, leX, eyeY + 1, 3, 2, c.ew)
    rc(g, reX, eyeY + 1, 3, 2, c.ew)
    px(g, leX, eyeY + 1, c.ei)
    px(g, reX, eyeY + 1, c.ei)
    rc(g, leX, eyeY, 3, 1, c.ol)
    rc(g, reX, eyeY, 3, 1, c.ol)
    // Outline
    px(g, leX - 1, eyeY + 1, c.ol); px(g, leX + 3, eyeY + 1, c.ol)
    px(g, leX - 1, eyeY + 2, c.ol); px(g, leX + 3, eyeY + 2, c.ol)
    for (let x = leX - 1; x <= leX + 3; x++) px(g, x, eyeY + 3, c.ol)
    px(g, reX - 1, eyeY + 1, c.ol); px(g, reX + 3, eyeY + 1, c.ol)
    px(g, reX - 1, eyeY + 2, c.ol); px(g, reX + 3, eyeY + 2, c.ol)
    for (let x = reX - 1; x <= reX + 3; x++) px(g, x, eyeY + 3, c.ol)
  } else if (face.eyes === 'squint') {
    // Happy squint — curved lines
    px(g, leX, eyeY + 1, c.ol); px(g, leX + 1, eyeY, c.ol); px(g, leX + 2, eyeY + 1, c.ol)
    px(g, reX, eyeY + 1, c.ol); px(g, reX + 1, eyeY, c.ol); px(g, reX + 2, eyeY + 1, c.ol)
  } else {
    // Full open eyes with pupil tracking
    rc(g, leX, eyeY, 3, 3, c.ew)
    rc(g, reX, eyeY, 3, 3, c.ew)

    // Iris
    const liX = Math.max(leX, Math.min(leX + 1, leX + pupOx))
    const riX = Math.max(reX, Math.min(reX + 1, reX + pupOx))
    const iY = Math.max(eyeY, Math.min(eyeY + 1, eyeY + pupOy))
    rc(g, liX, iY, 2, 2, c.ei)
    rc(g, riX, iY, 2, 2, c.ei)

    // Pupil
    px(g, liX, iY, c.ep)
    px(g, riX, iY, c.ep)
    // Catchlight
    px(g, liX + 1, iY, c.eg)
    px(g, riX + 1, iY, c.eg)
    // Lower iris darker
    px(g, liX, iY + 1, c.eb); px(g, liX + 1, iY + 1, c.eb)
    px(g, riX, iY + 1, c.eb); px(g, riX + 1, iY + 1, c.eb)

    // Eye outline
    for (let x = leX - 1; x <= leX + 3; x++) px(g, x, eyeY + 3, c.ol)
    px(g, leX - 1, eyeY, c.ol); px(g, leX - 1, eyeY + 1, c.ol); px(g, leX - 1, eyeY + 2, c.ol)
    px(g, leX + 3, eyeY, c.ol); px(g, leX + 3, eyeY + 1, c.ol); px(g, leX + 3, eyeY + 2, c.ol)
    for (let x = reX - 1; x <= reX + 3; x++) px(g, x, eyeY + 3, c.ol)
    px(g, reX - 1, eyeY, c.ol); px(g, reX - 1, eyeY + 1, c.ol); px(g, reX - 1, eyeY + 2, c.ol)
    px(g, reX + 3, eyeY, c.ol); px(g, reX + 3, eyeY + 1, c.ol); px(g, reX + 3, eyeY + 2, c.ol)

    // Brow line
    rc(g, leX - 1, eyeY - 1, 4, 1, c.ol)
    rc(g, reX - 1, eyeY - 1, 4, 1, c.ol)

    // Raised/panic brows
    if (face.brows === 'raised' || face.brows === 'sad') {
      rc(g, leX - 1, eyeY - 1, 4, 1, c.sk)
      rc(g, reX - 1, eyeY - 1, 4, 1, c.sk)
      rc(g, leX - 1, eyeY - 2, 4, 1, c.ol)
      rc(g, reX - 1, eyeY - 2, 4, 1, c.ol)
    }

    // Angry brows
    if (face.brows === 'angry') {
      rc(g, leX - 1, eyeY - 1, 4, 1, c.sk)
      rc(g, reX - 1, eyeY - 1, 4, 1, c.sk)
      // Angry angle: \ for left, / for right
      px(g, leX - 1, eyeY - 2, c.ol); px(g, leX, eyeY - 2, c.ol)
      px(g, leX + 1, eyeY - 1, c.ol); px(g, leX + 2, eyeY - 1, c.ol)
      px(g, reX - 1, eyeY - 1, c.ol); px(g, reX, eyeY - 1, c.ol)
      px(g, reX + 1, eyeY - 2, c.ol); px(g, reX + 2, eyeY - 2, c.ol)
    }
  }

  // Under-eye shadows
  px(g, leX, eyeY + 4, c.ue); px(g, leX + 1, eyeY + 4, c.ue); px(g, leX + 2, eyeY + 4, c.ue)
  px(g, reX, eyeY + 4, c.ue); px(g, reX + 1, eyeY + 4, c.ue); px(g, reX + 2, eyeY + 4, c.ue)

  // Nose
  px(g, headX + 5, eyeY + 3, c.ss)
  px(g, headX + 6, eyeY + 3, c.ss)
  px(g, headX + 6, eyeY + 2, c.nh)

  // ─── Mouth ───
  const mY = headY + 10

  if (face.mouth === 'open') {
    rc(g, headX + 4, mY, 4, 1, c.mu)
    rc(g, headX + 4, mY + 1, 4, 1, c.mi)
    rc(g, headX + 5, mY + 1, 2, 1, c.mt)
    rc(g, headX + 4, mY + 2, 4, 1, c.ml)
  } else if (face.mouth === 'wide_open') {
    rc(g, headX + 3, mY - 1, 5, 1, c.mu)
    rc(g, headX + 3, mY, 5, 2, c.mi)
    rc(g, headX + 4, mY, 3, 1, c.mt)
    rc(g, headX + 3, mY + 2, 5, 1, c.ml)
  } else if (face.mouth === 'smile') {
    rc(g, headX + 4, mY, 4, 1, c.ml)
    px(g, headX + 3, mY - 1, c.ml)
    px(g, headX + 8, mY - 1, c.ml)
  } else if (face.mouth === 'panic_o') {
    px(g, headX + 5, mY, c.ml); px(g, headX + 6, mY, c.ml)
    px(g, headX + 4, mY + 1, c.ml)
    rc(g, headX + 5, mY + 1, 2, 1, c.mi)
    px(g, headX + 7, mY + 1, c.ml)
    px(g, headX + 5, mY + 2, c.ml); px(g, headX + 6, mY + 2, c.ml)
  } else if (face.mouth === 'pursed') {
    px(g, headX + 6, mY, c.ml); px(g, headX + 7, mY, c.ml); px(g, headX + 8, mY, c.ml)
  } else if (face.mouth === 'tongue') {
    rc(g, headX + 3, mY, 5, 1, c.mu)
    rc(g, headX + 3, mY + 1, 5, 1, c.mi)
    // Big chunky pink tongue
    rc(g, headX + 3, mY + 2, 6, 3, '#f47a8a')
    rc(g, headX + 4, mY + 5, 4, 1, '#f47a8a')
    // Tongue shading
    rc(g, headX + 3, mY + 2, 1, 3, '#d8607a')
    rc(g, headX + 8, mY + 2, 1, 3, '#ff8fa0')
    rc(g, headX + 5, mY + 2, 2, 2, '#ff9aaa')
    px(g, headX + 4, mY + 5, '#d8607a')
    px(g, headX + 7, mY + 5, '#ff8fa0')
  } else if (face.mouth === 'grit') {
    rc(g, headX + 4, mY, 4, 1, c.ml)
    rc(g, headX + 4, mY + 1, 4, 1, c.mt)
    rc(g, headX + 4, mY + 1, 1, 1, c.ml)
    px(g, headX + 7, mY + 1, c.ml)
  } else if (face.mouth === 'tense') {
    rc(g, headX + 4, mY, 4, 1, c.ml)
    rc(g, headX + 3, mY, 1, 1, c.ml)
  } else if (face.mouth === 'sip') {
    px(g, headX + 6, mY, c.ml); px(g, headX + 7, mY, c.ml)
    px(g, headX + 6, mY + 1, c.mi); px(g, headX + 7, mY + 1, c.mi)
    px(g, headX + 6, mY + 2, c.ml); px(g, headX + 7, mY + 2, c.ml)
  } else if (face.mouth === 'cry') {
    // Wavy cry mouth
    px(g, headX + 4, mY, c.ml); px(g, headX + 5, mY + 1, c.ml)
    px(g, headX + 6, mY, c.ml); px(g, headX + 7, mY + 1, c.ml)
  } else {
    // Neutral
    rc(g, headX + 4, mY, 4, 1, c.ml)
  }

  // Ears
  px(g, headX - 1, headY + 5, c.ear); px(g, headX - 1, headY + 6, c.ear)
  px(g, headX + headW, headY + 5, c.ear); px(g, headX + headW, headY + 6, c.ear)
  px(g, headX - 2, headY + 5, c.ol); px(g, headX - 2, headY + 6, c.ol)
  px(g, headX + headW + 1, headY + 5, c.ol); px(g, headX + headW + 1, headY + 6, c.ol)

  // Head outline (drawn last for crisp edges)
  for (let x = headX + 2; x < headX + headW - 2; x++) {
    px(g, x, headY - 1, c.ol)
    px(g, x, headY + headH, c.ol)
  }
  for (let y = headY + 2; y < headY + headH - 2; y++) {
    px(g, headX - 1, y, c.ol)
    px(g, headX + headW, y, c.ol)
  }
  px(g, headX + 1, headY, c.ol); px(g, headX + headW - 2, headY, c.ol)
  px(g, headX, headY + 1, c.ol); px(g, headX + headW - 1, headY + 1, c.ol)
  px(g, headX, headY + headH - 2, c.ol); px(g, headX + headW - 1, headY + headH - 2, c.ol)
  px(g, headX + 1, headY + headH - 1, c.ol); px(g, headX + headW - 2, headY + headH - 1, c.ol)

  return { headX, headY, headW, headH }
}
