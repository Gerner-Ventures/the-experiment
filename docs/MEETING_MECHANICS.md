# Meeting Mechanics

How town meetings work across the backend event pipeline, frontend state machine,
and visual presentation layer.

## Overview

Town meetings are a core social mechanic where agents collectively debate proposals
and vote on outcomes. Meetings can result in rule changes, resource allocation
decisions, or exile votes. The system spans:

- **Backend**: Generates proposal, orchestrates speech/vote rounds, produces results
- **WebSocket**: Streams `meeting_start`, `meeting_speech`, `meeting_vote`, `meeting_result` events
- **Frontend stores**: `socialStore` tracks meeting state, `turnStore` queues speeches/votes as turns
- **Frontend UI**: `MeetingScene` overlay with GSAP animations, themed backdrops, agent seats

## Message Sequence

```
Backend                    WebSocket              Frontend
  |                           |                       |
  |-- meeting_start --------->|--- meeting_start ---->| socialStore.onMeetingStart()
  |                           |                       |   -> meeting state initialized
  |                           |                       |   -> MeetingScene mounts
  |                           |                       |   -> GSAP entrance plays
  |                           |                       |
  |-- meeting_speech (x N) -->|--- meeting_speech --->| socialStore.onMeetingSpeech()
  |                           |                       |   -> speech buffered in meeting.speeches
  |                           |                       |   -> turn enqueued in turnStore
  |                           |                       |   -> turn processes: thinking phase
  |                           |                       |   -> ConversationBubble shown
  |                           |                       |   -> SPEECH_ONLY skips move/act
  |                           |                       |
  |-- meeting_vote (x N) --->|--- meeting_vote ------>| socialStore.onMeetingVote()
  |                           |                       |   -> vote recorded in meeting.votes
  |                           |                       |   -> turn enqueued in turnStore
  |                           |                       |   -> vote badge revealed on seat
  |                           |                       |
  |-- meeting_result -------->|--- meeting_result --->| socialStore.onMeetingResult()
  |                           |                       |   -> result/tally/passed stored
  |                           |                       |   -> MeetingScene waits for queue drain
  |                           |                       |   -> then advances to result phase
  |                           |                       |
  |-- exile_vote (optional) ->|--- exile_vote ------->| socialStore.onExileVote()
  |-- exile_result (optional) |--- exile_result ----->| socialStore.onExileResult()
  |                           |                       |   -> exile animation plays
  |                           |                       |   -> scene exits
```

## Frontend State Machine

### MeetingState (`socialStore.meeting`)

```typescript
interface MeetingState {
  proposal: string                          // The motion being debated
  votes: Record<string, string>             // agentId -> 'support' | 'oppose' | 'abstain'
  speeches: MeetingSpeech[]                 // Buffered speeches for panel display
  result: string | null                     // Summary text from backend
  tally: Record<string, number> | null      // Vote counts: { support: N, oppose: N }
  passed: boolean | null                    // Whether the proposal passed
  active: boolean                           // true until dismissMeeting() called
  scenePhase: MeetingScenePhase             // Current visual phase
  exileTarget: string | null                // Agent being exiled (if any)
  exileOutcome: string | null               // 'exiled' | 'spared'
}
```

### Scene Phase Progression

```
entering --> proposal --> speeches --> voting --> result --> exile --> exiting
   |             |            |           |          |         |         |
   GSAP      entrance     first       first      queue      exile    GSAP
  entrance   complete    speech      vote       drained    anim     exit
   plays       fires      turn       turn       + result   plays    plays
```

**Phase transitions are owned by MeetingScene**, not the social store.
The store provides `advanceMeetingPhase()` but the scene decides when to call it.

| From | To | Trigger |
|------|----|---------|
| `entering` | `proposal` | GSAP entrance timeline completes |
| `proposal` | `speeches` | First `meeting_speech` turn starts processing |
| `speeches` | `voting` | First `meeting_vote` turn starts processing |
| `voting` | `result` | Turn queue fully drained AND `meeting.result` is set |
| `result` | `exile` | `onExileResult` with `exiled_agent_id` present |
| any | `exiting` | `closeMeetingScene()` called |

