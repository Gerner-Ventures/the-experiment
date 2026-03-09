---
title: "Event Log Refactor — Readable Action Display"
status: done
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
<!-- status: done -->

Transform raw event data into readable log entries.

### Acceptance Criteria

- [x] Agent actions display as readable sentences (e.g. "Alice gathered at farm")
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue func:formatEventHeadline -->
- [x] Each entry shows round number, phase, and agent name in a consistent format
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue template:event-header-content -->
- [x] Action types have human-readable labels (not raw enum values)
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue func:actionLabel -->
- [x] Locale strings added to `en.ts` for all event type labels
<!-- canon:realized-in: file:frontend/src/locales/en.ts section:eventTypes -->

## 2. Round Grouping & Visual Hierarchy
<!-- status: done -->

Group events by round with clear visual separation.

### Acceptance Criteria

- [x] Events are grouped under round headers (e.g. "Round 6 — Morning")
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue computed:groupedEvents -->
- [x] Round headers visually separate the timeline
- [x] Connection/system events are visually distinct from gameplay events (muted styling or separate section)
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue func:typeColor (system=default, round=gold) -->
- [x] Most recent events appear at the top (reverse chronological within view)

## 3. Event Type Icons & Styling
<!-- status: done -->

Add visual indicators for different event types.

### Acceptance Criteria

- [x] Each event type has an appropriate icon or color indicator
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue func:typeColor -->
- [x] Crisis events are visually prominent (match threat color scheme)
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue func:typeColor (crisis_event=red) -->
- [x] Social events (conversations, meetings) are visually distinct from action events
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue func:typeColor (social=cyan, agent=blue) -->
- [x] System events (connected, round start) are de-emphasized
<!-- canon:realized-in: file:frontend/src/components/log/ExperimentLog.vue func:typeColor (system=default) -->
