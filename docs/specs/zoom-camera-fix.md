---
title: "Zoom Sensitivity & Camera Centering Fix"
status: todo
issue: 95
priority: P1
tags: [stream-1, frontend, bugfix, pixi, camera]
---

# Zoom Sensitivity & Camera Centering Fix

The isometric world camera has two usability issues: zoom is too sensitive and the initial camera position is off-center.

## Problem

1. **Zoom sensitivity** — Small scroll/pinch inputs cause violent zoom oscillation. Users cannot smoothly reach a comfortable zoom level.
2. **Initial camera position** — The camera starts slightly below the map center, requiring manual panning to see the full board.

## Files

- `frontend/src/composables/usePixiWorld.ts` — zoom/pan event handling
- `frontend/src/components/world/pixi/IsometricMap.ts` — map bounds calculation
- `frontend/src/components/world/PixiWorld.vue` — initialization and camera setup

---

## 1. Reduce Zoom Sensitivity
<!-- status: todo -->

Add zoom dampening so scroll inputs produce proportional, smooth zoom changes.

### Acceptance Criteria

- [ ] Zoom factor per scroll tick is reduced (e.g. 0.05 per tick instead of current value)
- [ ] Zoom has min/max bounds to prevent zooming too far in or out
- [ ] Zoom feels smooth and controllable with both scroll wheel and trackpad pinch
- [ ] Optional: lerp/ease zoom transitions for smoother visual feedback

## 2. Center Camera on Map at Startup
<!-- status: todo -->

Calculate map bounds and center the camera on initialization.

### Acceptance Criteria

- [ ] Camera initializes centered on the isometric map bounds
- [ ] Centering accounts for the HUD overlay areas (doesn't center on the raw viewport)
- [ ] Works correctly regardless of window size
- [ ] Camera remains centered after window resize events
