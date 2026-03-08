// ─── Base Palette (stored per character, minimal input) ───

export interface BasePalette {
  outline: string
  skin: string
  skinShadow: string
  hair: string
  hairHighlight: string
  outfitPrimary: string
  outfitSecondary: string
  shoe: string
  accessory?: string
  accessoryAlt?: string
}

// ─── Full Palette (derived from BasePalette — all render colors) ───

export interface FullPalette {
  ol: string   // outline
  sk: string   // skin base
  ss: string   // skin shadow
  sh: string   // skin highlight
  sd: string   // skin deep shadow
  rim: string  // rim light (bright edge)
  hr: string   // hair
  hh: string   // hair highlight
  hs: string   // hair shadow
  o1: string   // outfit primary
  o2: string   // outfit secondary
  os: string   // outfit shadow
  od: string   // outfit deep shadow
  oh: string   // outfit highlight
  orim: string // outfit rim light
  ob: string   // outfit back shadow
  bt: string   // belt
  s1: string   // shoe base
  s2: string   // shoe shadow
  s3: string   // shoe highlight
  ew: string   // eye white
  ei: string   // eye iris
  ep: string   // eye pupil
  eg: string   // eye glint (catchlight)
  eb: string   // eye iris bottom (darker)
  mo: string   // mouth outline
  mi: string   // mouth interior
  mt: string   // teeth hint
  ml: string   // lip color (lower lip)
  mu: string   // upper lip color
  ch: string   // cheek blush
  ao: string   // ambient occlusion (outfit)
  ao2: string  // ambient occlusion (skin)
  gs: string   // ground shadow
  gp: string   // ground plane
  gp2: string  // ground plane darker
  ue: string   // under-eye shadow
  nh: string   // nose highlight
  ear: string  // ear color
  hbs: string  // hair back shadow (cast on neck)
}

// ─── Face Expression ───

export type EyeState = 'open' | 'blink' | 'halfblink' | 'squint' | 'wide'
export type PupilDir = 'center' | 'left' | 'right' | 'up' | 'up_right'
export type MouthType = 'neutral' | 'open' | 'wide_open' | 'smile' | 'panic_o' | 'pursed' | 'sip' | 'tongue' | 'grit' | 'tense' | 'cry'
export type BrowState = 'normal' | 'angry' | 'raised' | 'sad'

export interface FaceExpression {
  eyes: EyeState
  pupils: PupilDir
  mouth: MouthType
  brows: BrowState
}

// ─── Body Part Poses ───

export type ArmPose = 'down' | 'back' | 'fwd' | 'up' | 'diag' | 'punch' | 'uppercut' | 'hold' | 'reach' | 'clasped' | 'spread'
export type LegPose = 'standing' | 'walk_fwd' | 'walk_back' | 'wide' | 'lunge' | 'kick_wind' | 'kick_extend' | 'kneel' | 'squat' | 'lying'
export type UpperBodyStance = 'upright' | 'lean_fwd' | 'lean_back' | 'hunch' | 'bent_fwd' | 'collapsed' | 'lunge'
export type LowerTorsoStance = 'neutral' | 'twist_right' | 'twist_left' | 'crouch' | 'sway'

// ─── Body Dynamics ───

export interface BodyDynamics {
  bob: number   // vertical offset (-2..2)
  lean: number  // horizontal offset (-3..3)
  squash: number // vertical squish (0..2)
}

// ─── Props & Effects ───

export type PropType =
  | 'knife_held' | 'knife_thrust'
  | 'gun_aim' | 'gun_fire'
  | 'mug' | 'thought_bubble' | 'speech_particles'
  | 'impact_stars' | 'muzzle_flash'
  | 'hammer' | 'vial' | 'sack' | 'bandage_item' | 'food' | 'magnifying_glass' | 'binoculars'
  | 'flame_particles' | 'dizzy_stars' | 'green_particles' | 'confetti'
  | 'zzz' | 'tears' | 'megaphone' | 'pee_stream' | 'poop_pile' | 'vomit_splatter'
  | 'adventure_hat' | 'adventure_hat_on' | 'map'
  | 'binoculars_raising' | 'binoculars_face'
  | 'magnifying_glass_raising' | 'magnifying_glass_face'

