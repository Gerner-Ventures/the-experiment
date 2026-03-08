---
title: "[P1] HD sprite system — composable 32×48 characters with body-part architecture"
status: in_progress
priority: P1
tags: [stream-1, frontend, pixi, sprites, animation, rendering, character-engine]
depends_on: []
---

# HD Sprite System

Upgrade from 14×18px hex-string sprites to a composable 32×48px character rendering engine with 3D shading, full action animation coverage, and a scalable body-part architecture.

## 1. Background

### Current system (14×18px)
- Hex-string rows define body, hair, and pose pixel overrides in `frontend/src/config/sprites/`
- 8-color `CharacterPalette` mapped via single hex chars
- Layered rendering: body → hair → outfit → accessories → pose overrides
- 14 poses, many actions share the same animation (8 actions all map to `gather`)
- Hard to add new poses — requires manually editing hex strings
- No facial expressions, no props, no body dynamics

### Prototype (v1–v6)
Built in `frontend/sprite-comparison-demo.html` — a self-contained HTML demo iterating through 6 versions of HD characters at 32×48px with:
- 26 poses with body dynamics (bob, lean, squash)
- 3D shading (rim light, AO, depth gradients)
- Facial expression system (8 mouth types, 4 eye states, brow variations)
- Props (knife, gun, mug, thought bubble, impact stars)
- Accessories (5 hat types, 3 mustache types)
- Character variants (child = smaller body, rosier cheeks)

### Why the prototype doesn't scale
The demo uses a monolithic render function with hardcoded pixel coordinates. Adding a new pose means editing hundreds of lines. A character generation engine needs:
- 42+ distinct animations (34 decision actions + 8 consequence actions)
- Easy addition of new body types, accessories, and props
- Palette-driven customization without touching render code
- Performance at scale (20+ agents rendering simultaneously)

## 2. Architecture: Composable Body Part System

### Design Principles
- **Composition over monolith** — characters assembled from independent parts
- **Data-driven poses** — new action = JSON config picking arm/face/body/prop, not pixel code
- **Auto-derivation** — provide 4-5 base colors, system derives 18+ shading colors
- **Separation of concerns** — body parts, poses, props, and expressions are independent layers

### Scaling Strategy

Most actions are combinations of the same building blocks:

| Layer | Unique Options | One-Time Investment |
|-------|---------------|---------------------|
| Upper body stances | ~6 (upright, lean forward, hunch, bent forward, collapsed, lunge) | Medium |
| Lower torso positions | ~5 (neutral, twist/sway, crouch, squat, lying) | Medium |
| Leg positions | ~8 (standing, walk cycle L/R, wide stance, lunge, kneel, squat, lying flat) | Medium |
| Arm positions | ~10 (down, back, fwd, up, diag, punch, hold, reach, clasped, spread) | Already mostly prototyped |
| Face expressions | ~8 (neutral, talk, smile, grit, panic, cry, squint, closed) | Already prototyped |
| Brow states | ~4 (normal, angry, raised, sad) | Already prototyped |
| Props | ~15 (knife, gun, mug, hammer, vial, sack, food, etc.) | Small — 3-8px each |

Adding a new action becomes config, not art:

```typescript
defineAction('cook', {
  upperBody: 'upright',
  lowerTorso: 'neutral',
  legs: 'standing',
  rightArm: 'hold',
  leftArm: 'down',
  face: { mouth: 'smile', eyes: 'open', brows: 'normal' },
  prop: { type: 'spatula', attachTo: 'rightHand' },
  dynamics: { bob: 0, lean: 0, squash: 0 },
  frames: ['idle', 'cook1', 'cook2', 'cook1', 'idle'],
  frameDuration: 200
})
```

New pixel art is only needed for:
- A new prop nobody's held before (~10 min, 3-8 pixels)
- A new arm position that doesn't exist (~20 min, rare)
- A new body stance (~30 min, very rare)

