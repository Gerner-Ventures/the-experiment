import type { PoseName, PoseDef } from './types'

export const POSES: Record<PoseName, PoseDef> = {
  idle: { bodyOverrides: [] },

  // Walk: leg alternation for movement
  walk1: {
    bodyOverrides: [
      [15, '00001611610000'], // legs: left forward, right back
      [16, '0001C1001C0000'],
      [17, '000CC000CC0000'],
    ],
  },
  walk2: {
    bodyOverrides: [
      [15, '00001611610000'], // legs: right forward, left back
      [16, '0000C1001C1000'],
      [17, '0000CC000CC000'],
    ],
  },

  // Dance: arms up, legs apart
  dance1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '20016666610020'], // arms up left
      [12, '02001666100200'],
      [15, '00016100016100'], // legs apart
      [16, '0001C1000C1000'],
      [17, '000CC000CC0000'],
    ],
  },
  dance2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00201666610200'], // arms up right
      [12, '00020166102000'],
      [15, '00016100016100'],
      [16, '000C10001C0000'],
      [17, '00CC0000CC0000'],
    ],
  },

  // Pee: turned slightly, stream pixels
  pee: {
    bodyOverrides: [
      [11, '00216666600000'],
      [12, '00021666120000'],
      [13, '00001666100000'],
      [14, '00001166100000'],
      [15, '00001621610000'],
    ],
    pixelOverrides: [
      [9, 14, 'A'], [10, 15, 'A'], [10, 16, 'A'], [10, 17, 'A'], // stream
    ],
  },

  // Poop: squatting
  poop: {
    bodyOverrides: [
      [13, '00001666100000'],
      [14, '00011661100000'],
      [15, '00016111610000'],
      [16, '0001C1001C1000'],
      [17, '000CC0000CC000'],
    ],
    pixelOverrides: [
      [7, 16, '3'], [7, 17, '3'], [8, 17, '3'], // the evidence
    ],
  },

  // Vomit: leaning forward
  vomit: {
    bodyOverrides: [
      [5, '00012222221000'],
      [6, '00001232310000'], // mouth open
    ],
    pixelOverrides: [
      [10, 7, 'A'], [11, 7, 'A'], [12, 8, 'A'], [11, 8, 'A'], // splatter
      [12, 9, 'A'], [13, 9, 'A'],
    ],
  },

  // Stab: arm extended with weapon
  stab: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666612000'],
      [12, '00001666100200'],
      [13, '00001666100020'],
    ],
    pixelOverrides: [
      [13, 12, '1'], [13, 13, '1'], [13, 11, 'A'], // knife
    ],
  },

  // Shoot: arm extended
  shoot: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666612000'],
      [12, '00001666100200'],
    ],
    pixelOverrides: [
      [13, 11, '1'], [13, 12, '1'], [12, 12, '1'], // gun shape
      [13, 10, 'A'], // muzzle flash frame
    ],
  },

  // Panic: arms flailing alternating
  panic1: {
    bodyOverrides: [
      [4, '00012899221000'], // wide eyes
      [10, '00016666661000'],
      [11, '20016666610020'],
      [12, '02001666100200'],
    ],
  },
  panic2: {
    bodyOverrides: [
      [4, '00012998221000'], // wide eyes other way
      [10, '00016666661000'],
      [11, '00201666610200'],
      [12, '00020166102000'],
      [15, '00016100016100'],
      [16, '0001C1000C1000'],
    ],
  },

  // Sleep: lying down... well, head tilted, Z's
  sleep: {
    bodyOverrides: [
      [4, '00012211221000'], // eyes closed
      [5, '00012222221000'],
    ],
    pixelOverrides: [
      [11, 1, 'A'], // z
      [12, 0, 'A'], // Z
      [10, 2, 'A'], // z
    ],
  },

  // Wave
  wave1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666610200'],
      [12, '00001666100200'],
    ],
  },
  wave2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666610020'],
      [12, '00001666100020'],
    ],
  },

  // Dead: X eyes, flat
  dead: {
    bodyOverrides: [
      [4, '00019289291000'], // X eyes
      [5, '00012222221000'],
      [6, '00001212210000'], // flat mouth
      [15, '00016111610000'], // legs splayed
      [16, '001C10001C1000'],
      [17, '00CC0000CC0000'],
    ],
  },

  // ─── NEW POSES (Phase 1 actions) ───

  // Talk: one arm gesturing with bullhorn prop
  talk1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666610200'], // arm out with megaphone
      [12, '00001666100200'],
    ],
    pixelOverrides: [
      [12, 11, '7'], [13, 11, '7'], [13, 10, '7'], // megaphone shape (gray)
    ],
  },
  talk2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666610020'], // arm slightly lower
      [12, '00001666100020'],
    ],
    pixelOverrides: [
      [12, 12, '7'], [13, 12, '7'], [13, 11, '7'], // megaphone lower position
    ],
  },

  // Rally: both arms raised high with palm fronds (green)
  rally1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '20016666610020'], // both arms up
      [12, '02001666100200'],
    ],
    pixelOverrides: [
      [2, 10, 'A'], [1, 9, 'A'], [2, 9, 'A'],   // left frond (green via accessory color)
      [12, 10, 'A'], [13, 9, 'A'], [12, 9, 'A'], // right frond
      [1, 8, 'A'], [13, 8, 'A'],                  // frond tips
    ],
  },
  rally2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00201666610200'], // arms crossed high
      [12, '00020166102000'],
    ],
    pixelOverrides: [
      [3, 10, 'A'], [2, 9, 'A'], [3, 9, 'A'],   // left frond shifted
      [11, 10, 'A'], [12, 9, 'A'], [11, 9, 'A'], // right frond shifted
      [2, 8, 'A'], [12, 8, 'A'],                  // frond tips
    ],
  },

  // Gather: reaching down/forward to pick up
  gather1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666612000'], // arm reaching forward
      [12, '00001666100200'],
      [13, '00001666100020'],
      [14, '00001166100000'],
    ],
    pixelOverrides: [
      [13, 13, '7'], [12, 13, '7'], // bundle in hand (brown/gray)
    ],
  },
  gather2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00216666612000'], // both arms forward, holding
      [12, '00021666120000'],
    ],
    pixelOverrides: [
      [10, 12, '7'], [11, 12, '7'], [10, 11, '7'], [11, 11, '7'], // held bundle
    ],
  },

  // Argue: pointing finger aggressively
  argue1: {
    bodyOverrides: [
      [4, '00012899221000'], // wide eyes (angry)
      [10, '00016666661000'],
      [11, '00016666612000'], // arm pointing right
      [12, '00001666100200'],
      [13, '00001666100020'],
    ],
    pixelOverrides: [
      [13, 13, '2'], // pointed finger (skin color)
    ],
  },
  argue2: {
    bodyOverrides: [
      [4, '00012998221000'], // wide eyes other side
      [10, '00016666661000'],
      [11, '00216666610000'], // arm pointing left
      [12, '00200166100000'],
      [13, '00020016100000'],
    ],
    pixelOverrides: [
      [1, 13, '2'], // pointed finger other side
    ],
  },

  // Investigate: holding giant magnifying glass up
  investigate1: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666612000'], // arm extended holding glass
      [12, '00001666100200'],
    ],
    pixelOverrides: [
      // Magnifying glass lens (circle shape, white/light)
      [0, 10, '8'], [0, 11, '8'], [0, 12, '8'],
      [1, 9, '8'], [1, 13, '8'],
      [2, 9, '8'], [2, 13, '8'],
      [3, 10, '8'], [3, 11, '8'], [3, 12, '8'],
      // Lens interior (slight tint)
      [1, 10, 'A'], [1, 11, 'A'], [1, 12, 'A'],
      [2, 10, 'A'], [2, 11, 'A'], [2, 12, 'A'],
      // Handle (gray, diagonal down-right)
      [4, 13, '7'], [5, 14, '7'], [6, 15, '7'],
    ],
  },
  investigate2: {
    bodyOverrides: [
      [10, '00016666661000'],
      [11, '00016666610200'], // arm slightly shifted
      [12, '00001666100200'],
    ],
    pixelOverrides: [
      // Magnifying glass lens shifted slightly
      [1, 10, '8'], [1, 11, '8'], [1, 12, '8'],
      [2, 9, '8'], [2, 13, '8'],
      [3, 9, '8'], [3, 13, '8'],
      [4, 10, '8'], [4, 11, '8'], [4, 12, '8'],
      // Lens interior
      [2, 10, 'A'], [2, 11, 'A'], [2, 12, 'A'],
      [3, 10, 'A'], [3, 11, 'A'], [3, 12, 'A'],
      // Handle
      [5, 13, '7'], [6, 14, '7'], [7, 15, '7'],
    ],
  },

  // Observe: wearing big glasses on face
  observe: {
    bodyOverrides: [
      [3, '00012222221000'], // forehead
      [4, '00018288281000'], // big glasses frames around eyes (8=white frames)
      [5, '00018222281000'], // glasses lower rim
      [10, '00016666661000'],
      [11, '00016666610200'], // hand shielding / peering
      [12, '00001666100200'],
    ],
    pixelOverrides: [
      // Glasses bridge between lenses
      [4, 7, '7'],
      // Glasses arms extending to sides
      [4, 3, '7'], [4, 11, '7'],
    ],
  },

  // Think: hand on chin, thought bubble
  think: {
    bodyOverrides: [
      [4, '00012282221000'], // one eye squinted (thinking)
      [10, '00016666661000'],
      [11, '00016666612000'], // hand to chin
      [12, '00001666122000'],
    ],
    pixelOverrides: [
      [11, 1, '8'], [12, 0, '8'], [12, 1, '8'], // thought bubble dots (white)
    ],
  },
}
