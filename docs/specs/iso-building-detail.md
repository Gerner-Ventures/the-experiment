---
title: "[P2] Building depth & detail — wall texture, roof detail, accents"
status: todo
priority: P2
tags: [stream-1, frontend, pixi, visual, isometric, building-renderer]
depends_on: [S1.3-isometric-world]
parent: isometric-aesthetics
---

# Building Depth & Detail

Add architectural detail to procedural buildings to make them feel more substantial. Each theme's building style gets wall textures, roof detail, and at least one accent element.

## Per-Theme Treatment

| Theme | Wall Detail | Roof Detail | Accent |
|---|---|---|---|
| Castaway Island | Woven bamboo cross-hatch texture, rope lashings at joints | Layered palm leaf rows with overhang drip line | Smoke wisps from cooking fires (thin gray lines above roof) |
| The Construct | Scrolling data streams on walls (static rendered lines), glitch artifacts | Pulsing edge glow (brighter neon outline on top edges) | Floating data node dots near corners |
| The Arena | Horizontal stone block lines, chipped/cracked stone marks | Terracotta tile rows with ridge line | Torch sconce brackets on walls, draped fabric banners |
| Sector 7G | Exposed rebar lines, concrete pour seams | Corrugated metal ridges with rust streaks | Steam/smoke from vents, warning stripe accents |

## Implementation

- Extend each `draw*` method in `BuildingRenderer.ts` with detail passes
- Details drawn after base structure, before labels
- Use thin lines (1-2px) for texture patterns to keep pixel-art aesthetic

## Acceptance Criteria

- [ ] Each building style renders with visible wall texture detail
- [ ] Roof detail adds visual interest beyond flat color fill
- [ ] At least one animated or accent element per theme (smoke, glow, banners, steam)
- [ ] Town Hall buildings have extra detail (larger/more important structures)
- [ ] Building labels remain readable over detailed surfaces
- [ ] Detail scales appropriately at zoom levels 0.5x–2x

## Key Files

- `frontend/src/components/world/pixi/BuildingRenderer.ts`