### Core Data Model

```typescript
// ─── CHARACTER DEFINITION ───
interface CharacterDefinition {
  id: string
  palette: BasePalette        // 4-5 input colors → auto-derives full palette
  bodyType: 'standard' | 'stocky' | 'slim' | 'child'
  hairStyle: number           // index into hair registry
  accessories: AccessorySet   // hat, mustache, glasses, etc.
}

interface BasePalette {
  skin: string       // → derives: shadow, highlight, deepShadow, rimLight, AO, cheek, ear, underEye, noseHighlight
  hair: string       // → derives: highlight, shadow, backShadow
  outfit: string     // → derives: shadow, deepShadow, highlight, rimLight, AO, belt, backDepth
  outfitAccent: string
  shoe: string       // → derives: shadow, highlight
}

// ─── BODY PARTS ───
interface BodyPartGrid {
  width: number
  height: number
  pixels: (string | null)[][]  // palette token or null for transparent
  anchor: { x: number, y: number }
}

// ─── POSE SYSTEM ───
interface PoseDefinition {
  name: string
  dynamics: { bob: number, lean: number, squash: number }
  parts: {
    head: PartTransform
    upperBody: UpperBodyStance  // 'upright' | 'lean_forward' | 'hunch' | 'bent_forward' | 'collapsed' | 'lunge'
    lowerTorso: LowerTorsoPos  // 'neutral' | 'twist_left' | 'twist_right' | 'sway' | 'crouch' | 'squat' | 'lying'
    leftArm: ArmPose           // 'down' | 'back' | 'fwd' | 'up' | 'diag' | 'punch' | 'hold' | etc.
    rightArm: ArmPose
    leftLeg: LegPose           // 'standing' | 'walk_fwd' | 'walk_back' | 'wide' | 'lunge' | 'kneel' | 'squat' | 'lying'
    rightLeg: LegPose
  }
  face: FaceExpression
  props: PropAttachment[]
  effects: EffectDefinition[]
}

interface FaceExpression {
  eyes: 'open' | 'blink' | 'halfblink' | 'squint' | 'wide'
  pupilDir: { x: number, y: number }
  mouth: 'neutral' | 'talk_open' | 'talk_wide' | 'smile' | 'panic_o' | 'pursed' | 'grit' | 'sip' | 'tongue' | 'cry'
  brows: 'normal' | 'angry' | 'raised' | 'sad'
}

// ─── ANIMATION ───
interface AnimationSequence {
  name: string
  frames: string[]           // pose names in order
  frameDurationMs: number
  loop: boolean
  transitions: {
    entry?: string[]         // e.g., halfblink before blink
    exit?: string[]          // e.g., recover to idle
  }
}
```

### Render Pipeline

```
renderCharacter(definition, poseName)
  1. Resolve palette: BasePalette → FullPalette (auto-derive 18+ colors)
  2. Resolve body type → get part grids for bodyType
  3. Resolve pose → PoseDefinition with transforms, face, props
  4. Create 32×48 output grid
  5. Composite (back to front):
     a. Ground shadow (ellipse, follows lean)
     b. Back arm (if behind body)
     c. Legs — resolve LegPose per leg (standing/walk/lunge/kneel/squat/lying) + 3D shading
     d. Lower torso — resolve LowerTorsoPos (neutral/twist/sway/crouch/squat/lying) + hip joint
     e. Upper torso — resolve UpperBodyStance (upright/lean/hunch/bent/collapsed/lunge) + 3D shading
     f. Front arm (with pose transforms)
     g. Neck
     h. Head fill + 3D shading
     i. Eyes (pupil direction + state)
     j. Under-eye, nose, mouth (from FaceExpression)
     k. Mustache (if equipped)
     l. Hair (from registry)
     m. Hair back shadow
     n. HEAD OUTLINE (drawn LAST — stays crisp)
     o. Ears (outside outline)
     p. Hat (if equipped)
     q. Props (attached to hand/body)
     r. Effects (particles, flash, stars)
  6. Return pixel grid
```