export type EffectType = 'impact_stars' | 'speech_particles' | 'tears' | 'flame_particles' | 'zzz' | 'confetti' | 'green_particles' | 'dizzy_stars'

// ─── Pose Definition ───

export interface PoseDefinition {
  dynamics: BodyDynamics
  upperBody: UpperBodyStance
  lowerTorso: LowerTorsoStance
  leftArm: ArmPose
  rightArm: ArmPose
  leftLeg: LegPose
  rightLeg: LegPose
  face: FaceExpression
  prop?: PropType
  effect?: EffectType
}

// ─── HD Pose Names ───

export type HDPoseName =
  // Core
  | 'idle' | 'idle2' | 'blink' | 'halfblink' | 'lookR' | 'lookL'
  // Walk
  | 'walk1' | 'walk2'
  // Combat
  | 'punch1' | 'punch2' | 'kick1' | 'kick2' | 'stab1' | 'stab2' | 'shoot1' | 'shoot2'
  // Social
  | 'talk1' | 'talk2' | 'dance1' | 'dance2' | 'wave1' | 'wave2' | 'think'
  | 'panic1' | 'panic2' | 'drink1' | 'drink2' | 'tongue'
  | 'argue1' | 'argue2' | 'rally1' | 'rally2' | 'celebrate1' | 'celebrate2'
  | 'pray' | 'mourn' | 'monologue1' | 'monologue2'
  // Biological
  | 'pee' | 'poop' | 'vomit' | 'sleep' | 'eat1' | 'eat2'
  // Actions
  | 'gather1' | 'gather2' | 'repair1' | 'repair2'
  | 'trade1' | 'trade2' | 'observe1' | 'observe2' | 'observe3' | 'observe4' | 'rest'
  | 'threaten1' | 'threaten2' | 'poison1' | 'poison2'
  | 'sabotage1' | 'sabotage2' | 'hoard1' | 'hoard2'
  | 'steal1' | 'steal2' | 'accuse1' | 'accuse2'
  | 'investigate1' | 'investigate2' | 'investigate3' | 'investigate4'
  | 'explore1' | 'explore2' | 'explore3' | 'explore4'
  | 'vote' | 'breakdown1' | 'breakdown2' | 'self_sacrifice'
  // Consequences
  | 'dead' | 'injured' | 'stunned' | 'knocked_down' | 'fleeing1' | 'fleeing2'

// ─── Character Definition (HD) ───

export type HairStyle = 0 | 1 | 2 | 3 | 4 | 5
export type BodyType = 'standard' | 'small'

export interface AccessorySet {
  hat?: 'cap' | 'beanie' | 'chef' | 'tophat' | 'military'
  hatColor?: string
  mustache?: 'handlebar' | 'thick' | 'goatee'
}

export interface HDCharacterDef {
  id: string
  basePalette: BasePalette
  hairStyle: HairStyle
  bodyType: BodyType
  accessories: AccessorySet
  rosyCheeks?: boolean
}

// ─── Render Grid ───

export type PixelGrid = (string | null)[][]

// ─── Hand Position (returned from arm renderer) ───

export interface HandPosition {
  hx: number
  hy: number
}

// ─── Shoulder Attachment Points ───

export interface ShoulderPoints {
  left: { x: number; y: number }
  right: { x: number; y: number }
}

// ─── Status Effects ───

export type StatusEffectType =
  | 'bleeding' | 'bruised' | 'shot_wound' | 'burned'
  | 'poisoned' | 'crying' | 'bandaged' | 'stunned' | 'knocked_down'

export interface StatusEffect {
  type: StatusEffectType
  /** Random seed for consistent wound placement per character */
  seed?: number
}

// ─── HD Animation Definition ───

export interface HDAnimationDef {
  name: string
  poses: HDPoseName[]
  speed: number     // AnimatedSprite.animationSpeed (frames per tick)
  loop: boolean
}