### Critical Guard: hasPendingTurns

The transition to `result` phase requires checking `hasPendingTurns` because
`activeTurn` can be momentarily `null` during the 400ms gap between turns
(`TURN_GAP_MS`). Without this guard, the result watcher would fire prematurely
and skip remaining speech/vote turns.

```typescript
// In MeetingScene.vue — both watchers use this guard
if (turn === null && !props.hasPendingTurns && props.meeting.result) {
  advancePhase('result')
}
```

## Turn Queue Integration

Meeting speeches and votes flow through the same turn pipeline as regular agent
actions, but with special handling:

### SPEECH_ONLY_ACTIONS

`meeting_speech` and `meeting_vote` are in the `SPEECH_ONLY_ACTIONS` set
(`src/config/action-categories.ts`). This means they:

1. Enter the thinking phase normally (show ConversationBubble)
2. Skip the movement phase entirely (agents don't walk during meetings)
3. Skip the acting phase entirely (no sprite animation beyond talk cycle)
4. Go directly to `finishTurn` after thought completes

### SPOKEN_ACTIONS

`meeting_speech` and `meeting_vote` are in the `SPOKEN_ACTIONS` set. This
determines the ConversationBubble variant:

- **SPOKEN** (`meeting_speech`, `meeting_vote`): `variant='dialogue'` -- white border,
  quoted text, triangular tail pointer
- **NON-SPOKEN** (future `meeting_thoughts`): `variant='thought'` -- blue tint,
  italic text, circular dots tail, floating drift animation

### Turn Enqueue Fields

When `socialStore.onMeetingSpeech()` enqueues a turn:

```typescript
useTurnStore().enqueue({
  agentId: data.agent_id,
  agentName: data.agent_name ?? data.agent_id,
  round: msg.round,
  actionType: 'meeting_speech',
  thought: speechText,                    // The speech content (shown in bubble)
  thoughtSource: 'dialogue',              // Always dialogue for meetings
  fromSpeakEvent: false,                  // Turn pipeline adds conversation row
})
```

### Speech Text Fallback Chain

When `content` is empty, the system falls back to stance descriptions:

```
content -> text (legacy) -> stance label -> 'I abstain.'
```

Stance labels come from `locale.social.meetingScene.stanceSupport/stanceOppose/stanceAbstain`.

## Visual Components

### MeetingScene (`src/components/social/MeetingScene.vue`)

The full-screen overlay that manages the meeting experience:

- **Backdrop**: Themed gradient background (beach, matrix, arena, sector)
- **Seats**: Semicircle of `MeetingAgentSeat` components positioned via trigonometry
- **Proposal**: `MeetingProposal` banner pinned to upper area
- **Bubble**: `ConversationBubble` anchored to the speaking agent's seat position
- **Tally**: `MeetingVoteTally` shown in result phase at bottom

### MeetingAgentSeat (`src/components/social/MeetingAgentSeat.vue`)

Each agent's seat in the semicircle:

| State | Visual |
|-------|--------|
| Idle | HD sprite in idle pose |
| Speaking (`isSpeaking`) | Talk pose cycle (200ms), accent glow ring, animate-pulse |
| Thinking (`isThinking`) | Think pose, indigo glow ring, think-bob CSS animation |
| Vote revealed | Tag badge (green=support, red=oppose) with pop-in transition |
| Exile flashing | 3x brightness flash animation (150ms each) |
| Exile dead | Grayscale filter, dead pose |
| Exile faded | Scale to 0 + opacity 0, 800ms transition |

Speaking vs thinking is determined by `SPOKEN_ACTIONS`:

```typescript
// MeetingScene.vue
const speakingAgentId = computed(() => {
  if (turnPhase === 'thinking' && activeTurn && SPOKEN_ACTIONS.has(activeTurn.actionType))
    return activeTurn.agentId
  return null
})

const thinkingAgentId = computed(() => {
  if (turnPhase === 'thinking' && activeTurn && !SPOKEN_ACTIONS.has(activeTurn.actionType))
    return activeTurn.agentId
  return null
})
```

### Vote Badge Progressive Reveal

All votes arrive from the backend at once in `meeting_result`, but the UI reveals
them one at a time as each agent's `meeting_vote` turn processes:

```typescript
const revealedVoteAgentIds = ref<Set<string>>(new Set())

watch(() => props.activeTurn, (turn) => {
  if (turn?.actionType === 'meeting_vote') {
    revealedVoteAgentIds.value.add(turn.agentId)
  }
})
```

## Meeting Themes

Four themed backdrops defined in `src/config/meeting-themes.ts`:

| Theme ID | Name | Inspiration |
|----------|------|-------------|
| `beach` | The Conch | Lord of the Flies |
| `matrix` | The Construct | The Matrix |
| `arena` | The Arena | Gladiator |
| `sector` | Sector 7G | 1984 |

Each theme provides:
- Phase-specific gradient backgrounds
- CSS scene class for scenery elements (rocks, grid lines, columns, barrels)
- Pseudo-element decorations (sand, smog, torch flicker, scanlines)

## GSAP Animations

### Entrance Timeline

1. Backdrop fades in (0.3s, power2.out)
2. Seats appear with stagger (0.3s each, 0.05s stagger, back.out)
3. Proposal banner appears (after seats + 0.5s)
4. `entranceComplete` flag set
5. Phase advances to `proposal`

### Exit Timeline

1. Scene container fades out (0.5s, power2.in)
2. `scene-exited` event emitted

### Exile Sequence

1. `flashing` (450ms) -- brightness flash 3x
2. `dead` (500ms) -- grayscale + dead pose
3. `faded` (800ms) -- scale to 0 + opacity 0
4. `exile-complete` event emitted

## Exile Integration

When `meeting_result` indicates an exile, `onExileResult` fires:

```typescript
function onExileResult(msg: WSMessage) {
  const data = msg.data
  exileEvents.value.push({ ...data, phase: 'result' })

  // Only transition to exile if someone was actually exiled
  if (meeting.value && data.exiled_agent_id) {
    meeting.value.exileTarget = data.exiled_agent_id
    meeting.value.exileOutcome = data.outcome ?? 'exiled'
    meeting.value.scenePhase = 'exile'
  }
}
```

If `exiled_agent_id` is not present (agent was spared), the scene stays in
`result` phase and the user can dismiss normally.

## Meeting Lifecycle Summary

1. **Backend** generates proposal and broadcasts `meeting_start`
2. **socialStore** initializes `MeetingState`, `MeetingScene` mounts
3. **GSAP entrance** plays, phase advances to `proposal`
4. **Backend** broadcasts `meeting_speech` events (one per speaking agent)
5. **socialStore** buffers speech + enqueues turn; scene phase advances to `speeches`
6. **Turn pipeline** processes each speech: thinking phase -> bubble -> SPEECH_ONLY skip -> finish
7. **Backend** broadcasts `meeting_vote` events; scene phase advances to `voting`
8. **Turn pipeline** processes each vote: thinking phase -> bubble -> finish; vote badges reveal
9. **Backend** broadcasts `meeting_result` with summary, tally, passed
10. **socialStore** stores result; scene waits for queue to drain, then advances to `result`
11. **MeetingVoteTally** shows with continue button
12. Optional: exile animation plays if `exiled_agent_id` present
13. Scene exits, `meeting.active` set to false via `dismissMeeting()`

## Key Files

| File | Purpose |
|------|---------|
| `src/stores/social.ts` | Meeting state, event handlers, phase management |
| `src/stores/turn.ts` | Turn queue that sequences speeches/votes |
| `src/config/action-categories.ts` | SPEECH_ONLY_ACTIONS, SPOKEN_ACTIONS sets |
| `src/config/meeting-themes.ts` | Themed backdrop definitions |
| `src/components/social/MeetingScene.vue` | Full-screen overlay, phase watchers, GSAP |
| `src/components/social/MeetingAgentSeat.vue` | Agent seat with speak/think/exile states |
| `src/components/social/MeetingProposal.vue` | Proposal text banner |
| `src/components/social/MeetingVoteTally.vue` | Vote results display |
| `src/components/social/ConversationBubble.vue` | Speech/thought bubble (shared) |
