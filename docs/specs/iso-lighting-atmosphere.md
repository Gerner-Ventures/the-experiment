---
title: "[P2] Lighting & atmosphere — directional light, vignette overlays"
status: todo
priority: P2
tags: [stream-1, frontend, pixi, visual, isometric]
depends_on: [S1.3-isometric-world]
parent: isometric-aesthetics
---

# Improved Lighting & Atmosphere

Add directional light simulation to building faces and improve ambient depth with vignette overlays. Each theme has its own light direction and atmospheric treatment.

## Per-Theme Treatment

| Theme | Light Direction | Light Face | Dark Face | Atmosphere |
|---|---|---|---|---|
| Castaway Island | SE (tropical sun) | +10% brightness on south face | -10% on north face | Warm golden vignette at edges |
| The Construct | None (ambient glow) | Base color | Base color | Green radial gradient center glow |
| The Arena | Overhead (noon sun) | Top face +15% brighter | Side faces -5% darker | Dust haze gradient at horizon |
| Sector 7G | NW (low factory light) | +5% on west face | -15% on east face | Dark vignette, orange glow from below |

## Implementation

- Adjust existing face color calculations in `BuildingRenderer.ts` with directional multipliers
- Add subtle vignette overlay in `AmbientOverlay.ts` (radial gradient, 5-10% opacity)
- Light direction defined per theme in `map-themes.ts` config

## Acceptance Criteria

- [ ] Building faces show visible brightness difference based on theme light direction
- [ ] The Construct maintains flat ambient lighting (no directional bias)
- [ ] Atmospheric vignette/gradient adds depth without obscuring gameplay
- [ ] Light direction config is defined in `map-themes.ts` (not hardcoded in renderer)
- [ ] Visual result is subtle — enhances depth, doesn't dominate

## Key Files

- `frontend/src/components/world/pixi/BuildingRenderer.ts`
- `frontend/src/components/world/pixi/AmbientOverlay.ts`
- `frontend/src/config/map-themes.ts`
