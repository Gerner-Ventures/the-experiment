---
title: "ECS TypedArray Migration"
type: spec
status: todo
owner: ""
team: "frontend"
review_status: draft
tags: [stream-1, frontend, ecs, performance, architecture]
depends_on: [bitecs-entity-component-system]
created: "2026-03-16"
updated: "2026-03-16"
---

# ECS TypedArray Migration

## 1. Background
<!-- canon:system:1 status:done -->

Every review of PR #201 (claude[bot], njgerner, ecosystem analysis) flagged the same issue: the bitECS foundation spec calls for "SoA layout for cache-friendly iteration," but all 13 components use plain JS arrays (`[] as number[]`) instead of TypedArrays (`Types.f32`, `Types.ui8`, `Types.ui32`). This undermines the cache-friendly iteration that motivates bitECS adoption.

bitECS supports TypedArray-backed components natively. When a component field uses `Types.f32` instead of `[] as number[]`, bitECS allocates a `Float32Array` under the hood, giving contiguous memory layout and enabling SIMD-friendly iteration patterns.

This is foundation debt, not feature work. It should be resolved before building Phases 2-7 on top of the current component definitions.

## 2. Current State
<!-- canon:system:2 status:done -->

All 13 components in `frontend/src/ecs/components.ts` use `[] as number[]`:

| Component | Fields | Notes |
|-----------|--------|-------|
| Position | x, y, screenX, screenY, tileX, tileY | Float coordinates |
| Velocity | dx, dy | Float deltas |
| PathState | pathIndex, pathLength, segProgress, moving, paused, targetX, targetY, hasTarget, lastTileX, lastTileY | Mix of floats, indices, flags |
| AnimationState | animId, frame, elapsed, loop, speed, playing | Mix of indices, floats, flags |
| AgentIdentity | agentIndex | Integer index |
| SpriteRef | spriteIndex | Integer index |
| WaterTile | frame, speed, phase | Float values |
| Mood | happiness, fear, anger | Float values |
| Social | influence, suspicion | Float values |
| Inventory | itemCount | Integer count |
| TaskAssignment | taskIndex, progress | Integer + float |
| TileEntity | tileType, row, col | Integer values |
| LocationIndex | locationIndex | Integer value |

## 3. Type Mapping
<!-- canon:system:3 status:todo -->

Each field maps to the most appropriate TypedArray backing:

| Type | Use For | Fields |
|------|---------|--------|
| `Types.f32` | Coordinates, percentages, speeds, float state | Position.x/y/screenX/screenY/tileX/tileY, Velocity.dx/dy, PathState.segProgress/targetX/targetY, AnimationState.elapsed/speed, WaterTile.frame/speed/phase, Mood.*, Social.*, TaskAssignment.progress |
| `Types.ui32` | Indices, counts, IDs | AgentIdentity.agentIndex, SpriteRef.spriteIndex, PathState.pathIndex/pathLength/lastTileX/lastTileY, AnimationState.animId/frame, Inventory.itemCount, TaskAssignment.taskIndex, TileEntity.row/col, LocationIndex.locationIndex |
| `Types.ui8` | Boolean flags, small enums (0-255) | PathState.moving/paused/hasTarget, AnimationState.loop/playing, TileEntity.tileType |

## 4. Migration Approach
<!-- canon:system:4 status:todo -->

Migrate component-by-component, updating tests after each component:

**Order** (least-coupled → most-coupled):
1. `WaterTile` — isolated, only used by waterSystem
2. `TileEntity` — isolated tile metadata
3. `LocationIndex` — single field
4. `Mood`, `Social`, `Inventory`, `TaskAssignment` — stubs, minimal test surface
5. `AgentIdentity`, `SpriteRef` — simple index lookups
6. `Velocity` — two fields, used by movementSystem
7. `AnimationState` — used by animationSystem + renderSyncSystem
8. `PathState` — most fields, used by pathfindingSystem + movementSystem
9. `Position` — most heavily used across all systems

Each step:
1. Change field definitions from `[] as number[]` to `Types.f32` / `Types.ui8` / `Types.ui32`
2. Run existing tests — fix any type assertion failures
3. Verify no behavioral changes

## 5. Benchmark
<!-- canon:system:5 status:todo -->

Before/after benchmark at 50, 150, and 500 entities:

**What to measure:**
- System tick time (pathfinding → movement → animation → renderSync pipeline)
- Component read/write throughput (iterate all entities, read/write Position fields)
- Memory footprint (component allocation size)

**How:**
- Use the existing `usePerformanceMonitor` infrastructure
- Add a one-off benchmark script in `frontend/tests/unit/ecs/typedArrayBenchmark.spec.ts`
- Run 1000 ticks at each entity count, report mean/p95/p99

**Expected outcome:** At 150 entities, improvement may be marginal. The value is architectural correctness and scaling to 500+ entities.

## 6. Test Impact
<!-- canon:system:6 status:todo -->

- Type assertion tests (e.g., `expect(Position.x[eid]).toBe(...)`) should work unchanged — TypedArrays support index access
- Tests comparing with `===` against float values may need tolerance (`toBeCloseTo`) if they don't already
- bitECS query/system API is identical for TypedArray and plain array components — no system code changes expected

### Acceptance Criteria

- [ ] All component arrays use `Types.f32`, `Types.ui8`, or `Types.ui32` — no `[] as number[]` remains
- [ ] All existing tests pass without behavioral changes
- [ ] Benchmark at 150 entities shows measured result (improvement or "no significant difference at this scale")
- [ ] No functional behavior changes — all systems produce identical output
