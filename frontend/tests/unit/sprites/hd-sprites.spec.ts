import { deriveFullPalette, darken, lighten, mixColors } from '@/config/sprites/hd/palette'
import { POSE_REGISTRY } from '@/config/sprites/hd/poses'
import {
  HD_ANIMATION_REGISTRY,
  HD_ACTION_TO_ANIMATION,
  HD_FALLBACK_ANIMATION,
  HD_SILLY_ANIMATIONS,
  getHDAnimation,
  getHDAnimationForAction,
} from '@/config/sprites/hd/animations'
import { HD_CHARACTER_SPRITES, getHDSpriteById } from '@/config/sprites/hd/characters'
import { HD_GRID_W, HD_GRID_H } from '@/config/sprites/hd/constants'
import {
  MOVE_SPEED,
  HD_FEET_OFFSET_Y,
  HD_HEAD_TOP_OFFSET_Y,
  HD_CANVAS_H,
  HD_SELECTION_RING,
  HD_HIGHLIGHT_RING,
  AGENT_NAME_LABEL,
} from '@/config/sprites/hd/theme'
import type {
  BasePalette,
  FullPalette,
  HDPoseName,
  PoseDefinition,
  ArmPose,
  LegPose,
  UpperBodyStance,
  LowerTorsoStance,
  EyeState,
  MouthType,
  BrowState,
  PupilDir,
  PropType,
  EffectType,
  StatusEffectType,
} from '@/config/sprites/hd/types'

// ─── Test data ───

const TEST_BASE_PALETTE: BasePalette = {
  outline: '#1a1a2e',
  skin: '#e8b89a',
  skinShadow: '#c49478',
  hair: '#4a3728',
  hairHighlight: '#6b5340',
  outfitPrimary: '#4466aa',
  outfitSecondary: '#ffffff',
  shoe: '#4a3728',
}

// ─── Valid values for pose validation ───

const VALID_ARM_POSES: ArmPose[] = ['down', 'back', 'fwd', 'up', 'diag', 'punch', 'uppercut', 'hold', 'reach', 'clasped', 'spread']
const VALID_LEG_POSES: LegPose[] = ['standing', 'walk_fwd', 'walk_back', 'wide', 'lunge', 'kick_wind', 'kick_extend', 'kneel', 'squat', 'lying']
const VALID_UPPER_BODY: UpperBodyStance[] = ['upright', 'lean_fwd', 'lean_back', 'hunch', 'bent_fwd', 'collapsed', 'lunge']
const VALID_LOWER_TORSO: LowerTorsoStance[] = ['neutral', 'twist_right', 'twist_left', 'crouch', 'sway']
const VALID_EYE_STATES: EyeState[] = ['open', 'blink', 'halfblink', 'squint', 'wide']
const VALID_MOUTH_TYPES: MouthType[] = ['neutral', 'open', 'wide_open', 'smile', 'panic_o', 'pursed', 'sip', 'tongue', 'grit', 'tense', 'cry']
const VALID_BROW_STATES: BrowState[] = ['normal', 'angry', 'raised', 'sad']
const VALID_PUPIL_DIRS: PupilDir[] = ['center', 'left', 'right', 'up', 'up_right']

// ─── Palette Tests ───

