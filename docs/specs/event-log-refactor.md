---
title: "Event Log Refactor — Readable Action Display"
status: todo
issue: 97
priority: P2
tags: [stream-1, frontend, enhancement, log, ux]
---

# Event Log Refactor — Readable Action Display

The event log displays raw event data that is not meaningful to players.

## Problem

Current log entries show raw field values with no formatting:

```
agent_action
R6
morning
agent_action
connected
R0
connected
```

Players cannot understand what happened during the simulation from these entries.

## Files

- `frontend/src/components/log/` — event log components
- `frontend/src/locales/en.ts` — human-readable event labels
- `frontend/src/types/websocket.ts` — event type definitions

---

## 1. Human-Readable Event Formatting
<!-- status: todo -->

Transform raw event data into readable log entries.

### Acceptance Criteria

- [ ] Agent actions display as readable sentences (e.g. "**Agent A** gathered food at the Farm")
- [ ] Each entry shows round number, phase, and agent name in a consistent format
- [ ] Action types have human-readable labels (not raw enum values)
- [ ] Locale strings added to `en.ts` for all event type labels

## 2. Round Grouping & Visual Hierarchy
<!-- status: todo -->

Group events by round with clear visual separation.

### Acceptance Criteria

- [ ] Events are grouped under round headers (e.g. "Round 6 — Morning")
- [ ] Round headers visually separate the timeline
- [ ] Connection/system events are visually distinct from gameplay events (muted styling or separate section)
- [ ] Most recent events appear at the top (reverse chronological within view)

## 3. Event Type Icons & Styling
<!-- status: todo -->

Add visual indicators for different event types.

### Acceptance Criteria

- [ ] Each event type has an appropriate icon or color indicator
- [ ] Crisis events are visually prominent (match threat color scheme)
- [ ] Social events (conversations, meetings) are visually distinct from action events
- [ ] System events (connected, round start) are de-emphasized
