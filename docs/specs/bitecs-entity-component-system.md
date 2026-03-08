---
title: "[P2] Entity Component System with bitECS"
status: todo
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

- [ ] `bitecs` is added as a dependency
- [ ] A game `World` is created and managed in a new composable (`useECSWorld` or similar)
- [ ] The ECS world ticks via the existing PixiJS `app.ticker` loop
- [ ] World lifecycle (create, reset, destroy) integrates with experiment start/stop

## 2. Component definitions

Define data-only components for agent state. Components are plain typed arrays — no methods, no rendering logic.

### Acceptance Criteria

- [ ] `Position` component: `x`, `y` (tile coordinates), `screenX`, `screenY` (pixel coordinates)
- [ ] `Velocity` component: `targetX`, `targetY`, `speed`, `progress` (interpolation 0→1)
- [ ] `PathState` component: current path array reference, current step index
- [ ] `SpriteRef` component: reference/index to the PixiJS Sprite object for rendering
- [ ] `AnimationState` component: current animation name, frame index, elapsed time, looping flag
- [ ] `AgentIdentity` component: agent ID reference, name reference (for linking back to game data)
- [ ] Components use SoA layout for cache-friendly iteration

## 3. System implementations

Systems are pure functions that operate on entities matching a component query. Each system does one thing.

### Acceptance Criteria

- [ ] `movementSystem` — advances entities with `Position` + `Velocity` along their interpolation path each tick
- [ ] `pathfindingSystem` — for entities with `PathState`, computes next tile target when current segment completes
- [ ] `animationSystem` — advances frame timers for entities with `AnimationState`, triggers pose changes
- [ ] `renderSyncSystem` — copies `Position.screenX/Y` to PixiJS Sprite position, updates z-index, applies animation frame to sprite texture
- [ ] `zSortSystem` — reorders sprite container children based on tile Y position
- [ ] Each system is a standalone function in `frontend/src/systems/`
- [ ] Systems run in defined order: pathfinding → movement → animation → zSort → renderSync

## 4. Migration from AgentSpriteObject

Refactor the current class-based agents to use ECS entities with the component/system split.

### Acceptance Criteria

- [ ] `spawnAgent()` creates an ECS entity with appropriate components instead of instantiating `AgentSpriteObject`
- [ ] `moveAgentAlongPath()` sets `PathState` on the entity instead of calling `agentSprite.walkPath()`
- [ ] `playAction()` sets `AnimationState` on the entity instead of calling `agentSprite.playAnimation()`
- [ ] Agent click/selection still works (sprite → entity ID lookup)
- [ ] Demo random behavior works identically to current implementation
- [ ] `AgentSpriteObject` class is removed or reduced to a thin sprite-only wrapper

## 5. Future-ready component slots

Define but don't fully implement these components — they provide the schema for GM integration.

### Acceptance Criteria

- [ ] `Mood` component stub: valence, arousal, dominance (float values)
- [ ] `Social` component stub: relationship target entity, sentiment value
- [ ] `Inventory` component stub: item type IDs, quantities
- [ ] `TaskAssignment` component stub: task type, target location, progress
- [ ] Components are defined and registered but not yet wired to systems
- [ ] Each stub component has a doc comment describing its intended use

## 6. State serialization

### Acceptance Criteria

- [ ] All component data for all entities can be serialized to a JSON-compatible snapshot using bitECS serialization
- [ ] Snapshots can be deserialized to restore world state
- [ ] Serialization excludes rendering-only data (`SpriteRef`) — only game-state components
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