### Why Composable Parts Over Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| Spritesheets | Fastest render (texture lookup) | Fixed combinations, huge atlas, can't customize runtime |
| Skeletal (Spine) | Smooth interpolation | Complex tooling, overkill for pixel art |
| **Composable parts** | Infinite combos, data-driven, palette-driven, easy to extend | More CPU per frame (mitigated by caching) |

### Performance Strategy

- **Frame cache**: `Map<string, ImageData>` keyed by `${characterId}:${poseName}`
- **Pre-render on spawn**: render all poses for agent's action set when they enter scene
- **Dirty flag**: re-render only when palette/accessory changes (rare)
- **Shared shadows**: identical for same body type + lean value
- **Budget**: <2ms per uncached render, <0.1ms cached lookup

## 3. Requirements

### 3.1 Composable Body Part Registry
<!-- status: todo -->

**Acceptance criteria:**
- [ ] `BodyPartGrid` type with width, height, pixels, anchor
- [ ] Head parts: standard (12×12), child (12×10)
- [ ] Upper torso parts: standard (12×11), stocky (14×10), slim (10×12), child (10×8)
- [ ] Lower torso parts: standard (12×5), stocky (14×5), slim (10×5), child (10×4) — hip/waist region
- [ ] Arm parts: upper (3×5), forearm (3×4), hand (3×2)
- [ ] Leg parts: upper thigh (4×5), lower leg (4×5), shoe (6×2)
- [ ] 5 lower torso positions: neutral, twist_left, twist_right, crouch, squat, lying
- [ ] 8 leg positions: standing, walk_fwd, walk_back, wide_stance, lunge, kneel, squat, lying_flat
- [ ] 6 hair styles, 5 hat types, 3 mustache types as independent grids
- [ ] All parts use palette tokens, not hardcoded colors

### 3.2 Auto-Derived Palette System
<!-- status: todo -->

**Acceptance criteria:**
- [ ] `BasePalette` → `FullPalette` derivation function
- [ ] Skin derives: shadow, highlight, deepShadow, rimLight, AO, cheek, ear, underEye, noseHighlight, lipUpper, lipLower, mouthInterior, teeth
- [ ] Outfit derives: shadow, deepShadow, highlight, rimLight, AO, belt, backDepth
- [ ] Hair derives: highlight, shadow, backShadow
- [ ] Eye color from deterministic hash
- [ ] All 21+ characters get BasePalette definitions
- [ ] Child variant overrides (rosier cheeks)

### 3.3 Pose Definitions for All 42 Action Types
<!-- status: todo -->

**Acceptance criteria:**
- [ ] All 34 decision actions have distinct PoseDefinitions
- [ ] All 8 consequence actions have PoseDefinitions
- [ ] No two meaningfully different actions share the exact same pose
- [ ] Each PoseDefinition specifies: dynamics, upperBody, lowerTorso, legs, arms, face, props, effects
- [ ] Animation sequences with frame order, timing, entry/exit transitions

### 3.4 3D Shading as Post-Process
<!-- status: todo -->

**Acceptance criteria:**
- [ ] `applyShading(grid, palette, lightDir)` compositing function
- [ ] Head: deep shadow left, rim light right, top highlight
- [ ] Torso: back-depth center, deep shadow stripe, rim light, collar AO
- [ ] Arms: shadow/highlight edges per segment
- [ ] Legs: AO between legs, inner back shadow
- [ ] Ground shadow: elliptical, follows lean, gradient opacity
- [ ] Head outline as final compositing step

### 3.5 Prop Registry
<!-- status: todo -->

