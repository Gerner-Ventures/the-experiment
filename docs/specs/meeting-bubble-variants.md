---
title: "Meeting Bubble Variants"
type: spec
status: draft
owner: ""
team: frontend
review_status: draft
tags: [meeting, ui, bubble, conversation]
depends_on: []
created: "2026-03-09"
updated: "2026-03-09"
---

# Meeting Bubble Variants

## 1. Background

The meeting scene renders conversation bubbles for agent speeches, votes, and
(planned) inner deliberation. The current implementation has inconsistencies in
how bubble variants (thought vs dialogue) are chosen:

- Meeting speeches (`meeting_speech`) should render as **dialogue** ("SAYS") —
  agents are speaking aloud to the group.
- Meeting votes (`meeting_vote`) should render as **dialogue** — agents are
  announcing their vote publicly.
- A planned `meeting_thoughts` action type would represent inner deliberation
  during meetings — these should render as **thought** bubbles with a distinct
  visual (floating drift, muted color).
- World-view bubbles (outside meetings) always render as **thought** — the
  `thoughtSource` field drives TTS voice selection, not visual style.

The `MeetingScene` component uses `activeTurnIsSpoken` to determine variant,
which checks against `SPOKEN_ACTIONS`. This works for speech/vote but does not
yet account for inner thoughts during meetings.

## 2. Requirements

### 2.1 Variant Selection Rules

- [ ] `meeting_speech` turns render with `variant="dialogue"` (speech bubble, "SAYS" label)
- [ ] `meeting_vote` turns render with `variant="dialogue"` (speech bubble, "SAYS" label)
- [ ] `meeting_thoughts` turns render with `variant="thought"` (cloud bubble, "THOUGHT" label)
- [ ] World-view bubbles always render with `variant="thought"` regardless of `thoughtSource`
- [ ] `thoughtSource` field is used only for TTS voice selection, never for visual variant

### 2.2 Meeting Thoughts Action Type

- [ ] Backend emits `meeting_thoughts` WS message with `{ agent_id, content, stance? }`
- [ ] `meeting_thoughts` is added to `WSMessageType` union
- [ ] `social.ts` handles `onMeetingThoughts` — enqueues turn with `thoughtSource: 'inner_thought'`
- [ ] `meeting_thoughts` is NOT in `SPOKEN_ACTIONS` set (ensures thought variant in MeetingScene)
- [ ] `meeting_thoughts` IS in `SPEECH_ONLY_ACTIONS` set (skips movement/acting phases)

### 2.3 Thought Bubble Visual Treatment

- [ ] Thought bubbles in meeting scene use muted/translucent styling distinct from dialogue
- [ ] Thought bubble has subtle floating drift animation (CSS or GSAP)
- [ ] Thinking agent seat shows a thinking indicator (ellipsis or subtle pulse)
- [ ] Multiple thoughts can appear in sequence without jarring transitions

### 2.4 Turn Pipeline Integration

- [ ] `meeting_thoughts` turns process through the same thinking→speech-only-skip pipeline as speech/vote
- [ ] `hasPendingTurns` guard correctly accounts for queued thought turns
- [ ] Phase transitions (speeches→voting) are not triggered by thought turns

### 2.5 Meeting Pacing

- [ ] Reduce bubble auto-dismiss debounce in meeting view for snappier pacing between speakers
- [ ] `TURN_GAP_MS` may need a meeting-specific override (shorter gap during rapid speech/vote sequences)

## 3. Design

### Variant Decision Tree

```
Is meeting active?
├── Yes (MeetingScene renders bubble)
│   ├── actionType in SPOKEN_ACTIONS? → variant="dialogue"
│   └── else → variant="thought"
└── No (SimulationView renders bubble)
    └── Always variant="thought"
```

### New WS Message

```typescript
interface MeetingThoughtsData {
  agent_id: string
  agent_name?: string
  content: string
  stance?: string  // optional internal stance before speaking
}
```

### Turn Enqueue (social.ts)

```typescript
function onMeetingThoughts(msg: WSMessage<MeetingThoughtsData>) {
  const data = msg.data
  useTurnStore().enqueue({
    agentId: data.agent_id,
    agentName: data.agent_name ?? data.agent_id,
    round: msg.round,
    actionType: 'meeting_thoughts',
    thought: data.content,
    thoughtSource: 'inner_thought',
    fromSpeakEvent: false,
  })
}
```

## 4. Rollout Plan

1. **Phase 1:** Fix variant selection (frontend-only, no backend changes)
   - Ensure SPOKEN_ACTIONS drives meeting bubble variant
   - Verify world-view always uses thought variant
2. **Phase 2:** Add `meeting_thoughts` backend event and frontend handler
3. **Phase 3:** Thought bubble visual polish (drift animation, thinking indicator)
