---
title: "ECS Map Enhancement: Fire/Hazards, Cross-System Integration"
type: spec
status: draft
owner: ""
team: "frontend"
review_status: draft
tags: [stream-1, frontend, pixi, ecs, visual, isometric, gameplay]
depends_on: [ecs-tile-variation-building-weather]
created: "2026-03-13"
updated: "2026-03-13"
---

# ECS Map Enhancement: Fire/Hazards, Cross-System Integration

## 1. Background

Phases 5-7 of the ECS-driven map enhancement plan. Builds on Phases 2-4 (tile variation, BuildingState component, weatherSystem).

With buildings as ECS entities and weather as a state machine, we can wire up gameplay-affecting systems: fire that spreads tile-to-tile as a cellular automaton, damages buildings, and is extinguished by rain. Phase 6 adds cross-system interactions (weather slows agents, buildings flicker at night). Phase 7 polishes the unified dev panel.

**Related issues:** #202 (fire/hazard propagation), #121 (environmental props), #115 (isometric aesthetics umbrella)

**Prerequisite:** Phases 2-4 merged (BuildingState, buildingSyncSystem, weatherSystem, WeatherData).

## 2. Requirements

### Phase 5: Fire / Hazard Propagation

#### 5.1 HazardState Component

New component in `ecs/components/world.ts`:

```typescript
export const HazardState = {
  type: [] as number[],        // HAZARD_TYPES enum
  intensity: [] as number[],   // 0.0-1.0
  spreadTimer: [] as number[], // cooldown before next spread check
}

export const HAZARD_TYPES = { NONE: 0, FIRE: 1, FLOOD: 2 } as const
```

##### Acceptance Criteria

- [ ] HazardState defined in `components/world.ts` and registered in `world.ts`
- [ ] Re-exported from barrel `components/index.ts`

#### 5.2 Tile Entity Lazy Creation

When fire spreads to a tile without an ECS entity, create one on demand. Clean up when hazard expires and no other dynamic components remain.

##### Acceptance Criteria

- [ ] Fire can spread to tiles that don't yet have ECS entities
- [ ] New entity created with TileRef + HazardState + tile sprite
- [ ] Entity destroyed when hazard expires and no other dynamic components remain
- [ ] `tileEntityMap` stays in sync (no leaked entries)

#### 5.3 Hazard System

`hazardSystem(world, dt, lookup, weather, pendingSpawns)` — pure function.

Fire behavior:
- Intensity ramps +0.1/s
- Rain reduces at -0.3 * weather.intensity/s
- Storm reduces at -0.6 * weather.intensity/s
- Spreads to adjacent grass/field when intensity > 0.5 (2s cooldown)
- Does NOT spread to fence/path tiles
- Burns out when intensity <= 0
- Adjacent buildings take condition damage

`pendingSpawns` output array — `useGameWorld` handles entity creation after tick.

##### Acceptance Criteria

- [ ] Fire intensity ramps over time (unit test)
- [ ] Fire spreads to adjacent grass/field after cooldown (unit test)
- [ ] Rain reduces fire intensity (unit test)
- [ ] Storm extinguishes fire faster (unit test)
- [ ] Fire burns out and triggers removal (unit test)
- [ ] Fire doesn't spread to fence/path tiles (unit test)
- [ ] `pendingSpawns` populated correctly (unit test)
- [ ] Adjacent building damage reduces BuildingState.condition

#### 5.4 Fire Visual Overlay

4 fire overlay frames (`fire_0..3`) in tile atlas. Semi-transparent orange/red on isometric diamond, zIndex=3.

##### Acceptance Criteria

- [ ] Fire overlay frames generated in `buildThemeAtlas()`
- [ ] Fire tiles animate through 4 frames
- [ ] Fire sprites render above ground but below buildings
- [ ] `window.__devWorld.startFire(x, y)` and `extinguishAll()` work

#### 5.5 Tile Grid Lookup

Pure data interface for hazardSystem (no PixiJS dependency):

```typescript
interface TileGridLookup {
  getTileType(x: number, y: number): string | null
  getNeighbors(x: number, y: number): { x: number, y: number }[]
  getEntityAt(x: number, y: number): number | null
}
```

##### Acceptance Criteria

- [ ] TileGridLookup constructed at loadMap, updated on entity create/destroy
- [ ] hazardSystem receives lookup as parameter (no global state)

### Phase 6: Cross-System Integration

#### 6.1 Weather -> Agent Speed

`pathfindingSystem` accepts `weatherSpeedModifier` parameter. Storm reduces speed up to 30%.