describe('hd/palette', () => {
  it('deriveFullPalette produces all required color keys', () => {
    const full = deriveFullPalette(TEST_BASE_PALETTE)
    const expectedKeys: (keyof FullPalette)[] = [
      'ol', 'sk', 'ss', 'sh', 'sd', 'rim',
      'hr', 'hh', 'hs',
      'o1', 'o2', 'os', 'od', 'oh', 'orim', 'ob', 'bt',
      's1', 's2', 's3',
      'ew', 'ei', 'ep', 'eg', 'eb',
      'mo', 'mi', 'mt', 'ml', 'mu',
      'ch', 'ao', 'ao2',
      'gs', 'gp', 'gp2',
      'ue', 'nh', 'ear', 'hbs',
    ]
    for (const key of expectedKeys) {
      expect(full[key]).toBeDefined()
      expect(typeof full[key]).toBe('string')
      expect(full[key]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('deriveFullPalette preserves base colors correctly', () => {
    const full = deriveFullPalette(TEST_BASE_PALETTE)
    expect(full.ol).toBe(TEST_BASE_PALETTE.outline)
    expect(full.sk).toBe(TEST_BASE_PALETTE.skin)
    expect(full.ss).toBe(TEST_BASE_PALETTE.skinShadow)
    expect(full.hr).toBe(TEST_BASE_PALETTE.hair)
    expect(full.hh).toBe(TEST_BASE_PALETTE.hairHighlight)
    expect(full.o1).toBe(TEST_BASE_PALETTE.outfitPrimary)
    expect(full.o2).toBe(TEST_BASE_PALETTE.outfitSecondary)
    expect(full.s1).toBe(TEST_BASE_PALETTE.shoe)
  })

  it('deriveFullPalette is deterministic (same input → same output)', () => {
    const a = deriveFullPalette(TEST_BASE_PALETTE)
    const b = deriveFullPalette(TEST_BASE_PALETTE)
    expect(a).toEqual(b)
  })

  it('darken produces a darker color', () => {
    const darker = darken('#808080', 30)
    expect(darker).toBe('#626262')
  })

  it('lighten produces a lighter color', () => {
    const lighter = lighten('#808080', 40)
    expect(lighter).toBe('#a8a8a8')
  })

  it('mixColors blends two colors at midpoint', () => {
    const mixed = mixColors('#000000', '#ffffff', 0.5)
    expect(mixed).toBe('#808080')
  })

  it('darken and lighten clamp to valid range', () => {
    const veryDark = darken('#101010', 50)
    expect(veryDark).toMatch(/^#[0-9a-f]{6}$/i)

    const veryLight = lighten('#f0f0f0', 50)
    expect(veryLight).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

// ─── Pose Registry Tests ───

describe('hd/poses', () => {
  const poseEntries = Object.entries(POSE_REGISTRY) as [HDPoseName, PoseDefinition][]

  it('POSE_REGISTRY has entries for all HDPoseName values', () => {
    // Exhaustive list from the HDPoseName type union
    const allPoseNames: HDPoseName[] = [
      // Core
      'idle', 'idle2', 'blink', 'halfblink', 'lookR', 'lookL',
      // Walk
      'walk1', 'walk2',
      // Combat
      'punch1', 'punch2', 'kick1', 'kick2', 'stab1', 'stab2', 'shoot1', 'shoot2',
      // Social
      'talk1', 'talk2', 'dance1', 'dance2', 'wave1', 'wave2', 'think',
      'panic1', 'panic2', 'drink1', 'drink2', 'tongue',
      'argue1', 'argue2', 'rally1', 'rally2', 'celebrate1', 'celebrate2',
      'pray', 'mourn', 'monologue1', 'monologue2',
      // Biological
      'pee', 'poop', 'vomit', 'sleep', 'eat1', 'eat2',
      // Actions
      'gather1', 'gather2', 'repair1', 'repair2',
      'trade1', 'trade2', 'observe1', 'observe2', 'observe3', 'observe4', 'rest',
      'threaten1', 'threaten2', 'poison1', 'poison2',
      'sabotage1', 'sabotage2', 'hoard1', 'hoard2',
      'steal1', 'steal2', 'accuse1', 'accuse2',
      'investigate1', 'investigate2', 'investigate3', 'investigate4',
      'explore1', 'explore2', 'explore3', 'explore4',
      'vote', 'breakdown1', 'breakdown2', 'self_sacrifice',
      // Consequences
      'dead', 'injured', 'stunned', 'knocked_down', 'fleeing1', 'fleeing2',
    ]

    for (const poseName of allPoseNames) {
      expect(POSE_REGISTRY[poseName]).toBeDefined()
    }
    expect(Object.keys(POSE_REGISTRY)).toHaveLength(allPoseNames.length)
  })

  it('every pose has valid arm poses', () => {
    for (const [, pose] of poseEntries) {
      expect(VALID_ARM_POSES).toContain(pose.leftArm)
      expect(VALID_ARM_POSES).toContain(pose.rightArm)
    }
  })

  it('every pose has valid leg poses', () => {
    for (const [, pose] of poseEntries) {
      expect(VALID_LEG_POSES).toContain(pose.leftLeg)
      expect(VALID_LEG_POSES).toContain(pose.rightLeg)
    }
  })

  it('every pose has valid upper body stance', () => {
    for (const [, pose] of poseEntries) {
      expect(VALID_UPPER_BODY).toContain(pose.upperBody)
    }
  })

  it('every pose has valid lower torso stance', () => {
    for (const [, pose] of poseEntries) {
      expect(VALID_LOWER_TORSO).toContain(pose.lowerTorso)
    }
  })

  it('every pose face has valid expression values', () => {
    for (const [, pose] of poseEntries) {
      expect(VALID_EYE_STATES).toContain(pose.face.eyes)
      expect(VALID_MOUTH_TYPES).toContain(pose.face.mouth)
      expect(VALID_BROW_STATES).toContain(pose.face.brows)
      expect(VALID_PUPIL_DIRS).toContain(pose.face.pupils)
    }
  })

  it('every pose dynamics has valid ranges', () => {
    for (const [, pose] of poseEntries) {
      expect(pose.dynamics.bob).toBeGreaterThanOrEqual(-2)
      expect(pose.dynamics.bob).toBeLessThanOrEqual(2)
      expect(pose.dynamics.lean).toBeGreaterThanOrEqual(-3)
      expect(pose.dynamics.lean).toBeLessThanOrEqual(3)
      expect(pose.dynamics.squash).toBeGreaterThanOrEqual(0)
      expect(pose.dynamics.squash).toBeLessThanOrEqual(2)
    }
  })

  it('rally poses have confetti effect', () => {
    expect(POSE_REGISTRY.rally1.effect).toBe('confetti')
    expect(POSE_REGISTRY.rally2.effect).toBe('confetti')
  })

  it('observe poses use binoculars props sequence', () => {
    expect(POSE_REGISTRY.observe1.prop).toBe('binoculars')
    expect(POSE_REGISTRY.observe2.prop).toBe('binoculars_raising')
    expect(POSE_REGISTRY.observe3.prop).toBe('binoculars_face')
    expect(POSE_REGISTRY.observe4.prop).toBe('binoculars_face')
  })

  it('investigate poses use magnifying glass props sequence', () => {
    expect(POSE_REGISTRY.investigate1.prop).toBe('magnifying_glass')
    expect(POSE_REGISTRY.investigate2.prop).toBe('magnifying_glass_raising')
    expect(POSE_REGISTRY.investigate3.prop).toBe('magnifying_glass_face')
    expect(POSE_REGISTRY.investigate4.prop).toBe('magnifying_glass_face')
  })

  it('explore poses use adventure hat and map props', () => {
    expect(POSE_REGISTRY.explore1.prop).toBe('adventure_hat')
    expect(POSE_REGISTRY.explore2.prop).toBe('map')
    expect(POSE_REGISTRY.explore3.prop).toBe('map')
    expect(POSE_REGISTRY.explore4.prop).toBe('map')
  })
})

// ─── Animation Registry Tests ───

describe('hd/animations', () => {
  it('every HD animation has non-empty poses array', () => {
    for (const [name, anim] of Object.entries(HD_ANIMATION_REGISTRY)) {
      expect(anim.poses.length).toBeGreaterThan(0)
      expect(anim.name).toBe(name)
    }
  })

  it('every HD animation has positive speed', () => {
    for (const anim of Object.values(HD_ANIMATION_REGISTRY)) {
      expect(anim.speed).toBeGreaterThan(0)
    }
  })

  it('every pose in every HD animation references a valid HDPoseName in POSE_REGISTRY', () => {
    const validPoses = new Set(Object.keys(POSE_REGISTRY))
    for (const [name, anim] of Object.entries(HD_ANIMATION_REGISTRY)) {
      for (const pose of anim.poses) {
        expect(validPoses.has(pose)).toBe(true)
      }
    }
  })

  it('every HD_ACTION_TO_ANIMATION value maps to an existing HD_ANIMATION_REGISTRY key', () => {
    for (const [action, animName] of Object.entries(HD_ACTION_TO_ANIMATION)) {
      expect(HD_ANIMATION_REGISTRY[animName]).toBeDefined()
    }
  })

  it('HD_ACTION_TO_ANIMATION covers all expected game actions', () => {
    const expectedActions = [
      'move', 'gather', 'repair', 'trade', 'talk', 'vote', 'rest', 'observe',
      'hoard', 'sabotage', 'explore', 'accuse', 'steal',
      'attack', 'threaten', 'stab', 'shoot', 'poison',
      'dance', 'pray', 'rally', 'mourn', 'celebrate', 'argue',
      'pee', 'poop', 'vomit', 'sleep', 'eat', 'drink',
      'investigate', 'monologue', 'panic', 'breakdown', 'self_sacrifice',
      'bleeding', 'injured', 'stunned', 'knocked_down', 'burning', 'poisoned', 'crying', 'fleeing',
    ]
    for (const action of expectedActions) {
      expect(HD_ACTION_TO_ANIMATION[action]).toBeDefined()
    }
  })

  it('getHDAnimation returns correct animation by name', () => {
    const anim = getHDAnimation('attack')
    expect(anim.name).toBe('attack')
    expect(anim.poses.length).toBeGreaterThan(0)
  })

  it('getHDAnimation returns fallback for unknown name', () => {
    const anim = getHDAnimation('nonexistent')
    expect(anim).toBe(HD_FALLBACK_ANIMATION)
  })

  it('getHDAnimationForAction maps action to correct animation', () => {
    const anim = getHDAnimationForAction('stab')
    expect(anim.name).toBe('stab')
  })

  it('getHDAnimationForAction returns fallback for unknown action', () => {
    const anim = getHDAnimationForAction('unknownAction')
    expect(anim).toBe(HD_FALLBACK_ANIMATION)
  })

  it('HD_SILLY_ANIMATIONS excludes looping animations', () => {
    for (const anim of HD_SILLY_ANIMATIONS) {
      expect(anim.loop).not.toBe(true)
    }
    expect(HD_SILLY_ANIMATIONS.find(a => a.name === 'walk')).toBeUndefined()
  })

  it('HD_FALLBACK_ANIMATION has valid poses', () => {
    const validPoses = new Set(Object.keys(POSE_REGISTRY))
    for (const pose of HD_FALLBACK_ANIMATION.poses) {
      expect(validPoses.has(pose)).toBe(true)
    }
  })

  it('observe animation uses multi-pose binoculars sequence', () => {
    const anim = HD_ANIMATION_REGISTRY.observe
    expect(anim.poses).toContain('observe1')
    expect(anim.poses).toContain('observe2')
    expect(anim.poses).toContain('observe3')
    expect(anim.poses).toContain('observe4')
  })

  it('investigate animation uses multi-pose magnifying glass sequence', () => {
    const anim = HD_ANIMATION_REGISTRY.investigate
    expect(anim.poses).toContain('investigate1')
    expect(anim.poses).toContain('investigate2')
    expect(anim.poses).toContain('investigate3')
    expect(anim.poses).toContain('investigate4')
  })

  it('explore animation uses multi-pose hat/map sequence', () => {
    const anim = HD_ANIMATION_REGISTRY.explore
    expect(anim.poses).toContain('explore1')
    expect(anim.poses).toContain('explore2')
    expect(anim.poses).toContain('explore3')
    expect(anim.poses).toContain('explore4')
  })
})

// ─── Character Tests ───

describe('hd/characters', () => {
  it('HD_CHARACTER_SPRITES has all 22 characters', () => {
    expect(HD_CHARACTER_SPRITES.length).toBe(22)
  })

  it('every character has valid basePalette with all required fields', () => {
    const requiredFields: (keyof BasePalette)[] = [
      'outline', 'skin', 'skinShadow', 'hair', 'hairHighlight',
      'outfitPrimary', 'outfitSecondary', 'shoe',
    ]
    for (const char of HD_CHARACTER_SPRITES) {
      for (const field of requiredFields) {
        expect(char.basePalette[field]).toBeDefined()
        expect(typeof char.basePalette[field]).toBe('string')
      }
    }
  })

  it('every character has valid hairStyle (0-5)', () => {
    for (const char of HD_CHARACTER_SPRITES) {
      expect(char.hairStyle).toBeGreaterThanOrEqual(0)
      expect(char.hairStyle).toBeLessThanOrEqual(5)
    }
  })

  it('every character has valid bodyType', () => {
    for (const char of HD_CHARACTER_SPRITES) {
      expect(['standard', 'small']).toContain(char.bodyType)
    }
  })

  it('getHDSpriteById returns correct character', () => {
    const first = HD_CHARACTER_SPRITES[0]
    const found = getHDSpriteById(first.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(first.id)
  })

  it('getHDSpriteById returns undefined for unknown id', () => {
    expect(getHDSpriteById('nonexistent')).toBeUndefined()
  })

  it('every character id is unique', () => {
    const ids = HD_CHARACTER_SPRITES.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('child character has small body type and rosy cheeks', () => {
    const child = getHDSpriteById('child')
    if (child) {
      expect(child.bodyType).toBe('small')
      expect(child.rosyCheeks).toBe(true)
    }
  })
})

// ─── Theme Tests ───

describe('hd/theme', () => {
  it('HD_CANVAS_H equals grid height times scale', () => {
    expect(HD_CANVAS_H).toBe(HD_GRID_H * 3)
  })

  it('HD_FEET_OFFSET_Y is negative (above anchor)', () => {
    expect(HD_FEET_OFFSET_Y).toBeLessThan(0)
  })

  it('HD_HEAD_TOP_OFFSET_Y is more negative than feet offset', () => {
    expect(HD_HEAD_TOP_OFFSET_Y).toBeLessThan(HD_FEET_OFFSET_Y)
  })

  it('MOVE_SPEED is positive', () => {
    expect(MOVE_SPEED).toBeGreaterThan(0)
  })

  it('selection ring dimensions are positive', () => {
    expect(HD_SELECTION_RING.rx).toBeGreaterThan(0)
    expect(HD_SELECTION_RING.ry).toBeGreaterThan(0)
  })

  it('highlight ring is slightly larger than selection ring', () => {
    expect(HD_HIGHLIGHT_RING.rx).toBeGreaterThan(HD_SELECTION_RING.rx)
    expect(HD_HIGHLIGHT_RING.ry).toBeGreaterThan(HD_SELECTION_RING.ry)
  })

  it('name label has valid font properties', () => {
    expect(AGENT_NAME_LABEL.fontSize).toBeGreaterThan(0)
    expect(AGENT_NAME_LABEL.alpha).toBeGreaterThan(0)
    expect(AGENT_NAME_LABEL.alpha).toBeLessThanOrEqual(1)
  })
})

// ─── Constants Tests ───

describe('hd/constants', () => {
  it('grid dimensions are 32×48', () => {
    expect(HD_GRID_W).toBe(32)
    expect(HD_GRID_H).toBe(48)
  })
})
