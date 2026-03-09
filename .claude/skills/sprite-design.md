# Sprite Design Skill

Use this skill when designing, adding, or modifying visual elements in the HD sprite system: new poses, props, effects, hair styles, accessories, facial expressions, or status overlays.

## HD Sprite System Reference

### Grid & Coordinates
- **Canvas:** 32x48 pixels (HD_GRID_W=32, HD_GRID_H=48)
- **Scale:** 3x for production rendering (96x144px output)
- **Origin:** Top-left (0,0)
- **Character center:** x=16, feet at y=38
- **Anchor:** (0.5, 1) — bottom-center of canvas

### Body Layout (idle, standard size)
```
y=0-2:   Hair overflow / hat space
y=3-14:  Head (12x12 at x=10, rounded corners)
  y=5:     Ear line (ears at x=8, x=22)
  y=8:     Eye line (3x3 eyes at x=12 and x=17, 5px apart)
  y=10:    Nose (x=15,16)
  y=13:    Mouth line (x=14-17 neutral)
y=15-16: Neck (4x2 at x=14)
y=18-28: Torso (12x11 at x=10)
  y=18:    Collar (6x2)
  y=27:    Belt
y=29-36: Legs (two 4x8 columns at x=11 and x=17)
y=37-38: Shoes (two 6x2 blocks)
y=39-42: Ground shadow (elliptical, 14x4)
y=43-47: Ground plane
```

### Dynamics Offsets
All body positions shift by `dynamics.lean` (horizontal, -3..3) and `dynamics.bob` (vertical, -2..2). The torso height adjusts by `dynamics.squash` (0..2).

### Color Palette (FullPalette)
Derived from 8 base colors via `deriveFullPalette()`:
- **Skin:** sk, ss (shadow), sh (highlight), sd (deep), rim (bright edge)
- **Outfit:** o1 (primary), o2 (secondary), os/od/oh/orim (shadow/deep/highlight/rim), ob (back), bt (belt)
- **Hair:** hr, hh (highlight), hs (shadow), hbs (back shadow on neck)
- **Shoe:** s1, s2 (shadow), s3 (highlight)
- **Eyes:** ew (white), ei (iris), ep (pupil), eg (catchlight), eb (lower iris)
- **Face:** ml (lip), mu (upper lip), mi (mouth interior), mt (teeth), ch (cheek), ue (under-eye)
- **Shading:** ao/ao2 (ambient occlusion), gs (ground shadow)

### Drawing Primitives
All draw modules use:
```ts
px(grid, x, y, color)           // Single pixel with bounds check
rc(grid, x, y, w, h, color)     // Filled rectangle
```

### 3D Shading Convention
Every body part follows the same lighting direction:
- **Left edge:** Shadow (darker variant, 2px wide)
- **Right edge:** Highlight (1px) + rim light (1px, brightest)
- **Top:** Slight highlight
- **Bottom:** Shadow
- **Center columns:** Back-depth shadow (torso curves away from viewer)

## Architecture

### Composable Pipeline
The render pipeline in `hd/render.ts` orchestrates independent body-part renderers in z-order:

```
1. drawHead()       -> returns {headX, headY, headW, headH}
2. drawHair()       -> renders over head
3. drawHat()        -> renders over hair (if accessory)
4. drawMustache()   -> renders on face (if accessory)
5. drawNeck()       -> connects head to torso
6. drawTorso()      -> returns {tX, tH, shoulders: ShoulderPoints}
7. drawArm() x2     -> returns HandPosition {hx, hy} per arm
8. drawLegs()       -> uses torso bottom for positioning
9. drawGroundShadow()
10. drawProp()      -> anchored to right hand position
11. drawEffect()    -> anchored to right hand position
12. drawStatusOverlays() -> applied over base character
```

### Pose System
Each pose is a `PoseDefinition` that selects from existing body part variants. Adding a new action = picking variants, no new pixel art needed unless adding a new prop or arm position.

### Animation System
`HDAnimationDef` defines frame sequences:
```ts
{ name: 'attack', poses: ['idle', 'punch1', 'punch2', 'idle'], speed: 0.12, loop: false }
```
Speed is frames-per-tick (0.1 = ~6fps at 60Hz ticker). `HD_ACTION_TO_ANIMATION` provides 1:1 mapping from game actions to animations.

### Multi-Pose Prop Sequences
For actions like observe and investigate, props transition across poses:
- **Observe:** binoculars (at side) -> binoculars_raising (mid-lift) -> binoculars_face (front view over face)
- **Investigate:** magnifying_glass (at side) -> magnifying_glass_raising (mid-lift) -> magnifying_glass_face (large lens over eye)
- **Explore:** adventure_hat (held in hand) -> map (studying) -> map (hat on, striding)

Face-overlay props (binoculars_face, magnifying_glass_face) draw at fixed head coordinates (cx=16, ey=9) regardless of hand position.

### Status Overlay System
`hd/status-overlays.ts` draws persistent damage/effects AFTER base character:
- bleeding, bruised, shot_wound, burned, poisoned, crying, bandaged, stunned, knocked_down
- Overlays stack (bleeding + bruised + bandaged simultaneously)
- Uses seeded random for deterministic wound placement per character
- Cache key includes status hash for correct invalidation

