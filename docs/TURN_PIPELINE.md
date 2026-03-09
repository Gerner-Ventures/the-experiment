# Turn Pipeline

How agent actions are sequenced and animated on the frontend through the turn
queue state machine.

## Overview

The turn pipeline (`src/stores/turn.ts`) is the central orchestrator for all
agent-visible actions on the frontend. Every agent action, speech, meeting event,
and vote flows through this pipeline, which ensures animations, speech bubbles,
and HUD updates are paced correctly.

The pipeline processes one turn at a time, with a brief gap between turns to let
the user register transitions.

## Turn Interface

```typescript
interface Turn {
  id: number                        // Auto-incrementing, used for stale callback guards
  agentId: string                   // Which agent this turn belongs to
  agentName: string                 // Display name
  round: number                     // Game round number
  actionType: string                // e.g. 'gather', 'talk', 'meeting_speech'
  targetAgentId?: string            // Target of social actions
  targetLocation?: string           // Where to move
  thought?: string                  // Text for ConversationBubble
  thoughtSource?: AgentSpeechSource // 'inner_thought' | 'dialogue'
  fromSpeakEvent?: boolean          // Skip addConversation if speech already tracked
}
```

## Phase State Machine

```
              +---> thinking ---> moving ---> acting ---> completeTurnPhase
              |         |            |           |              |
  enqueue --> processNext           |           |         [has thought?]
              |         |           |           |          /         \
              |    [no thought?]    |           |        yes          no
              |         |           |           |         |            |
              |         +-----------+-----------+     finishTurn   hud-only
              |                                           |            |
              |                                      scheduleNext  finishTurn
              |                                           |            |
              +---<--- [400ms gap if queue] ---<----------+----<-------+
              |
        [queue empty?] ---> drained callbacks ---> idle
```

### Phase Definitions

| Phase | Description | Duration |
|-------|-------------|----------|
| `idle` | No active turn, pipeline at rest | -- |
| `thinking` | ConversationBubble visible, waiting for dismiss/audio | Up to 15s (AUDIO_MAX_TIMEOUT_MS) |
| `moving` | Agent sprite walking to target location | Pathfinding-dependent |
| `acting` | Sprite animation playing + floor timer | min(animation, 1500ms) both must complete |
| `hud-only` | HUD status shown for actions without speech | 1500ms (HUD_ONLY_DURATION_MS) |

### Phase Transitions

```
idle
  |
  v
thinking (if turn.thought exists)
  |  Triggers: onBubbleDismissed(turnId), notifyAudioComplete(turnId), or 15s timeout
  v
moving (if targetLocation differs from current)
  |  Triggers: move handler callback
  |  Skipped if: already at location, no targetLocation, or SPEECH_ONLY action
  v
acting (if animation exists and action not in SKIP_ACTION_PHASE)
  |  Triggers: BOTH animation callback AND 1500ms floor timer
  |  Skipped if: no animation, action in SKIP_ACTION_PHASE, or SPEECH_ONLY action
  v
completeTurnPhase
  |  If turn has thought: finishTurn (bubble already shown, skip hud-only)
  |  If no thought: hud-only phase for 1500ms, then finishTurn
  v
finishTurn
  |  Sets agent to 'idle' status
  |  Calls scheduleNext
  v
scheduleNext
  |  If queue empty: processNext immediately (fires drained callbacks)
  |  If queue has items: 400ms gap, then processNext
```

## Action Category Sets

Three sets in `src/config/action-categories.ts` control pipeline behavior:

### SPEECH_ONLY_ACTIONS

```typescript
const SPEECH_ONLY_ACTIONS = new Set(['meeting_speech', 'meeting_vote'])
```

These actions skip both movement and acting phases entirely. After thinking
(ConversationBubble), they go directly to `completeTurnPhase`. This is because
meeting actions happen at fixed seat positions, not on the world grid.

### SKIP_ACTION_PHASE

```typescript
const SKIP_ACTION_PHASE = new Set(['move', 'rest', 'explore'])
```

These skip the acting phase (animation is redundant with idle/movement).

### SPOKEN_ACTIONS

```typescript
const SPOKEN_ACTIONS = new Set([
  'talk', 'argue', 'accuse', 'threaten', 'rally', 'monologue',
  'meeting_speech', 'meeting_vote',
])
```

Determines ConversationBubble variant:
- In set: `variant='dialogue'` (white, quotes, triangular tail)
- Not in set: `variant='thought'` (blue, italic, circular dots tail, floating drift)

## Turn ID and Stale Callback Guards

Each turn gets a unique auto-incrementing `id`. This ID is passed through all
async callbacks to prevent stale completions from advancing the wrong turn.

### Guard Locations

**completeThoughtPhase** (3 guards):
```typescript
function completeThoughtPhase(turnId?: number) {
  if (!activeTurn.value) return                    // Guard 1: no active turn
  if (phase.value !== 'thinking') return           // Guard 2: wrong phase
  if (turnId != null && turn.id !== turnId) return // Guard 3: stale turnId
  // ... proceed
}
```

**Movement callback**:
```typescript
handlers.move(agentId, location, () => {
  if (activeTurn.value?.id !== turnId) return  // Stale check
  startActionPhase()
})
```

