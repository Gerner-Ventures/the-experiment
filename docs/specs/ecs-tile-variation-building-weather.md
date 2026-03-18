---
title: "ECS Map Enhancement: Tile Variation, Building State, Weather"
type: spec
status: draft
owner: ""
team: "frontend"
review_status: draft
tags: [stream-1, frontend, pixi, ecs, visual, isometric]
depends_on: [bitecs-entity-component-system, pixi-tilemap-rendering]
created: "2026-03-13"
updated: "2026-03-13"
---

# ECS Map Enhancement: Tile Variation, Building State, Weather

## 1. Background

Phases 2-4 of the ECS-driven map enhancement plan. Builds on PR #201 which delivered Phase 0 (ECS restructure, fixed timestep, perf monitoring), Phase 1 (water tile entity system), and Phase 1.5 (tile scaling 64x32 to 128x64 with `S = TILE_W / 64` methodology).

The map now has animated water tiles and properly scaled isometric diamonds, but the ground is monotonous (one color per tile type), buildings are static (no mutable state), and weather is purely cosmetic. These three phases add visual variety, mutable building state via ECS dirty-flag pattern, and a weather system that feeds into Phase 5 hazard mechanics.

**Related issues:** #118 (terrain texture), #119 (building depth), #120 (ground shadows), #122 (lighting & atmosphere)

**Supersedes:** `isometric-aesthetics.md` (sections 1, 3, 5, 6), `pixi-tilemap-rendering.md` (sections 1-5)

## 2. Requirements

### Phase 2: Tile Variation + Ground Shadows

#### 2.1 Tile Variant Frames

Generate 3 atlas variants per base tile type in `buildThemeAtlas()`:

| Variant | Content |
|---------|---------|
| `{type}_0` | Base fill color (existing) |
| `{type}_1` | Alternate fill from palette entry [2] |
| `{type}_2` | Base fill + small theme-specific detail mark |

Detail marks per theme:
- **Castaway**: grass flower dots, path pebble marks
- **Matrix**: brightness flicker, occasional bright pixel
- **Arena**: sand color shifts, small stone marks
- **Sector 7G**: crack lines, rust stain dots

Selection via deterministic hash: `variant = (tile.x * 7 + tile.y * 13) % 3` in `resolveFrameKey()`.

##### Acceptance Criteria

- [ ] 3 variant frames generated per base tile type (grass, path, building, fence, field)
- [ ] Variant selection is deterministic — same (x,y) always produces same variant
- [ ] No two adjacent tiles visually identical (visual QA across all 4 themes)
- [ ] Atlas texture size scales correctly with variant count
- [ ] Unit test: `tile-atlas.spec.ts` validates variant frame generation

#### 2.2 Ground Shadows

Shadow layer (Container, zIndex=2) renders semi-transparent building shadow projections.

| Theme | Light Direction | Shadow Style |
|-------|----------------|-------------|
| Castaway Island | SE (0.3, 0.2) | Warm soft shadow, 15% opacity |
| Matrix | None | No shadows (ambient glow) |
| Arena | Overhead (0.0, 0.15) | Sharp-edged, 20% opacity |
| Sector 7G | NW (-0.25, 0.2) | Long dark shadow, 25% opacity |

##### Acceptance Criteria

- [ ] Buildings cast visible ground shadows on adjacent tiles
- [ ] Shadow direction and opacity match theme `lightDirection` config in `map-themes.ts`
- [ ] Matrix theme has no ground shadows (`lightDirection: null`)
- [ ] Shadow layer renders between ground and building layers (zIndex=2)
- [ ] Shadows don't render on top of other buildings

#### 2.3 Static Ground Cache

After tile variants are applied, call `cacheAsTexture()` on the ground CompositeTilemap layer.

##### Acceptance Criteria

- [ ] Ground layer cached as texture after variants applied
- [ ] Draw call count drops after caching (verify via `window.__devWorld.perf`)
- [ ] `window.__devWorld.toggleGroundCache()` toggles cache on/off without artifacts

### Phase 3: Building State + Visual Updates

#### 3.1 BuildingState Component

New component in `ecs/components/world.ts`:

```typescript
export const BuildingState = {
  locationIndex: [] as number[],
  condition: [] as number[],      // 0=ruined..100=pristine
  occupancy: [] as number[],
  lighting: [] as number[],       // 0=dark, 1=dim, 2=lit, 3=bright
  dirty: [] as number[],          // 1 = renderer needs redraw
}
```

##### Acceptance Criteria

- [ ] BuildingState defined in `components/world.ts` and registered in `world.ts`
- [ ] One ECS entity per building location, stored in `buildingEntityMap`
- [ ] Entities cleaned up in `destroy()` — no leaked entities

#### 3.2 BuildingVisual Overlay

Wraps existing `BuildingRenderer.render()` output with overlay layers:
- `windowOverlay` — mutable window lighting based on `lighting` + `occupancy`
- `damageOverlay` — crack/scorch marks based on `condition`

Requires extracting `computeWindowGrid()` as a pure function (seeded by location position) to replace `Math.random() > 0.3` window lighting.

##### Acceptance Criteria

