---
title: "[P2] Terrain texture & variation — per-tile detail across themes"
status: todo
priority: P2
tags: [stream-1, frontend, pixi, visual, isometric]
depends_on: [S1.3-isometric-world]
parent: isometric-aesthetics
---

# Terrain Texture & Variation

Replace flat single-color tile fills with subtle per-tile variation to break visual monotony. Each theme gets distinct terrain detail that reinforces its world identity.

## Per-Theme Treatment

| Theme | Grass | Path | Field |
|---|---|---|---|
| Castaway Island | Random grass tufts (darker green lines), scattered fallen leaves | Sand grain dots, footprint impressions | Crop row lines with alternating shade bands |
| The Construct | Faint sub-grid lines, occasional pixel noise clusters | Data fragment glyphs, hex patterns | Binary digit scatter, dim green pulse dots |
| The Arena | Dry earth cracks, small scattered stones | Worn flagstone joints, sand drifts | Sparse dried grass patches, plow furrows |
| Sector 7G | Oil stain blotches, rust-colored patches | Concrete expansion seams, drain grates | Industrial residue, chemical discoloration |

## Implementation

- Add a `drawTileDetail(tile, theme)` pass in `IsometricMap.ts` after base tile fill
- Use seeded random (based on tile x,y) for deterministic placement
- Draw 2-5 small detail elements per tile using Graphics lines, dots, and small polygons
- Cache in a single Graphics object per ground layer (not per-tile)

## Acceptance Criteria

- [ ] Each tile type (grass, path, field) renders with 2+ subtle detail variations
- [ ] Details are theme-specific (visually distinct across all 4 themes)
- [ ] Tile details are deterministic (same every load for same tile position)
- [ ] No perceptible frame drop on 20x20 grid (< 2ms added to initial render)
- [ ] Fence tiles remain visually clean (border markers, no clutter)

## Key Files

- `frontend/src/components/world/pixi/IsometricMap.ts`
- `frontend/src/config/map-themes.ts`
