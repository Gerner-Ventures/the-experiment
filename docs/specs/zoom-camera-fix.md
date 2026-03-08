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

- [x] Zoom factor per scroll tick is reduced (3% per tick with normalization)
- [x] Zoom has min/max bounds (0.3–3.0)
- [x] Zoom feels smooth and controllable with both scroll wheel and trackpad pinch
<!-- canon:realized-in:PR#112 file:frontend/src/components/world/pixi/CameraController.ts -->
- [x] Lerp/ease zoom transitions for smoother visual feedback (0.15 lerp speed)

## 2. Center Camera on Map at Startup
<!-- status: todo -->

Calculate map bounds and center the camera on initialization.

### Acceptance Criteria

- [x] Camera initializes centered on the isometric map bounds
- [x] Centering accounts for the HUD overlay areas (doesn't center on the raw viewport)
- [x] Works correctly regardless of window size
- [x] Camera remains centered after window resize events
