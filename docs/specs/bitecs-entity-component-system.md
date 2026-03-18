---
title: "[P2] Entity Component System with bitECS"
status: in_progress
# NOTE: Sections 1-5 are done; only §6 (serialization) remains
priority: P2
tags: [stream-1, frontend, architecture, ecs, agents]
depends_on: [S1.3-isometric-world, s1.4-agent-rendering]
---

# Entity Component System with bitECS

## Background

Agent state is currently managed by the `AgentSpriteObject` class (~333 lines), which combines rendering, movement, animation, and behavior into a single object. The `usePixiWorld` composable (~245 lines) orchestrates agent lifecycle and the `usePathfinding` composable (~183 lines) handles movement planning.

This works well for the current scope (~10 agents with simple demo behaviors). However, as the GM system comes online and agents gain richer state (mood, relationships, inventory, tasks, conversation history, health), the class-based approach will become unwieldy — every new concern added to `AgentSpriteObject` increases coupling and makes independent iteration harder.

bitECS is a 5KB, zero-dependency, TypeScript-native ECS library used in production by Mozilla Hubs. It provides Structure-of-Arrays memory layout for cache-friendly iteration and built-in serialization for state snapshots.

### Why now (trigger conditions)

This spec should be picked up when **any** of these become true:
- The GM → agent behavior pipeline is being built (backend AI drives agent actions)
- Agent state grows beyond position + animation + path (e.g., mood, inventory, relationships)
- Agent count targets exceed 20 per experiment
- You need to serialize/snapshot agent state (for replays, save/load, or highlight reels)
- `AgentSpriteObject` exceeds ~500 lines or gains 3+ new state properties

## 1. Core ECS world setup

### Acceptance Criteria

- [x] `bitecs` is added as a dependency
<!-- canon:realized-in: file:frontend/package.json bitecs ^0.4.0 -->
- [x] A game `World` is created and managed in a new composable (`useECSWorld` or similar)
<!-- canon:realized-in: file:frontend/src/ecs/world.ts func:createGameWorld -->
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts -->
- [x] The ECS world ticks via the existing PixiJS `app.ticker` loop
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts func:tick -->
- [x] World lifecycle (create, reset, destroy) integrates with experiment start/stop
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts func:mount/destroy -->

## 2. Component definitions

Define data-only components for agent state. Components are plain typed arrays — no methods, no rendering logic.

### Acceptance Criteria

- [x] `Position` component: `x`, `y` (tile coordinates), `screenX`, `screenY` (pixel coordinates)
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 19-24 -->
- [x] `Velocity` component: `dx`, `dy`
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 27-30 -->
- [x] `PathState` component: current path array reference, current step index
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 33-41 -->
- [x] `SpriteRef` component: reference/index to the PixiJS Sprite object for rendering
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 57-59 -->
- [x] `AnimationState` component: current animation name, frame index, elapsed time, looping flag
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 44-49 -->
- [x] `AgentIdentity` component: agent ID reference (for linking back to game data)
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 52-54 -->
- [x] Components use SoA layout for cache-friendly iteration
<!-- canon:realized-in: file:frontend/src/ecs/components.ts (plain object with [] as number[] arrays) -->

## 3. System implementations

Systems are pure functions that operate on entities matching a component query. Each system does one thing.

### Acceptance Criteria

- [x] `movementSystem` — advances entities with `Position` + `Velocity` along their interpolation path each tick
<!-- canon:realized-in: file:frontend/src/ecs/systems/movementSystem.ts -->
- [x] `pathfindingSystem` — for entities with `PathState`, computes next tile target when current segment completes
<!-- canon:realized-in: file:frontend/src/ecs/systems/pathfindingSystem.ts -->
- [x] `animationSystem` — advances frame timers for entities with `AnimationState`, triggers pose changes
<!-- canon:realized-in: file:frontend/src/ecs/systems/animationSystem.ts -->
- [x] `renderSyncSystem` — copies `Position.screenX/Y` to PixiJS Sprite position, updates z-index, applies animation frame to sprite texture
<!-- canon:realized-in: file:frontend/src/ecs/systems/renderSyncSystem.ts -->
- [x] `zSortSystem` — integrated into renderSyncSystem (z-sort by tile Y in useRenderer)
<!-- canon:realized-in: file:frontend/src/composables/useRenderer.ts -->
- [x] Each system is a standalone function in `frontend/src/ecs/systems/`
- [x] Systems run in defined order: pathfinding → movement → animation → renderSync
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts func:tick -->

## 4. Migration from AgentSpriteObject

Refactor the current class-based agents to use ECS entities with the component/system split.