**Action callback** (dual gate):
```typescript
handlers.playAction(agentId, animation, () => {
  if (activeTurn.value?.id !== turnId) return  // Stale animation
  animDone = true
  proceed()
})

// Plus floor timer also checks:
if (activeTurn.value?.id !== turnId) return    // Stale floor timer
```

### Why This Matters

Without turnId guards, rapid WebSocket events could cause:
- `notifyAudioComplete` for turn 1 arriving after turn 2 has already started
- Movement callbacks from turn 1 firing during turn 2
- Double-advancement when both `audioEnd` and `dismiss` fire for the same bubble

## Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `TURN_GAP_MS` | 400ms | Pause between turns so transitions don't overlap |
| `HUD_ONLY_DURATION_MS` | 1500ms | How long HUD status shows for non-speech turns |
| `MIN_ACTION_DURATION_MS` | 1500ms | Minimum time acting phase is visible |
| `AUDIO_MAX_TIMEOUT_MS` | 15000ms | Force-advance thinking if no audio/dismiss |

## Handlers (Bridge to PixiJS)

The turn store uses injected handlers to bridge Vue state with PixiJS rendering.
`SimulationView` sets these via `setHandlers()`:

```typescript
interface TurnHandlers {
  move: (agentId, location, onComplete) => void    // Pathfinding + sprite walk
  playAction: (agentId, animName, onComplete) => void  // Sprite animation
  updateAgent: (agentId, status, location?) => void    // Agent status in agentStore
  addConversation: (agentId, name, msg, source, round) => void  // Social store row
  getAgentLocation: (agentId) => string | undefined    // Current agent tile
}
```

### addConversation Behavior

When a turn enters thinking phase with `turn.thought`:
- If `fromSpeakEvent` is false: calls `addConversation` to create a conversation row
- If `fromSpeakEvent` is true: skips (the `agent_speak` WebSocket event already added it)

The `thoughtSource` field (`'inner_thought'` or `'dialogue'`) determines how the
conversation row is categorized and matched for audio playback.

## Computed Properties

| Property | Type | Description |
|----------|------|-------------|
| `activeTurn` | `Turn \| null` | Currently processing turn |
| `phase` | `TurnPhase` | Current pipeline phase |
| `queue` | `Turn[]` | Remaining turns waiting to process |
| `isProcessing` | `boolean` | True if `activeTurn` is set or queue has items |
| `hasPendingTurns` | `boolean` | True if queue has items (important for meeting result guard) |

## Drained Callbacks

One-shot callbacks registered via `onDrained()` fire when the queue fully empties.
Used by meeting scene to know when all speeches/votes have been displayed.

```typescript
store.onDrained(() => {
  // Safe to advance to result phase
})
```

Callbacks are cleared after firing -- they do not re-fire on subsequent drains.

## Example Flows

### Meeting Speech Turn

```
1. socialStore.onMeetingSpeech() receives WebSocket event
2. Buffers speech in meeting.speeches
3. Enqueues turn: { actionType: 'meeting_speech', thought: speechText, thoughtSource: 'dialogue' }
4. processNext() shifts turn from queue, sets as activeTurn
5. turn.thought exists -> startThoughtPhase()
6. phase = 'thinking', bubble appears, agent status = 'thinking'
7. Bubble dismissed (text timeout or audio end) -> completeThoughtPhase(turnId)
8. Guards pass -> startMovementPhase()
9. SPEECH_ONLY_ACTIONS.has('meeting_speech') -> completeTurnPhase()
10. turn.thought exists -> finishTurn()
11. Agent status = 'idle', scheduleNext()
12. Queue has items? 400ms gap then processNext. Empty? Drain immediately.
```

### Regular Gather Action Turn

```
1. experiment store receives agent_action, enqueues turn
2. processNext() -> turn.thought exists -> startThoughtPhase()
3. phase = 'thinking', thought bubble appears
4. Bubble dismissed -> completeThoughtPhase()
5. startMovementPhase() -> agent not at location -> phase = 'moving'
6. Pathfinding + sprite walk to target
7. Move complete -> startActionPhase() -> phase = 'acting'
8. Animation plays + 1500ms floor timer (both must complete)
9. Both done -> completeTurnPhase()
10. turn.thought exists -> finishTurn() -> scheduleNext()
```

### No-Thought Action Turn

```
1. Enqueued turn with no thought
2. processNext() -> no thought -> startMovementPhase() directly
3. Movement if needed -> startActionPhase()
4. Animation + floor timer -> completeTurnPhase()
5. No thought -> phase = 'hud-only' for 1500ms
6. finishTurn() -> scheduleNext()
```

## Key Files

| File | Purpose |
|------|---------|
| `src/stores/turn.ts` | Turn pipeline state machine |
| `src/config/action-categories.ts` | SPEECH_ONLY, SPOKEN, SKIP sets |
| `src/config/sprites/hd/animations.ts` | Action -> animation mapping |
| `src/views/SimulationView.vue` | Sets handlers, wires bubbles to turn events |
| `src/components/social/ConversationBubble.vue` | Speech/thought bubble display |
| `src/stores/social.ts` | Meeting handlers that enqueue meeting turns |
