---
title: "Step error UX — surface failures to user"
status: todo
issue: 91
priority: P2
tags: [frontend, ux, error-handling]
---

# Step Error UX

## Problem

When a round fails on the backend, the `step_error` WS message clears the stepping spinner but provides no feedback to the user. The UI silently transitions from "stepping..." to idle with no indication that something went wrong. Users have no way to know whether the round failed, what went wrong, or what to do next.

## Solution

### 1. Display step error notification

When `step_error` is received, show an Ant Design notification or message with the error details from the WS payload.

```typescript
step_error: (m) => {
  useUIStore().clearStepping()
  const data = m.data as { error?: string }
  notification.error({
    message: 'Round failed',
    description: data.error || 'An error occurred during round execution.',
  })
}
```

### 2. Store last error in UI store

Add `lastStepError` ref to `uiStore` so components can react to it (e.g., show a retry button or error state in ControlBar).

### 3. Clean up debug logs before merge

Remove `console.debug` statements added for stepping UX investigation:
- `frontend/src/views/SimulationView.vue` lines 103-107 (`[Step]` logs)
- `frontend/src/composables/useWebSocket.ts` line 48 (`[WS]` log on every message)

These were intentionally added during PR #57 development and should be removed before merging to main.

## Acceptance Criteria

- [ ] User sees a notification when a round fails
- [ ] Error message from backend is displayed (not just generic text)
- [ ] Auto-play stops on step error
- [ ] Debug console.debug statements are removed
- [ ] ControlBar shows appropriate state after error (not stuck in stepping)
