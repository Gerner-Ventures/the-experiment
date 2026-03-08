---
title: "[P2] Tile edge blending — smooth transitions between tile types"
status: todo
priority: P2
tags: [stream-1, frontend, pixi, visual, isometric]
depends_on: [S1.3-isometric-world]
parent: isometric-aesthetics
---

# Tile Edge Blending

Soften hard boundaries between different tile types for more natural transitions. Each theme has a distinct blend style.

## Per-Theme Treatment

| Theme | Blend Style |
|---|---|
| Castaway Island | Organic — grass creeps onto path edges, sand gradient at beach boundary |
| The Construct | Digital — pixel dithering at boundaries, glitch transition |
| The Arena | Dusty — sand drift overlaps, scattered pebbles at edges |
| Sector 7G | Industrial — cracked concrete fading, rust bleed at seams |

## Implementation

- After drawing base tiles, run a border detection pass on adjacent tile type changes
- Draw small overlay elements along edges (4-8 small marks per edge)
- Use theme-specific edge treatment (organic scatter vs. pixel dither vs. dust vs. rust)
- Only blend grass↔path, grass↔field, path↔building edges (not fence — fence is intentionally hard-edged)

## Acceptance Criteria

- [ ] Visible soft transition between grass/path, grass/field, and path/building tiles
- [ ] Blend style matches theme aesthetic (organic, digital, dusty, industrial)
- [ ] Fence boundaries remain hard-edged (no blending)
- [ ] Edge blending doesn't break tile click detection or pathfinding
- [ ] Performance: edge pass adds < 1ms to initial render

## Key Files

- `frontend/src/components/world/pixi/IsometricMap.ts`
- `frontend/src/config/map-themes.ts`