##### Acceptance Criteria

- [ ] Agents move slower during storms (visual QA)
- [ ] Speed modifier passed as parameter (not global state)
- [ ] No speed change in clear weather (modifier = 1.0)

#### 6.2 Building Window Flicker

Lit buildings (lighting >= 2) randomly toggle one window dim/bright every ~2 seconds at night.

##### Acceptance Criteria

- [ ] Windows flicker at night for lit buildings
- [ ] Flicker rate ~1.5-2.5s with slight randomness
- [ ] Only buildings with lighting >= 2 flicker
- [ ] Uses dirty flag (minimal render cost)

#### 6.3 GM Crisis -> Weather/Fire Bridge

`worldStore` or `gmStore` calls `useGameWorld.setWeather()` and `startFire()` from crisis events. No new WS message types needed.

##### Acceptance Criteria

- [ ] Crisis events can trigger weather changes
- [ ] Crisis events can trigger fire at specific tiles
- [ ] Both pathways work via existing store -> composable API

### Phase 7: Polish + Unified Dev Panel

#### 7.1 Unified Dev Panel

Consolidate all `window.__devWorld` APIs from Phases 0-6 into a single documented interface.

##### Acceptance Criteria

- [ ] All dev panel APIs accessible under `window.__devWorld`
- [ ] Dev panel only exists in development builds
- [ ] Clean up on destroy (no leaked globals)

#### 7.2 On-Screen Performance Overlay

DOM element toggled via `window.__devWorld.perf.toggleOverlay()` showing frame time, p99, per-system breakdown, entity count, draw calls.

##### Acceptance Criteria

- [ ] Overlay shows all key metrics
- [ ] Toggle on/off without reloading
- [ ] DOM-based (not PixiJS) to avoid affecting render stats

#### 7.3 Visual QA Checklist

- [ ] Characters stand naturally on tiles
- [ ] Water animation works (LOTF ocean, Matrix code river)
- [ ] Tile variants visible (no monotonous ground)
- [ ] Ground shadows visible where expected
- [ ] Building lighting responds to day/night phase
- [ ] Building damage cracks visible at low condition
- [ ] Weather particles match theme
- [ ] Fire spreads and is extinguished by rain
- [ ] Agents slow during storms
- [ ] CPU throttle 4x -> smooth interpolation
- [ ] p99 < 8ms

## 3. Design

### Key Files

| Phase | File | Changes |
|-------|------|---------|
| 5 | `ecs/components/world.ts` | HazardState, HAZARD_TYPES |
| 5 | `hazardSystem.ts` | Fire spread + weather interaction (new) |
| 5 | `tile-atlas.ts` | Fire overlay frames |
| 5 | `renderSyncSystem.ts` | Hazard overlay rendering |
| 5 | `useGameWorld.ts` | startFire API, pending spawns, cleanup |
| 6 | `pathfindingSystem.ts` | Weather speed modifier param |
| 6 | `buildingSyncSystem.ts` | Window flicker logic |
| 6 | `useGameWorld.ts` | Cross-system wiring, GM bridge |
| 7 | `useGameWorld.ts` | Unified dev panel |

### Performance Budget (Full System)

| Metric | Budget | Enforcement |
|--------|--------|-------------|
| p99 frame time | < 8ms | CI benchmark + dev overlay |
| Simulation systems total | < 2ms combined | CI benchmark at 150 entities |
| ECS entities | < 200 total | perfMonitor entity count |
| Draw calls | < 20 | PixiJS renderer stats |
| Building redraws | Dirty-flag only | buildingSyncSystem design |

### Architecture Decisions

- **pendingSpawns pattern**: hazardSystem outputs spawn requests, useGameWorld creates entities. Keeps systems pure.
- **Lazy tile entity creation**: Only tiles with active hazards get ECS entities. Keeps entity count low.
- **TileGridLookup as pure data**: No PixiJS dependency in hazardSystem — fully unit-testable.
- **Weather speed modifier as parameter**: No global state in pathfindingSystem.

## 4. Rollout Plan

Phase 5 -> Phase 6 -> Phase 7 (sequential).

1. **PR: Phase 5a** — HazardState component + hazardSystem + unit tests
2. **PR: Phase 5b** — Fire visual overlay + tile grid lookup + dev panel APIs
3. **PR: Phase 6** — Weather-agent speed, window flicker, GM bridge
4. **PR: Phase 7** — Unified dev panel, perf overlay, visual QA pass

Success criteria: all perf budgets met, hazardSystem 100% unit test coverage, visual QA checklist passes across all 4 themes.