### Acceptance Criteria

- [x] `spawnAgent()` creates an ECS entity with appropriate components instead of instantiating `AgentSpriteObject`
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts func:spawnAgent lines 160-184 -->
- [x] `moveAgentAlongPath()` sets `PathState` on the entity instead of calling `agentSprite.walkPath()`
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts func:moveAgentAlongPath lines 252-293 -->
- [x] `playAction()` sets `AnimationState` on the entity instead of calling `agentSprite.playAnimation()`
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts func:playAction lines 295-334 -->
- [x] Agent click/selection still works (sprite → entity ID lookup)
<!-- canon:realized-in: file:frontend/src/composables/useRenderer.ts lines 164-168 -->
- [x] Demo random behavior works identically to current implementation
<!-- canon:realized-in: file:frontend/src/composables/useGameWorld.ts func:startDemo/startDemoCycle -->
- [x] `AgentSpriteObject` class is removed or reduced to a thin sprite-only wrapper
<!-- canon:realized-in: file:frontend/src/components/world/pixi/AgentSprite.ts reduced from 357 to 147 lines, all movement/animation/demo code removed -->

## 5. Future-ready component slots

Define but don't fully implement these components — they provide the schema for GM integration.

### Acceptance Criteria

- [x] `Mood` component stub: happiness, fear, anger (float values)
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 72-76 -->
- [x] `Social` component stub: influence, suspicion
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 78-81 -->
- [x] `Inventory` component stub: itemCount
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 83-85 -->
- [x] `TaskAssignment` component stub: taskIndex, progress
<!-- canon:realized-in: file:frontend/src/ecs/components.ts lines 87-90 -->
- [x] Components are defined and registered but not yet wired to systems
- [x] Each stub component has a doc comment describing its intended use

## 6. State serialization

### Acceptance Criteria

- [ ] All component data for all entities can be serialized to a JSON-compatible snapshot
- [ ] Snapshots can be deserialized to restore world state
- [ ] Serialization excludes rendering-only data (`SpriteRef`)
- [ ] Snapshot round-trip preserves entity IDs and all component values

## Technical Design

### Architecture

```
Vue Layer (stores, composables)
    │
    ├── useECSWorld.ts          ← new: creates world, runs tick loop
    │     ├── createWorld()
    │     ├── tick() → runs all systems in order
    │     └── spawn/despawn entity helpers
    │
    ├── usePixiWorld.ts          ← modified: delegates agent management to ECS
    │     └── Still owns PixiJS app, camera, map rendering
    │
    └── usePathfinding.ts        ← modified: provides pathfinding to ECS system
          └── findPath() still BFS, called by pathfindingSystem

ECS Layer (pure TypeScript, no Vue, no PixiJS imports)
    │
    ├── components/              ← component definitions (data only)
    │     ├── Position.ts
    │     ├── Velocity.ts
    │     ├── PathState.ts
    │     ├── AnimationState.ts
    │     └── AgentIdentity.ts
    │
    └── systems/                 ← system functions (logic only)
          ├── movementSystem.ts
          ├── pathfindingSystem.ts
          ├── animationSystem.ts
          ├── zSortSystem.ts
          └── renderSyncSystem.ts

Bridge Layer
    │
    └── SpriteRef component + renderSyncSystem
          → Only place where ECS entity IDs map to PixiJS Sprites
          → Keeps ECS layer renderer-agnostic
```

### Key constraint: Vue ↔ PixiJS bridge rule preserved

The existing rule — "Vue never touches PixiJS objects directly; PixiJS never reads Pinia stores" — extends to: "ECS components/systems never import Vue or PixiJS. Only the bridge layer (`renderSyncSystem` + `SpriteRef`) touches PixiJS."

### Key files to modify
- `frontend/src/components/world/pixi/AgentSprite.ts` — reduce to thin sprite wrapper or remove
- `frontend/src/composables/usePixiWorld.ts` — delegate agent ops to ECS
- New: `frontend/src/ecs/components/` — component definitions
- New: `frontend/src/ecs/systems/` — system implementations
- New: `frontend/src/composables/useECSWorld.ts` — world lifecycle

### Dependencies
- `bitecs` (latest, ~5KB)

## Rollout

1. Add `bitecs`, create world + `Position` component + `movementSystem` for one test agent
2. Run ECS movement alongside existing `AgentSpriteObject` movement, validate parity
3. Migrate all agent state to ECS components one system at a time (movement → animation → pathfinding)
4. Remove `AgentSpriteObject` class
5. Add stub components for GM integration
6. Add serialization for state snapshots
