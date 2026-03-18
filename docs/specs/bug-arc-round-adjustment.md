---
title: "[P2] Bug: Arc timeline doesn't recalculate when round count changes"
status: in_progress
issue: 43
priority: P2
tags: [stream-1, frontend, bug, arc-timeline]
---

# Bug: Arc Timeline Round Adjustment

When users change the number of rounds in setup/admin, the narrative arc timeline should recalculate act boundaries. Currently hardcoded to fixed round count.

## Fix

- `ArcTimeline.vue` reads total rounds from `experimentStore.config.totalRounds`
- Recalculate act boundaries proportionally
- Default: Act 1 (25%), Act 2 (50%), Act 3 (25%)
- Watch for config changes and recompute

## Acceptance Criteria

- [ ] Arc recalculates when round count changes
- [ ] Act boundaries proportional to total rounds
- [ ] Works with default and custom arc structures
- [ ] No hardcoded round counts

## Key Files

`ArcTimeline.vue`, `experimentStore`
