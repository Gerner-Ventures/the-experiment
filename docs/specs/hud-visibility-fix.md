---
title: "HUD Controls Disappear on Pan/Refresh"
status: in_progress
issue: 96
priority: P1
tags: [stream-1, frontend, bugfix, hud, pixi]
---

# HUD Controls Disappear on Pan/Refresh

The play button and event log component intermittently disappear during normal use, requiring a full page refresh to recover.

## Problem

HUD overlay components (play/pause controls, event log) vanish when:
- Panning around the isometric board
- Refreshing the page

Once gone, only a hard refresh recovers them — and even that is inconsistent.

## Likely Causes

- HUD visibility may be bound to reactive state that gets cleared during PixiJS canvas interactions
- Component lifecycle issues during route remounting or hot reload
- z-index or pointer-events conflicts with the PixiJS canvas layer
- Pinia store state not surviving page refresh (missing persistence or initialization race)

## Files

- `frontend/src/views/SimulationView.vue` — simulation layout and HUD mounting
- `frontend/src/components/hud/` — HUD overlay components
- `frontend/src/stores/` — Pinia stores controlling HUD state

---

## 1. Diagnose Root Cause
<!-- status: todo -->

### Acceptance Criteria

- [ ] Identify the specific reactive state or lifecycle event that causes HUD disappearance
- [ ] Confirm whether the issue is CSS (z-index/visibility), Vue reactivity (conditional rendering), or store state

## 2. Fix HUD Persistence
<!-- status: todo -->

### Acceptance Criteria

- [x] HUD controls remain visible at all times during simulation regardless of camera state
<!-- canon:realized-in:PR#112 file:frontend/src/views/SimulationView.vue -->
<!-- canon:realized-in:PR#112 file:frontend/src/components/world/PixiWorld.vue -->
- [x] HUD survives page refresh without requiring multiple reloads
- [x] HUD does not flicker or briefly disappear during pan/zoom interactions
- [x] PixiJS canvas events do not interfere with HUD overlay pointer events
