---
title: "[P1] Sprite action visualization during turns"
status: done
issue: 109
priority: P1
tags: [stream-1, frontend, pixi, animation, turn-lifecycle]
depends_on: [116, hd-sprite-system]
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
  `idle → thinking → moving → acting → hud-only`
- **`TurnHandlers`** interface with `move`, `updateAgent`, `addConversation`, `getAgentLocation`
- Sprites render at `PIXEL_SCALE = 2` (28x36px final size)

### The gap

1. No `'thinking'` phase — inner thoughts appear during action execution
2. Speech bubbles replace action-turn inner thoughts when dialogue arrives into the turn lifecycle
3. No `playAction` handler in `TurnHandlers`
4. Sprites too small to distinguish action poses at typical zoom
5. No action label overlay during animations
6. No target agent highlighting

## Requirements

### 1. Acting Phase in Turn Lifecycle
<!-- status: done -->

Insert a thought-first turn lifecycle where `'thinking'` precedes `'moving'`, followed by
`'acting'`, then turn completion.

**Acceptance criteria:**
- [x] `TurnPhase` type includes `'thinking'` and `'acting'`: `'idle' | 'thinking' | 'moving' | 'acting' | 'hud-only'`
<!-- canon:realized-in:PR#134 file:frontend/src/stores/turn.ts -->
<!-- canon:realized-in:PR#116 file:frontend/src/stores/turn.ts -->
- [x] Thought narration phase happens before movement begins when a turn has `inner_thought`
- [x] `startActionPhase()` added to turn store, called after movement completes
<!-- canon:realized-in:PR#190 file:frontend/src/stores/turn.ts -->
- [x] Action phase looks up `ACTION_TO_ANIMATION[turn.actionType]` to resolve the animation
- [x] Calls `playAction` handler with agent ID, animation name, and `onComplete` callback
- [x] `onComplete` transitions to turn completion (`hud-only` for silent turns, immediate advance for narrated turns)
- [x] Actions without a meaningful animation (e.g., `move`, `rest`, `explore` — where the
  mapped animation is `'idle'` or `'walk'`) skip directly to completion
<!-- canon:realized-in: file:frontend/src/stores/turn.ts func:startActionPhase SKIP_ACTION_PHASE guard -->
- [x] Minimum acting duration of 1500ms — if animation completes sooner, hold the last
  meaningful pose until the floor expires
<!-- canon:realized-in: file:frontend/src/stores/turn.ts MIN_ACTION_DURATION_MS=1500 dual gate -->

### 2. playAction Turn Handler
<!-- status: done -->

Add a `playAction` callback to the `TurnHandlers` interface so the turn store can trigger
PixiJS animations without importing PixiJS code.

**Acceptance criteria:**
- [x] `TurnHandlers` gains `playAction: (agentId: string, animationName: string, onComplete: () => void) => void`
- [x] `SimulationView` wires the handler to `usePixiWorld`, which calls `AgentSpriteObject.playAnimation()`
<!-- canon:realized-in:PR#134 file:frontend/src/views/SimulationView.vue -->
<!-- canon:realized-in:PR#116 file:frontend/src/views/SimulationView.vue -->
- [x] Handler calls `onComplete` immediately if agent ID is not found (defensive)
<!-- canon:realized-in:PR#134 file:frontend/src/composables/usePixiWorld.ts -->
- [x] Turn data model (`Turn` interface) supports optional `targetAgentId` field

### 3. Sprite Scale Increase
<!-- status: done -->

Increase agent sprite render scale so action poses are clearly readable at default zoom.

**Acceptance criteria:**
- [x] `PIXEL_SCALE` increased (2 → 3 or 4, to be tuned visually)
<!-- canon:realized-in:PR#134 file:frontend/src/components/world/pixi/AgentSprite.ts -->
<!-- canon:realized-in:PR#116 file:frontend/src/config/sprites/constants.ts -->
- [x] Name labels scale proportionally
- [x] Selection ring scales proportionally
- [x] Camera default zoom adjusted if needed to accommodate larger sprites
- [x] Zoom min/max bounds reviewed and adjusted if needed
<!-- canon:realized-in: file:frontend/src/components/world/pixi/CameraController.ts MIN_ZOOM=0.3 MAX_ZOOM=3 -->