### Theme / Visual Constants
`hd/theme.ts` contains all visual tuning values:
- Canvas layout: HD_CANVAS_H, HD_FEET_OFFSET_Y (-30), HD_HEAD_TOP_OFFSET_Y (-138)
- Selection/highlight ring sizes, colors, stroke widths
- Name label font, size, alpha
- Movement speed

## Design Workflow

### Adding a New Pose
1. Define `PoseDefinition` in `hd/poses.ts` — pick from existing body part variants:
   - `upperBody`: upright, lean_fwd, lean_back, hunch, bent_fwd, collapsed, lunge
   - `leftArm/rightArm`: down, back, fwd, up, diag, punch, uppercut, hold, reach, clasped, spread
   - `leftLeg/rightLeg`: standing, walk_fwd, walk_back, wide, lunge, kick_wind, kick_extend, kneel, squat, lying
   - `face.eyes`: open, blink, halfblink, squint, wide
   - `face.pupils`: center, left, right, up, up_right
   - `face.mouth`: neutral, open, wide_open, smile, panic_o, pursed, sip, tongue, grit, tense, cry
   - `face.brows`: normal, angry, raised, sad
   - `dynamics`: { bob: -2..2, lean: -3..3, squash: 0..2 }
2. Add the pose name to `HDPoseName` union in `hd/types.ts`
3. Add animation sequence in `hd/animations.ts` using the new pose
4. Map action type in `HD_ACTION_TO_ANIMATION`
5. Run tests: `npx jest tests/unit/sprites/hd-sprites.spec.ts`

### Adding a New Prop
1. Add prop type to `PropType` union in `hd/types.ts`
2. Add draw case in `hd/props.ts` — anchor to hand position `{hx, hy}`
3. For face-overlay props, draw at fixed head coordinates (cx=16, ey=9) instead of hand position
4. Reference in pose definition via `prop` field

### Adding a Multi-Pose Prop Sequence
Follow the observe/investigate pattern:
1. Create 3 prop variants: `prop_name` (held), `prop_name_raising` (mid-lift), `prop_name_face` (face overlay)
2. Create 4 poses: hold at side, raising, face-left, face-right
3. Animation sequence: idle -> hold -> raise -> scan_left -> scan_right -> lower -> idle

### Adding a New Arm/Leg Pose
1. Add to `ArmPose`/`LegPose` union in `hd/types.ts`
2. Add case in `hd/draw-arms.ts` or `hd/draw-legs.ts`
3. Define segment positions: upper (3x5), forearm (3x4), hand (3x2) for arms; leg column (4x8), shoe (6x2) for legs

### Adding a Hair Style
1. Add to `HairStyle` type range in `hd/types.ts`
2. Add case in `hd/draw-hair.ts` — render relative to `headX, headY, headW`
3. Use `c.hr` (base), `c.hh` (highlight), `c.hs` (shadow)

### Adding a Hat/Accessory
1. Add to `AccessorySet` interface in `hd/types.ts`
2. Add draw case in `hd/draw-hair.ts` (`drawHat` or `drawMustache`)

### Adding a Status Overlay
1. Add to `StatusEffectType` union in `hd/types.ts`
2. Add draw case in `hd/status-overlays.ts`
3. Overlays render AFTER base character, BEFORE final shading
4. Cache key includes status hash for invalidation
5. Use seeded random for consistent placement: `seededRand(status.seed ?? 42)`

## File Map
```
hd/types.ts            — All type definitions (HDPoseName, PropType, StatusEffect, etc.)
hd/constants.ts        — Grid dimensions (32x48), scale (3x)
hd/theme.ts            — Visual constants (ring sizes, label styles, offsets, speed)
hd/palette.ts          — Color derivation + utilities (darken, lighten, mix)
hd/draw-head.ts        — Head, eyes, mouth, nose, ears, brows
hd/draw-torso.ts       — Torso, neck, shoulders
hd/draw-arms.ts        — Arms (11 poses), returns hand position
hd/draw-legs.ts        — Legs (10 poses)
hd/draw-hair.ts        — Hair (6 styles), hats (5), mustaches (3)
hd/props.ts            — Props (25+), effects, ground shadow
hd/status-overlays.ts  — Status overlays (9 types: bleeding, bruised, etc.)
hd/poses.ts            — Pose registry (68+ poses)
hd/render.ts           — Main pipeline orchestrator
hd/animations.ts       — Animation registry + action mapping (1:1, 42 actions)
hd/characters.ts       — Character definitions (22 chars)
hd/cache.ts            — Frame cache (shared, keyed by char:pose:status)
hd/index.ts            — Barrel export
```

## Testing
- Unit tests: `npx jest tests/unit/sprites/hd-sprites.spec.ts` (48 tests)
- Visual: Open `frontend/sprite-comparison-demo.html` for prototype reference
- Toggle `USE_HD_SPRITES` in `AgentSprite.ts` to compare old vs new
