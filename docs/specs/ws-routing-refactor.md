---
title: "Extract WS message routing for testability"
status: todo
issue: 92
priority: P3
tags: [frontend, refactor, testing]
---

# Extract WS Message Routing

## Problem

`routeMessage()` is defined as a private function inside `useWebSocket.ts` and cannot be imported by tests. The `ws-routing.spec.ts` test re-implements the routing logic verbatim, which means:
- Tests can silently drift from production code (already missing `step_error` handler)
- Changes to routing require updating two places
- No way to unit test routing in isolation

## Solution

### 1. Extract to standalone module

Move `routeMessage` into `src/composables/wsRouter.ts` (or similar) as a named export:

```typescript
// wsRouter.ts
export function routeMessage(msg: WSMessage): void {
  // ... existing routing logic
}
```

### 2. Import in both useWebSocket and tests

```typescript
// useWebSocket.ts
import { routeMessage } from './wsRouter'

// ws-routing.spec.ts
import { routeMessage } from '@/composables/wsRouter'
```

### 3. Update test

Remove the duplicated `routeMessage` implementation from the test file.

## Acceptance Criteria

- [ ] `routeMessage` is exported from a standalone module
- [ ] `useWebSocket.ts` imports and uses the extracted function
- [ ] `ws-routing.spec.ts` imports the real function instead of duplicating it
- [ ] All existing tests pass without modification to assertions
