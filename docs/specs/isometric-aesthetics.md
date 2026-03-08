---
title: "[P2] Isometric map & building aesthetic improvements"
status: todo
priority: P2
tags: [stream-1, frontend, pixi, visual, isometric]
depends_on: [S1.3-isometric-world]
---

# Isometric Map & Building Aesthetic Improvements

The current procedural rendering uses flat-colored polygons with minimal detail. Buildings are basic geometric shapes, terrain is uniform per tile type, and there are no shadows or environmental props. This spec adds theme-specific visual depth to make each world feel richer and more immersive — all within PixiJS Graphics primitives (no external texture assets).

All improvements are **theme-aware**: each enhancement has a distinct visual treatment per theme (Castaway Island, The Construct, The Arena, Sector 7G).

## 1. Terrain Texture & Variation

Replace flat single-color tile fills with subtle per-tile variation to break visual monotony.

**Per-theme treatment:**

| Theme | Grass | Path | Field |
|---|---|---|---|
| Castaway Island | Random grass tufts (darker green lines), scattered fallen leaves | Sand grain dots, footprint impressions | Crop row lines with alternating shade bands |
| The Construct | Faint sub-grid lines, occasional pixel noise clusters | Data fragment glyphs, hex patterns | Binary digit scatter, dim green pulse dots |
| The Arena | Dry earth cracks, small scattered stones | Worn flagstone joints, sand drifts | Sparse dried grass patches, plow furrows |
| Sector 7G | Oil stain blotches, rust-colored patches | Concrete expansion seams, drain grates | Industrial residue, chemical discoloration |

**Implementation approach:**
- Add a `drawTileDetail(tile, theme)` pass in `IsometricMap.ts` after base tile fill
- Use seeded random (based on tile x,y) for deterministic placement
- Draw 2-5 small detail elements per tile using Graphics lines, dots, and small polygons
- Cache in a single Graphics object per ground layer (not per-tile)

### Acceptance Criteria

- [ ] Each tile type (grass, path, field) renders with 2+ subtle detail variations
- [ ] Details are theme-specific (visually distinct across all 4 themes)
- [ ] Tile details are deterministic (same every load for same tile position)
- [ ] No perceptible frame drop on 20x20 grid (< 2ms added to initial render)
- [ ] Fence tiles remain visually clean (border markers, no clutter)

## 2. Building Depth & Detail

Add architectural detail to procedural buildings to make them feel more substantial.

**Per-theme treatment:**

| Theme | Wall Detail | Roof Detail | Accent |
|---|---|---|---|
| Castaway Island | Woven bamboo cross-hatch texture, rope lashings at joints | Layered palm leaf rows with overhang drip line | Smoke wisps from cooking fires (thin gray lines above roof) |
| The Construct | Scrolling data streams on walls (static rendered lines), glitch artifacts | Pulsing edge glow (brighter neon outline on top edges) | Floating data node dots near corners |
| The Arena | Horizontal stone block lines, chipped/cracked stone marks | Terracotta tile rows with ridge line | Torch sconce brackets on walls, draped fabric banners |
| Sector 7G | Exposed rebar lines, concrete pour seams | Corrugated metal ridges with rust streaks | Steam/smoke from vents, warning stripe accents |

**Implementation approach:**
- Extend each `draw*` method in `BuildingRenderer.ts` with detail passes
- Details drawn after base structure, before labels
- Use thin lines (1-2px) for texture patterns to keep pixel-art aesthetic

### Acceptance Criteria

- [ ] Each building style renders with visible wall texture detail
- [ ] Roof detail adds visual interest beyond flat color fill
- [ ] At least one animated or accent element per theme (smoke, glow, banners, steam)
- [ ] Town Hall buildings have extra detail (larger/more important structures)
- [ ] Building labels remain readable over detailed surfaces
- [ ] Detail scales appropriately at zoom levels 0.5x–2x

## 3. Ground Shadows

Add shadow projections beneath buildings to ground them in the scene and add depth.

**Per-theme treatment:**

| Theme | Shadow Style |
|---|---|
| Castaway Island | Warm soft shadow (dark green-brown, 15-20% opacity, blurred offset SE) |
| The Construct | Green-tinted glow halo beneath structures (inverted shadow — light underneath, 10% opacity) |
| The Arena | Sharp-edged sandy shadow (dark tan, 20-25% opacity, short offset — harsh overhead sun) |
| Sector 7G | Dark industrial shadow (near-black, 25-30% opacity, long offset — low artificial light) |

**Implementation approach:**
- Draw shadow polygons on a dedicated shadow layer (z=2, between ground and buildings)
- Shadow shape = building footprint projected with theme-specific offset and skew
- Single Graphics object for all shadows (batch draw)

### Acceptance Criteria

- [ ] Buildings cast visible ground shadows on adjacent tiles
- [ ] Shadow direction and style match theme lighting (warm/green/harsh/dim)
- [ ] Shadow opacity is subtle (not distracting from gameplay)
- [ ] Shadows don't render on top of other buildings
- [ ] Shadow layer renders between ground and building layers

## 4. Environmental Props

Small decorative objects placed on non-building tiles to add life and break up empty space.

**Per-theme treatment:**