### 4. Action Label Overlay
<!-- status: done -->

Show the action type as a label near the sprite during the acting phase.

**Acceptance criteria:**
- [x] Vue overlay component positioned using `getAgentScreenPosition()` (same pattern as
  conversation bubbles)
<!-- canon:realized-in: file:frontend/src/components/hud/ActionLabel.vue -->
- [x] Label shows the action type in uppercase (e.g., "STAB", "GATHER", "SABOTAGE")
<!-- canon:realized-in:PR#134 file:frontend/src/components/hud/ActionLabel.vue -->
- [x] Aggressive actions (`attack`, `stab`, `shoot`, `threaten`, `poison`) use an emphasized
  style (red/bold or similar)
<!-- canon:realized-in: file:frontend/src/components/hud/ActionLabel.vue .action-label--aggressive #ff4444 -->
- [x] Label appears when phase enters `'acting'`, disappears when phase leaves `'acting'`
- [x] Label does not appear for skipped (no-animation) actions

### 5. Target Agent Highlighting
<!-- status: done -->

When an action has a target agent, visually highlight the target during the acting phase.

**Acceptance criteria:**
- [x] `AgentSpriteObject` supports a `setHighlight(color)` / `clearHighlight()` method
<!-- canon:realized-in:PR#116 file:frontend/src/components/world/pixi/AgentSprite.ts -->
  (draws a colored ring, similar to the existing selection ring)
- [x] Target agent gets a highlight ring during the acting phase — red for aggressive actions,
  neutral/white for social actions
<!-- canon:realized-in: file:frontend/src/views/SimulationView.vue watcher on turnStore.phase lines 344-364 -->
- [x] Highlight appears at start of acting phase, fades/clears when acting phase ends
- [x] No highlight if the action has no target

## Technical Design

### Turn store changes (`stores/turn.ts`)

```
processNext()
  → if thought: startThoughtPhase()
  → else: startMovementPhase()

startThoughtPhase()
  → phase = 'thinking'
  → wait for audio completion or timeout
  → startMovementPhase()

startActionPhase()
  → animation = ACTION_TO_ANIMATION[turn.actionType]
  → if animation is 'idle' or 'walk' → completeTurnPhase()
  → phase = 'acting'
  → handlers.playAction(agentId, animation, () => {
      completeTurnPhase()
    })
  → apply minimum duration floor (800ms)
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
| `thinking` | ~3-5s | Inner-thought bubble: "I know what you've been hiding..." |
| `moving` | ~1.5s | Whistleblower walks tile-by-tile from jungle to beach camp |
| `acting` | ~1.25s | Whistleblower plays stab animation (arm extends with weapon). "STAB" label in red above sprite. Con Artist gets a pulsing red highlight ring. |
| `hud-only` | 1.5s | HUD status shown briefly for silent turns only |

Total: ~6-7 seconds per agent turn.

## Key Files

- `frontend/src/stores/turn.ts` — turn lifecycle and phase management
- `frontend/src/components/world/pixi/AgentSprite.ts` — sprite rendering and animation
- `frontend/src/composables/usePixiWorld.ts` — Vue ↔ PixiJS bridge
- `frontend/src/types/sprite.ts` — `ACTION_TO_ANIMATION` mapping
- `frontend/src/config/character-sprites.ts` — poses, animations, pixel scale
- `frontend/src/views/SimulationView.vue` — handler wiring

## HD Sprite System Integration

> See `hd-sprite-system.md` — the sprite system is being upgraded from 14×18px to 32×48px
> composable characters. Key impacts on this spec:
> - Sprite scale change (32×48 base) affects PIXEL_SCALE, selection ring, name label sizing
> - 26+ poses available (up from 14) — more actions get distinct animations
> - Composable body-part architecture means new poses are data config, not pixel art
> - `ACTION_TO_ANIMATION` will have 1:1 mapping for all 42 action types
> - Props (knife, gun, mug, etc.) render as part of the sprite frame

## Out of Scope

- Direction-aware sprites (facing toward target) — future enhancement
- Simultaneous multi-agent actions — turns remain sequential
- Sound effects for actions
