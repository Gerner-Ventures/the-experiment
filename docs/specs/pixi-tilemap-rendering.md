---
title: "[P2] Optimized tile rendering with @pixi/tilemap"
status: in_progress
priority: P2
tags: [stream-1, frontend, pixi, rendering, performance]
depends_on: [S1.3-isometric-world, isometric-aesthetics]
---

# Optimized Tile Rendering with @pixi/tilemap

## Background

The current `IsometricMap.ts` renders every tile as an individual `Graphics.poly()` + `fill()` call. On a 30×30 map, that's 900+ draw calls for the ground layer alone, plus decorations and buildings. This works fine at current scale but will become a bottleneck as we add tile detail (per the isometric-aesthetics spec) and support larger maps.

`@pixi/tilemap` v5 is compatible with our PixiJS 8.x stack and provides batch-optimized tile rendering — collapsing thousands of tiles into a small number of WebGL/WebGPU draw calls using texture atlases.

### Why now (trigger conditions)

This spec should be picked up when **any** of these become true:
- We begin adding tile art assets (replacing procedural colored diamonds)
- Map sizes exceed 40×40 tiles
- Profiling shows tile rendering as a bottleneck (>5ms per frame for ground layer)
- The isometric-aesthetics spec adds enough per-tile detail to strain the current approach

## 1. Install and integrate @pixi/tilemap v5
<!-- canon:system:1 status:done -->

Replace the procedural ground-layer rendering in `IsometricMap.ts` with `@pixi/tilemap`'s `CompositeTilemap`.

### Acceptance Criteria

- [x] `@pixi/tilemap` v5.x is added as a dependency
<!-- canon:realized-in:audit file:frontend/package.json -->
- [x] `CompositeTilemap` replaces the current `Graphics`-based ground tile loop in `IsometricMap.ts`
<!-- canon:realized-in:audit file:frontend/src/components/world/pixi/IsometricMap.ts:71-94 -->
- [x] Tile textures are loaded from a sprite sheet atlas (one per theme)
<!-- canon:realized-in:audit file:frontend/src/components/world/pixi/IsometricMap.ts:66 -->
- [x] Existing theme-specific tile coloring (grass, path, building, fence, field) is preserved via theme-specific tile atlas frames
<!-- canon:realized-in:audit file:frontend/src/components/world/pixi/IsometricMap.ts -->

## 2. Tile atlas pipeline

Create a build-time or runtime pipeline for generating tile sprite sheets.

### Acceptance Criteria

- [ ] Each theme has a tile atlas with frames for: grass, path, building footprint, fence, field, and 2-3 detail variants per type
- [ ] Atlas is loaded via PixiJS asset loader with proper cache keys
- [ ] Tile atlas supports the current 64×32 isometric diamond dimensions
- [ ] Atlas generation is documented (manual asset export or automated via @pixi/assetpack)

## 3. Layer separation

Maintain the current layered rendering approach but using tilemap layers.

### Acceptance Criteria

- [ ] Ground tiles render in a base `CompositeTilemap` layer
- [ ] Decoration tiles (trees, grid overlays) render in a separate layer above ground
- [ ] Building footprints integrate correctly with the tilemap z-ordering
- [ ] The existing z-index hierarchy (background → ground → decorations → buildings → agents → ambient) is preserved

## 4. Performance validation

### Acceptance Criteria

- [ ] Ground layer rendering is measurably faster than the current `Graphics` approach (target: <2ms for 30×30 map)
- [ ] GPU draw calls for the tile layer are reduced to ≤4 (one per tilemap layer)
- [ ] No visual regression — tiles render at correct isometric positions with correct theme colors
- [ ] Camera pan/zoom remains smooth at all zoom levels (0.3x–3x)

## 5. Coordinate system compatibility

### Acceptance Criteria

- [ ] `tileToScreen()` and `screenToTile()` in `isometric-utils.ts` continue to work correctly with tilemap-rendered tiles
- [ ] Click-to-tile detection remains accurate (for agent pathfinding, tile inspection)
- [ ] Agent sprites align correctly with tilemap tiles (anchor at bottom-center of tile diamond)

## Technical Design

### Current flow (to be replaced)
```
IsometricMap.drawGroundLayer()
  → for each tile in grid:
      → Graphics.poly(diamond vertices)
      → Graphics.fill(theme color)
```

### Proposed flow
```
IsometricMap.buildTilemap()
  → Create CompositeTilemap
  → Load theme tile atlas
  → for each tile in grid:
      → tilemap.tile(atlasFrame, screenX, screenY)
  → Add tilemap to map container at correct z-index
```

### Key files to modify
- `frontend/src/components/world/pixi/IsometricMap.ts` — replace ground rendering
- `frontend/src/composables/usePixiWorld.ts` — asset loading for tile atlases
- New: `frontend/src/assets/tiles/` — tile atlas sprite sheets per theme

### Dependencies
- `@pixi/tilemap` ^5.0.0 (PixiJS 8.x compatible)
- Tile art assets (can start with programmatically-generated atlas from current colors)

## Rollout

1. Add `@pixi/tilemap`, create a minimal atlas from current procedural colors (no art change)
2. Swap ground layer to `CompositeTilemap` behind a feature flag
3. Validate performance and visual parity
4. Remove old `Graphics`-based ground rendering
5. Future: replace procedural atlas with hand-crafted tile art