| Theme | Grass Props | Path Props | Field Props |
|---|---|---|---|
| Castaway Island | Small rocks, coconuts, tropical flowers, fallen palm fronds | Footprints, shell fragments, driftwood pieces | Harvest baskets, tool marks |
| The Construct | Floating code fragments (small text), data nodes (bright dots), glitch squares | Circuit trace lines, access points (blinking dots) | Data crystals, memory shards |
| The Arena | Loose stones, dried scrub bushes, clay pots/urns | Sand drifts, discarded weapon fragments | Hay bales, wooden training posts |
| Sector 7G | Rusted bolts, puddles (dark reflection), weeds through concrete | Manhole covers, cigarette butts, paper litter | Chemical drums, pipe segments |

**Implementation approach:**
- Add `drawEnvironmentProps(theme, tiles)` in `IsometricMap.ts`
- Props placed using seeded random per tile — ~30-40% of eligible tiles get a prop
- Each prop is 3-8px, drawn with Graphics primitives
- Props on decoration layer (z=5), rendered once at map load
- Props should not overlap with agent paths or building entrances

### Acceptance Criteria

- [ ] 30-40% of grass, path, and field tiles have a small decorative prop
- [ ] Props are theme-specific and visually coherent with palette
- [ ] Props are small enough not to obscure tile type or interfere with agents
- [ ] Prop placement is deterministic (seeded by tile position)
- [ ] Props render on decoration layer, below agents and buildings
- [ ] No props on fence or building tiles

## 5. Improved Lighting & Atmosphere

Add directional light simulation to building faces and improve ambient depth.

**Per-theme treatment:**

| Theme | Light Direction | Light Face | Dark Face | Atmosphere |
|---|---|---|---|---|
| Castaway Island | SE (tropical sun) | +10% brightness on south face | -10% on north face | Warm golden vignette at edges |
| The Construct | None (ambient glow) | Base color | Base color | Green radial gradient center glow |
| The Arena | Overhead (noon sun) | Top face +15% brighter | Side faces -5% darker | Dust haze gradient at horizon |
| Sector 7G | NW (low factory light) | +5% on west face | -15% on east face | Dark vignette, orange glow from below |

**Implementation approach:**
- Adjust existing face color calculations in `BuildingRenderer.ts` with directional multipliers
- Add subtle vignette overlay in `AmbientOverlay.ts` (radial gradient, 5-10% opacity)
- Light direction defined per theme in `map-themes.ts` config

### Acceptance Criteria

- [ ] Building faces show visible brightness difference based on theme light direction
- [ ] The Construct maintains flat ambient lighting (no directional bias)
- [ ] Atmospheric vignette/gradient adds depth without obscuring gameplay
- [ ] Light direction config is defined in `map-themes.ts` (not hardcoded in renderer)
- [ ] Visual result is subtle — enhances depth, doesn't dominate

## 6. Tile Edge Blending

Soften hard boundaries between different tile types for more natural transitions.

**Per-theme treatment:**

| Theme | Blend Style |
|---|---|
| Castaway Island | Organic — grass creeps onto path edges, sand gradient at beach boundary |
| The Construct | Digital — pixel dithering at boundaries, glitch transition |
| The Arena | Dusty — sand drift overlaps, scattered pebbles at edges |
| Sector 7G | Industrial — cracked concrete fading, rust bleed at seams |

**Implementation approach:**
- After drawing base tiles, run a border detection pass on adjacent tile type changes
- Draw small overlay elements along edges (4-8 small marks per edge)
- Use theme-specific edge treatment (organic scatter vs. pixel dither vs. dust vs. rust)
- Only blend grass↔path, grass↔field, path↔building edges (not fence — fence is intentionally hard-edged)

### Acceptance Criteria

- [ ] Visible soft transition between grass/path, grass/field, and path/building tiles
- [ ] Blend style matches theme aesthetic (organic, digital, dusty, industrial)
- [ ] Fence boundaries remain hard-edged (no blending)
- [ ] Edge blending doesn't break tile click detection or pathfinding
- [ ] Performance: edge pass adds < 1ms to initial render

## Key Files

| File | Changes |
|---|---|
| `frontend/src/components/world/pixi/IsometricMap.ts` | Tile detail, props, edge blending |
| `frontend/src/components/world/pixi/BuildingRenderer.ts` | Building detail, lighting |
| `frontend/src/components/world/pixi/AmbientOverlay.ts` | Vignette, atmosphere |
| `frontend/src/config/map-themes.ts` | Light direction, prop config, shadow config |
| `frontend/src/types/world.ts` | Extended MapTheme interface |

## Implementation Order

1. **Terrain texture** (Section 1) — biggest visual impact for least complexity
2. **Ground shadows** (Section 3) — immediate depth improvement
3. **Building detail** (Section 2) — extends existing per-style render methods
4. **Environmental props** (Section 4) — adds life to empty space
5. **Lighting & atmosphere** (Section 5) — polish layer
6. **Tile edge blending** (Section 6) — most complex, lowest priority

## Performance Budget

All improvements target:
- Initial render: < 50ms additional on 20×20 grid
- No per-frame cost (all static Graphics objects, drawn once at map load)
- Total additional Graphics objects: < 500 across entire map
- Memory: < 2MB additional GPU texture memory