**Acceptance criteria:**
- [ ] Each prop is a small independent `BodyPartGrid` with attachment point
- [ ] Knife (vertical hold + horizontal thrust), Gun (barrel + grip + muzzle flash)
- [ ] Mug (body + handle + straw + liquid), Hammer (swing up/down)
- [ ] Vial (green, poison), Sack (brown, trade/hoard), Bandage/cross (heal)
- [ ] Food (eat), Magnifying glass (investigate), Megaphone (rally)
- [ ] Thought bubble (think), Speech particles (talk), Tears (cry/mourn)
- [ ] Impact stars (punch/kick), Flame particles (burning), Dizzy stars (stunned)
- [ ] Props use fixed colors for cross-character consistency

### 3.6 PixiJS Integration & Frame Cache
<!-- status: todo -->

**Acceptance criteria:**
- [ ] `AgentSprite.ts` uses composable renderer
- [ ] Frame cache with pre-render on spawn
- [ ] `PIXEL_SCALE` adjusted for 32×48 base
- [ ] `ACTION_TO_ANIMATION` updated — 1:1 for all 42 action types
- [ ] Performance: <2ms uncached, <0.1ms cached, 20+ agents at 60fps
- [ ] Old hex-string system removed

## 4. Full Action → Animation Map

### Decision Actions (34)

| Action | Animation | Upper Body | Lower Torso | Legs | Arms | Face | Props |
|--------|-----------|------------|-------------|------|------|------|-------|
| `move` | walk | upright | neutral | walk cycle | fwd/back alternate | neutral | — |
| `explore` | walk | upright | neutral | walk cycle | fwd/back alternate | lookR/lookL | — |
| `gather` | gather | bent forward | crouch | squat | reaching down/holding | neutral | bundle |
| `repair` | build | upright | neutral | standing | hammer swing up/down | grit | hammer |
| `trade` | trade | upright | neutral | standing | both extended out | neutral | sack |
| `talk` | talk | upright | neutral | standing | gesture diag/up | talk_open/wide | speech particles |
| `vote` | vote | upright | neutral | standing | one arm straight up | neutral | — |
| `rest` | rest | upright | neutral | standing | down | squint, blink | — |
| `observe` | observe | upright | neutral | standing | hand shielding eyes | lookR | — |
| `eat` | eat | upright | neutral | standing | hand to mouth | talk_open (chew) | food |
| `drink` | drink | upright | neutral | standing | hold | sip, squint | mug + straw |
| `sleep` | sleep | collapsed | lying | lying flat | down | closed | zzz |
| `attack` | punch | lunge | twist_right | lunge | wind-up → snap | angry, grit | impact stars |
| `stab` | stab | lunge | twist_right | lunge | wind-up → thrust | angry, grit | knife |
| `shoot` | shoot | lean forward | neutral | wide stance | both forward → recoil | angry, grit | gun + flash |
| `threaten` | threaten | upright | neutral | wide stance | raised fist shaking | angry, grit | — |
| `poison` | poison | hunch | neutral | standing | sneaky hold | pursed, lookR | vial |
| `sabotage` | sneak | hunch | neutral | standing | tool in hand | pursed, lookR | wrench |
| `hoard` | sneak_carry | hunch | neutral | standing | clutched to chest | pursed | sack |
| `steal` | sneak_reach | hunch | neutral | standing | reaching forward | pursed, lookR | — |
| `dance` | dance | upright | sway L/R | standing | up alternating | smile | — |
| `celebrate` | celebrate | upright | neutral | standing | both up | smile | confetti |
| `rally` | rally | upright | neutral | wide stance | both raised high | talk_wide | megaphone |
| `argue` | argue | lean forward | neutral | standing | pointing finger | angry, talk_wide | — |
| `accuse` | accuse | lean forward | twist_right | lunge | arm thrust pointing | angry, talk_open | — |
| `pray` | pray | upright | neutral | kneel | clasped at chest | closed eyes | — |
| `mourn` | mourn | upright | neutral | kneel | down | sad, cry | tears |
| `panic` | panic | upright | neutral | walk cycle (fast) | flailing alternate | raised brow, panic_o | — |
| `breakdown` | breakdown | collapsed | crouch | squat | down | cry | tears |
| `investigate` | investigate | upright | neutral | standing | holding up lens | lookR | magnifying glass |
| `monologue` | monologue | upright | neutral | standing | one arm gesturing | talk_open | speech lines |
| `pee` | pee | upright | neutral | wide stance | down | squint | — |
| `poop` | poop | upright | squat | squat | down | grit | — |
| `vomit` | vomit | bent forward | crouch | wide stance | down | grit | particles |
| `self_sacrifice` | sacrifice | upright | neutral | wide stance | arms spread wide | closed eyes | glow |