- [ ] BuildingVisual wraps existing BuildingRenderer output without modifying base render
- [ ] `computeWindowGrid()` returns deterministic positions matching base render
- [ ] `updateLighting()` lights windows proportional to occupancy at correct alpha
- [ ] `updateCondition()` shows crack overlay at <50, scorch marks at <20

#### 3.3 Building Sync System

`buildingSyncSystem` — runs BEFORE renderSync, only processes dirty entities.

##### Acceptance Criteria

- [ ] System only processes entities with dirty=1 (unit test)
- [ ] Dirty flag cleared after sync (unit test)
- [ ] Non-dirty entities don't trigger bridge updates (unit test)
- [ ] `setPhase()` updates all building lighting and marks dirty
- [ ] `damageBuilding(locationId, amount)` API works
- [ ] `window.__devWorld.damageBuilding()` and `setBuildingLighting()` exposed

### Phase 4: Weather System

#### 4.1 WeatherData State Object

Plain object (not ECS entity) owned by `useGameWorld`:

```typescript
interface WeatherData {
  type: number        // WEATHER_TYPES enum
  intensity: number   // 0.0-1.0
  duration: number    // seconds remaining (0=indefinite)
  transition: number  // 0-1 blend progress
  prevType: number    // for crossfade
}
```

Types: CLEAR, CLOUDY, RAIN, STORM, FOG, DUST_STORM.

##### Acceptance Criteria

- [ ] WeatherData state object managed in `useGameWorld`
- [ ] `setWeather(type, intensity, duration)` public API works
- [ ] `window.__devWorld.setWeather()` and `WEATHER_TYPES` exposed

#### 4.2 Weather System Function

`weatherSystem(dt, weather)` — duration countdown, transition advancement, auto-revert to CLEAR.

##### Acceptance Criteria

- [ ] Duration countdown auto-reverts to CLEAR (unit test)
- [ ] Transition 0 to 1 over 2 seconds (unit test)
- [ ] Type change preserves prevType for crossfade (unit test)

#### 4.3 AmbientOverlay Weather Integration

Migrate particles to `ParticleContainer`. Add `reconfigure()` and `setIntensity()` for runtime changes.

Theme-specific weather config:
- **Castaway**: CLEAR, RAIN, STORM, FOG
- **Arena**: CLEAR, DUST_STORM, FOG
- **Matrix**: CLEAR, CLOUDY
- **Sector 7G**: CLEAR, RAIN, FOG, CLOUDY

##### Acceptance Criteria

- [ ] AmbientOverlay supports `reconfigure()` for runtime weather changes
- [ ] `setIntensity()` scales active particle count proportionally
- [ ] ParticleContainer used for weather particles (not Graphics)
- [ ] Storm darkens sky via day/night brightness modifier
- [ ] Weather config per theme in `map-themes.ts`

## 3. Design

### Key Files

| Phase | File | Changes |
|-------|------|---------|
| 2 | `tile-atlas.ts` | Variant frame generation |
| 2 | `IsometricMap.ts` | `resolveFrameKey()` variants, `renderShadows()`, `cacheAsTexture()` |
| 2 | `map-themes.ts` | `lightDirection` per theme |
| 3 | `ecs/components/world.ts` | BuildingState component |
| 3 | `BuildingVisual.ts` | Overlay-based mutable building (new) |
| 3 | `BuildingRenderer.ts` | Extract `computeWindowGrid()` |
| 3 | `buildingSyncSystem.ts` | Dirty-flag building sync (new) |
| 4 | `weatherSystem.ts` | Weather state update (new) |
| 4 | `AmbientOverlay.ts` | `reconfigure()`, `setIntensity()`, ParticleContainer |
| 4 | `useGameWorld.ts` | weatherState, weatherSystem in tick, setWeather API |

### Performance Budget

| Metric | Budget | Phase |
|--------|--------|-------|
| Tile variant render | < 2ms added to initial render | 2 |
| Ground cache draw calls | <= 1 (cached texture) | 2 |
| Building dirty-flag updates | 0 calls when no state changes | 3 |
| AmbientOverlay reconfigure | < 5ms (only on type change) | 4 |
| p99 frame time | < 8ms (maintained from Phase 0) | All |

### Architecture Decisions

- **BuildingVisual wraps, doesn't replace**: Existing 4 draw methods stay untouched. Overlays add dynamic state on top.
- **Weather as plain object, not ECS entity**: Singleton state doesn't benefit from ECS query overhead.
- **Dirty-flag pattern**: Buildings only redraw when state changes, not every frame.
- **ParticleContainer for weather**: ~3x faster than Graphics-based particles.

## 4. Rollout Plan

Phase 2 -> Phase 3 -> Phase 4 (sequential, each builds on prior).

1. **PR: Phase 2** — Tile variants + ground shadows + cache. Visual QA across 4 themes.
2. **PR: Phase 3** — BuildingState + BuildingVisual + buildingSyncSystem. Test day/night lighting.
3. **PR: Phase 4** — Weather system + AmbientOverlay migration. Test rain/storm/fog per theme.

Success criteria: all perf budgets met, visual QA checklist passes, 100% unit test coverage on new systems.
