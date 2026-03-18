---
title: "Action → Animation Mapping"
status: in_progress
tags: [stream-1, frontend, animation, sprites]
---

# Action → Animation Mapping

> **Superseded by**: `hd-sprite-system.md` Section 4 contains the updated 1:1 action→animation map
> covering all 34 decision actions and 8 consequence actions with the composable body part system.
> This document remains as reference for the original design intent.

Maps backend action types to sprite animations with visual props and descriptions.

## Design Principles

- Every action should have a **distinct visual** so players can read what agents are doing at a glance
- Props (items held by characters) are rendered as pixel overlays on the sprite during the action
- Aggressive actions get **red highlight rings** on targets; all others get white
- Actions in `SKIP_ACTION_PHASE` (move, rest, observe, explore) don't play animations

---

## Implemented Animations (have poses)

| Action Type | Animation | Pose Frames | Description |
|-------------|-----------|-------------|-------------|
| `dance` | dance | dance1, dance2 | Arms up alternating, celebratory movement |
| `stab` | stab | idle → stab → idle | Arm thrust forward with blade |
| `shoot` | shoot | idle → shoot → idle | Arm extended forward, recoil |
| `pee` | pee | idle → pee (hold) → idle | Legs apart stance |
| `poop` | poop | idle → poop (hold) → idle | Squat position |
| `vomit` | vomit | idle → vomit (hold) → idle | Bent forward, particles |
| `panic` | panic | panic1, panic2 | Arms flailing alternating |
| `sleep` | sleep | sleep (hold) → idle | Lying flat, zzz |
| `dead` | dead | idle → dead (hold) → idle | Collapsed on ground |

---

## Needs New Poses + Props

### Social Actions

| Action Type | Animation | Prop | Visual Description |
|-------------|-----------|------|-------------------|
| `rally` | rally | **Palm fronds** (green pixels, both hands raised) | Character holds palm fronds above head, alternating wave. 2 frames: rally1 (fronds left), rally2 (fronds right) |
| `talk` | talk | **Bullhorn / megaphone** (gray pixels, held to mouth) | Character holds megaphone up to face. 2 frames: talk1 (horn up), talk2 (horn slightly down, "speaking") |
| `argue` | argue | **Pointed finger** (arm extended, index finger out) | Character pointing aggressively. 2 frames: argue1 (point left), argue2 (point right) |
| `vote` | vote | **Raised hand** (one arm straight up) | Hand raised like casting a vote. 1 frame: static raised arm |
| `celebrate` | celebrate | **Confetti / sparkle** (colored pixels around head) | Arms up like dance but with colored pixels scattering above. 2 frames |
| `pray` | pray | **Clasped hands** (hands together at chest) | Hands pressed together, head slightly bowed. 1 frame: static |
| `mourn` | mourn | **Tears** (blue pixels below eyes) | Head bowed, blue tear pixels. 1 frame: static |

### Work / Productive Actions

| Action Type | Animation | Prop | Visual Description |
|-------------|-----------|------|-------------------|
| `gather` | gather | **Bundle of sticks/resources** (brown pixels in arms) | Character bent down picking up items. 2 frames: gather1 (reaching), gather2 (holding bundle) |
| `repair` / `build` | build | **Hammer** (gray/brown pixels, arm swinging) | Character swinging hammer. 2 frames: build1 (hammer up), build2 (hammer down) |
| `heal` | heal | **Bandage / cross** (white/red pixels, hands forward) | Character extending hands with red cross icon. 2 frames: heal1 (hands out), heal2 (cross glowing) |
| `trade` | trade | **Sack / bag** (brown pixels, held out) | Character holding out a sack. 1 frame: arms extended with bag |

### Aggressive Actions

| Action Type | Animation | Prop | Visual Description |
|-------------|-----------|------|-------------------|
| `attack` / `punch` | punch | **Fist** (arm extended, clenched) | Character punching forward. 2 frames: punch1 (wind up), punch2 (extended) |
| `threaten` | threaten | **Raised fist** (arm up, menacing) | Fist raised above head. 2 frames: threaten1 (fist up), threaten2 (shaking) |
| `poison` | poison | **Vial** (green pixels, held sneakily) | Character holding small green bottle. Uses sneak pose with green vial overlay |

### Stealth Actions

| Action Type | Animation | Prop | Visual Description |
|-------------|-----------|------|-------------------|
| `hoard` | sneak | **Sack** (brown pixels, clutched to chest) | Hunched walk with bag held close |
| `sabotage` | sneak | **Wrench / tool** (gray pixels) | Hunched walk with tool in hand |
| `steal` | sneak | **Reaching hand** (arm extended forward) | Sneaky grab pose |
| `scheme` | think | **Thought bubble** (white circle pixels above head) | Hand on chin, bubble above |

### Emotional Actions

| Action Type | Animation | Prop | Visual Description |
|-------------|-----------|------|-------------------|
| `think` / `observe` | think | **Thought bubble** (small white circle above head) | Hand on chin, contemplative. 1 frame: static |
| `breakdown` | breakdown | **Tears + hunched** (blue pixels, bent over) | Character collapsed forward crying. Use panic frames + tears |
| `suspicious` / `investigate` | suspicious | **Magnifying glass** (circle pixels held up) | Character peering through lens. 1 frame |
| `monologue` | monologue | **Speech lines** (small white dashes near mouth) | Character gesturing with one arm, speaking. 2 frames |

### Biological Actions

| Action Type | Animation | Prop | Visual Description |
|-------------|-----------|------|-------------------|
| `eat` | eat | **Food item** (colored pixels near mouth) | Hand raised to mouth. 2 frames: eat1 (food up), eat2 (chewing) |
| `drink` | drink | **Cup / bottle** (blue pixels near mouth) | Hand raised with container. 2 frames |

---

## Implementation Priority

### Phase 1 — High-impact social actions (most common in gameplay)
1. `talk` — bullhorn to mouth
2. `rally` — palm fronds raised
3. `gather` — picking up resources
4. `argue` — pointed finger
5. `think` — hand on chin + thought bubble

### Phase 2 — Combat + stealth
6. `punch` / `attack` — fist forward
7. `threaten` — raised fist
8. `sneak` (shared by hoard/sabotage/steal) — hunched pose
9. `build` / `repair` — hammer swing

### Phase 3 — Expressive + rare
10. `celebrate` — arms up + confetti
11. `pray` — clasped hands
12. `mourn` — head bowed + tears
13. `heal` — hands out + cross
14. `eat` / `drink` — food/cup to mouth

### Phase 4 — Edge cases
15. `monologue` — gesturing + speech lines
16. `suspicious` — magnifying glass
17. `breakdown` — collapsed + tears
18. `trade` — holding sack out
19. `vote` — raised hand
20. `poison` — green vial

---

## Technical Notes

### Pose Definition Pattern
Each new animation needs:
1. New `PoseName` entries in `character-sprites.ts` (e.g., `'rally1' | 'rally2'`)
2. Pose body overrides in `POSES` object (pixel row modifications for legs, arms, props)
3. Animation sequence in `SILLY_ANIMATIONS` (frame order + timing)
4. Props are rendered as additional colored pixels in the body override rows

### Prop Rendering
Props are pixel art overlaid on the character body via `bodyOverrides` in the pose definition. Each prop is 2-4 pixels wide and colored distinctly from the character palette. Props use fixed colors (not palette-mapped) so they look consistent across all character sprites.

### Fallback
Actions without implemented animations should fall back to `idle` with a **subtle bounce** (scale pulse) so the player at least sees something happened. Currently they silently freeze — this needs to be fixed.