### Consequence Actions (8)

| Consequence | Animation | Upper Body | Lower Torso | Legs | Face | Effects |
|-------------|-----------|------------|-------------|------|------|---------|
| `bleeding` | bleeding | lean forward | neutral | standing (limp) | grit, squint | red drip pixels |
| `injured` | injured | hunch | neutral | standing (limp) | grit | — |
| `stunned` | stunned | upright (sway) | neutral | wide stance | halfblink | dizzy stars |
| `knocked_down` | knocked_down | collapsed | lying | lying flat | closed | — |
| `burning` | burning | upright | neutral | walk cycle (fast) | panic_o | flame particles |
| `poisoned` | poisoned | hunch | crouch | standing | grit, squint | green particles |
| `crying` | crying | upright | neutral | kneel | cry | tear pixels |
| `fleeing` | fleeing | lean forward | neutral | walk cycle (fast) | raised brow, panic_o | — |

## 5. Migration Path

1. Define types — `BodyPartGrid`, `PoseDefinition`, `BasePalette`, `AnimationSequence`
2. Port palette auto-derivation from demo
3. Extract body parts from demo's render function into composable grids
4. Convert poses to `PoseDefinition` data objects
5. Build composable renderer (assembles parts per pose)
6. Add shading as post-process pass
7. Build prop registry (independent grids with attachment points)
8. Wire into `AgentSprite.ts` with frame cache
9. Implement remaining ~19 action-specific poses
10. Remove old hex-string system

## 6. Key Files

| File | Status |
|------|--------|
| `frontend/src/config/sprites/types.ts` | Rewrite — composable types |
| `frontend/src/config/sprites/palette.ts` | New — auto-derivation |
| `frontend/src/config/sprites/body-parts.ts` | New — part registry |
| `frontend/src/config/sprites/poses.ts` | Rewrite — PoseDefinition data |
| `frontend/src/config/sprites/props.ts` | New — prop registry |
| `frontend/src/config/sprites/animations.ts` | Rewrite — 42 action sequences |
| `frontend/src/config/sprites/render.ts` | Rewrite — composable renderer |
| `frontend/src/config/sprites/shading.ts` | New — 3D shading post-process |
| `frontend/src/config/sprites/cache.ts` | New — frame cache |
| `frontend/src/config/sprites/characters.ts` | Update — BasePalette per character |
| `frontend/src/config/sprites/constants.ts` | Update — GRID_W=32, GRID_H=48 |
| `frontend/src/components/world/pixi/AgentSprite.ts` | Update — use new renderer |
| `frontend/src/types/sprite.ts` | Update — ACTION_TO_ANIMATION 1:1 |

## 7. Out of Scope

- Spritesheet export / texture atlas (future optimization)
- Direction-aware sprites (facing toward target)
- Skeletal animation / Spine integration
- Building rendering (separate spec: `isometric-aesthetics.md`)
- Sound effects

## 8. References

- Prototype: `frontend/sprite-comparison-demo.html` (v6)
- `s1.4-agent-rendering.md` — agent sprite system
- `action-animation-mapping.md` — action visual descriptions
- `sprite-action-visualization.md` — turn lifecycle acting phase
- `consequence-action-types.md` — consequence actions
- `isometric-aesthetics.md` — map/building rendering (separate)
