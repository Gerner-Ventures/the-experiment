---
title: "[P1] Sprite action visualization during turns"
status: todo
issue: 109
priority: P1
tags: [stream-1, frontend, pixi, animation, turn-lifecycle]
depends_on: [116]
---

# Sprite Action Visualization During Turns

Agents should visually perform their action animations during turns so players can see what
each agent is doing. Currently the turn lifecycle (PR #116) moves from movement to speech,
skipping the action animation entirely. Sprites are also too small to clearly read action poses.

## Background

### What exists today (main + PR #116)

- **22 procedural pixel characters** with 14 named poses (dance, stab, shoot, panic, sleep,
  poop, etc.) defined in `character-sprites.ts`
- **`SILLY_ANIMATIONS`** — frame sequences with timing (e.g., stab = `[idle, stab, stab, stab, idle]` at 250ms/frame)
- **`ACTION_TO_ANIMATION`** mapping in `sprite.ts` — 40+ game actions mapped to sprite
  animations (e.g., `stab → stab`, `gather → gather`, `sabotage → sneak`)
- **`AgentSpriteObject.playAnimation()`** — accepts any `SILLY_ANIMATIONS` entry and plays it
  with a completion callback
- **Turn store** (PR #116) — sequential queue processing one agent at a time with phases:
  `idle → moving → talking → hud-only`
- **`TurnHandlers`** interface with `move`, `updateAgent`, `addConversation`, `getAgentLocation`
- Sprites render at `PIXEL_SCALE = 2` (28x36px final size)

### The gap

1. No `'acting'` phase — turns skip directly from movement to speech
2. `ACTION_TO_ANIMATION` is defined but never wired into the turn lifecycle
3. No `playAction` handler in `TurnHandlers`
4. Sprites too small to distinguish action poses at typical zoom
5. No action label overlay during animations
6. No target agent highlighting

## Requirements

### 1. Acting Phase in Turn Lifecycle
<!-- status: todo -->

Insert an `'acting'` phase between `'moving'` and `'talking'` in the turn sequence.

**Acceptance criteria:**
- [ ] `TurnPhase` type includes `'acting'`: `'idle' | 'moving' | 'acting' | 'talking' | 'hud-only'`
- [ ] `startActionPhase()` added to turn store, called after movement completes
- [ ] Action phase looks up `ACTION_TO_ANIMATION[turn.actionType]` to resolve the animation
- [ ] Calls `playAction` handler with agent ID, animation name, and `onComplete` callback
- [ ] `onComplete` transitions to `startSpeechPhase()`
- [ ] Actions without a meaningful animation (e.g., `move`, `rest`, `observe` — where the
  mapped animation is `'idle'` or `'walk'`) skip directly to speech
- [ ] Minimum acting duration of 800ms — if animation completes sooner, hold the last
  meaningful pose until the floor expires

### 2. playAction Turn Handler
<!-- status: todo -->

Add a `playAction` callback to the `TurnHandlers` interface so the turn store can trigger
PixiJS animations without importing PixiJS code.

**Acceptance criteria:**
- [ ] `TurnHandlers` gains `playAction: (agentId: string, animationName: string, onComplete: () => void) => void`
- [ ] `SimulationView` wires the handler to `usePixiWorld`, which calls `AgentSpriteObject.playAnimation()`
- [ ] Handler calls `onComplete` immediately if agent ID is not found (defensive)
- [ ] Turn data model (`Turn` interface) supports optional `targetAgentId` field

### 3. Sprite Scale Increase
<!-- status: todo -->

Increase agent sprite render scale so action poses are clearly readable at default zoom.

**Acceptance criteria:**
- [ ] `PIXEL_SCALE` increased (2 → 3 or 4, to be tuned visually)
- [ ] Name labels scale proportionally
- [ ] Selection ring scales proportionally
- [ ] Camera default zoom adjusted if needed to accommodate larger sprites
- [ ] Zoom min/max bounds reviewed and adjusted if needed

### 4. Action Label Overlay
<!-- status: todo -->

Show the action type as a label near the sprite during the acting phase.

**Acceptance criteria:**
- [ ] Vue overlay component positioned using `getAgentScreenPosition()` (same pattern as
  conversation bubbles)
- [ ] Label shows the action type in uppercase (e.g., "STAB", "GATHER", "SABOTAGE")
- [ ] Aggressive actions (`attack`, `stab`, `shoot`, `threaten`, `poison`) use an emphasized
  style (red/bold or similar)
- [ ] Label appears when phase enters `'acting'`, disappears when phase leaves `'acting'`
- [ ] Label does not appear for skipped (no-animation) actions

### 5. Target Agent Highlighting
<!-- status: todo -->

When an action has a target agent, visually highlight the target during the acting phase.

**Acceptance criteria:**
- [ ] `AgentSpriteObject` supports a `setHighlight(color)` / `clearHighlight()` method
  (draws a colored ring, similar to the existing selection ring)
- [ ] Target agent gets a highlight ring during the acting phase — red for aggressive actions,
  neutral/white for social actions
- [ ] Highlight appears at start of acting phase, fades/clears when acting phase ends
- [ ] No highlight if the action has no target

## Technical Design

### Turn store changes (`stores/turn.ts`)

```
processNext()
  → phase = 'moving'
  → handlers.move(agentId, location, () => {
      startActionPhase()
    })

startActionPhase()
  → animation = ACTION_TO_ANIMATION[turn.actionType]
  → if animation is 'idle' or 'walk' → skip to startSpeechPhase()
  → phase = 'acting'
  → handlers.playAction(agentId, animation, () => {
      startSpeechPhase()
    })
  → apply minimum duration floor (800ms)

startSpeechPhase()
  → phase = 'talking'
  → (existing logic)
```

### Animation skip list

Actions that skip the acting phase (their animation is redundant with idle/movement):

```ts
const SKIP_ACTION_PHASE: Set<string> = new Set(['move', 'rest', 'observe', 'explore'])
```

### Minimum duration implementation

```ts
function startActionPhase() {
  const animation = ACTION_TO_ANIMATION[activeTurn.value!.actionType]
  if (!animation || SKIP_ACTION_PHASE.has(activeTurn.value!.actionType)) {
    startSpeechPhase()
    return
  }

  phase.value = 'acting'
  let animDone = false
  let floorDone = false

  const proceed = () => {
    if (animDone && floorDone) startSpeechPhase()
  }

  handlers?.playAction(activeTurn.value!.agentId, animation, () => {
    animDone = true
    proceed()
  })

  setTimeout(() => {
    floorDone = true
    proceed()
  }, MIN_ACTION_DURATION_MS)
}
```

### Target highlighting flow

Target agent ID comes from the turn data. `SimulationView` reads `activeTurn.targetAgentId`
reactively and calls `setHighlight` / `clearHighlight` on the target sprite when the phase
changes.

## Example Scenario

**Agent "Whistleblower" stabs "Con Artist":**

| Phase | Duration | What the player sees |
|-------|----------|---------------------|
| `moving` | ~1.5s | Whistleblower walks tile-by-tile from jungle to beach camp |
| `acting` | ~1.25s | Whistleblower plays stab animation (arm extends with weapon). "STAB" label in red above sprite. Con Artist gets a pulsing red highlight ring. |
| `talking` | ~3-5s | Speech bubble: "I know what you've been hiding..." Con Artist highlight fades. |
| `hud-only` | 1.5s | HUD status shown briefly (if no speech, otherwise skipped) |

Total: ~6-7 seconds per agent turn.

## Key Files

- `frontend/src/stores/turn.ts` — turn lifecycle and phase management
- `frontend/src/components/world/pixi/AgentSprite.ts` — sprite rendering and animation
- `frontend/src/composables/usePixiWorld.ts` — Vue ↔ PixiJS bridge
- `frontend/src/types/sprite.ts` — `ACTION_TO_ANIMATION` mapping
- `frontend/src/config/character-sprites.ts` — poses, animations, pixel scale
- `frontend/src/views/SimulationView.vue` — handler wiring

## Out of Scope

- New pose artwork (uses existing 14 poses)
- Direction-aware sprites (facing toward target) — future enhancement
- Simultaneous multi-agent actions — turns remain sequential
- Sound effects for actions
