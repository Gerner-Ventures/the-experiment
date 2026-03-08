---
title: "[P2] Ground shadows — building shadow projections for depth"
status: todo
priority: P2
tags: [stream-1, frontend, pixi, visual, isometric]
depends_on: [S1.3-isometric-world]
parent: isometric-aesthetics
---

# Ground Shadows

Add shadow projections beneath buildings to ground them in the scene and add depth perception. Each theme has a distinct shadow style matching its lighting.

## Per-Theme Treatment

| Theme | Shadow Style |
|---|---|
| Castaway Island | Warm soft shadow (dark green-brown, 15-20% opacity, blurred offset SE) |
| The Construct | Green-tinted glow halo beneath structures (inverted shadow — light underneath, 10% opacity) |
| The Arena | Sharp-edged sandy shadow (dark tan, 20-25% opacity, short offset — harsh overhead sun) |
| Sector 7G | Dark industrial shadow (near-black, 25-30% opacity, long offset — low artificial light) |

## Implementation

- Draw shadow polygons on a dedicated shadow layer (z=2, between ground and buildings)
- Shadow shape = building footprint projected with theme-specific offset and skew
- Single Graphics object for all shadows (batch draw)
- Shadow config (offset, opacity, color) defined in `map-themes.ts`

## Acceptance Criteria

- [ ] Buildings cast visible ground shadows on adjacent tiles
- [ ] Shadow direction and style match theme lighting (warm/green/harsh/dim)
- [ ] Shadow opacity is subtle (not distracting from gameplay)
- [ ] Shadows don't render on top of other buildings
- [ ] Shadow layer renders between ground and building layers

## Key Files

- `frontend/src/components/world/pixi/IsometricMap.ts`
- `frontend/src/config/map-themes.ts`
- `frontend/src/types/world.ts`
