# bitECS Integration Roadmap

## 1. Overview

### The Problem

Agent state is managed by the `AgentSpriteObject` class (~356 lines in `frontend/src/components/world/pixi/AgentSprite.ts`), which combines rendering, movement interpolation, animation playback, path following, selection rings, highlights, and demo behavior into a single class. Every new agent concern (mood, inventory, relationships, tasks) would require adding more state and methods to this already-large class, increasing coupling and making independent iteration harder.

### Why bitECS

bitECS is a 5KB, zero-dependency, TypeScript-native Entity Component System library. It provides:

- **Separation of concerns** -- Components hold data, systems hold logic, entities are just IDs. New agent capabilities (mood, inventory, social) are added as independent components without touching existing code.
- **Structure-of-Arrays (SoA) memory layout** -- Cache-friendly iteration over large numbers of entities. Components are plain typed arrays accessed as `Component.field[entityId]`.
- **Built-in serialization** -- State snapshots for replays, save/load, and highlight reels.
- **Scalability** -- Designed for thousands of entities; current target is 10-50 agents but the architecture won't constrain future growth.

### Current Approach vs ECS

| Aspect | AgentSpriteObject (old) | bitECS (new) |
|--------|------------------------|--------------|
| Data + logic | Mixed in one class | Components (data) separate from Systems (logic) |
| Adding new state | Modify class, risk regressions | Add a new component, write a new system |
| Rendering coupling | Class owns PixiJS Sprite directly | `SpriteRef` component + `renderSyncSystem` bridge |
| Serialization | Manual per-field | Built-in SoA serialization |
| Testability | Requires PixiJS mocks | Systems are pure functions, testable without renderer |

## 2. Current Implementation Status

The ECS layer has been scaffolded and is **actively driving the simulation**. The `useGameWorld` composable has replaced `usePixiWorld` as the primary entry point. Agent spawning, movement, animation, and demo behavior all run through ECS.

### What's Working

- **World creation and lifecycle** -- `createGameWorld()` creates a bitECS world with all components registered. World is created on mount, destroyed on unmount.
- **Entity spawning** -- `spawnAgent()` creates an ECS entity with `Position`, `AgentId`, and `SpriteRef` components. An `agentEntityMap` maps string agent IDs to ECS entity IDs.
- **Movement via ECS** -- `moveAgentAlongPath()` sets `PathState` on an entity. The `pathfindingSystem` advances waypoints, `movementSystem` interpolates screen positions.
- **Animation via ECS** -- `playAction()` sets `AnimState` on an entity. The `animationSystem` advances frames. Walk animation auto-starts when `PathState` is added (via `onAdd` observer).
- **Render sync** -- `renderSyncSystem` reads `Position` and `SpriteRef` to update PixiJS sprite positions, and reads `AnimState` to update sprite textures. Communicates through a `RenderBridge` interface.
- **Lifecycle observers** -- `onRemove(PathState)` fires path-complete callbacks and stops walk animation. `onRemove(AnimState)` fires animation-complete callbacks.
- **Demo mode** -- Random walk + random animation behavior runs entirely through ECS components.
- **Entity removal** -- `removeAgent()` cleans up all components, removes the ECS entity, and removes the renderer sprite.

### What's Stubbed

- `StatusEffect` component is defined and has `onAdd`/`onRemove` observers, but only logs to console -- no visual effects yet.
- `Mood`, `Social`, `Inventory`, `TaskAssignment` components are defined and registered but not wired to any systems.
- `CausedBy`, `Targets`, `Trusts`, `LocatedAt` relations are defined but unused.
- State serialization is not implemented.
- `zSortSystem` from the spec is handled inline by `renderSyncSystem` (sets `zIndex` directly).

### What's Not Yet Migrated

`AgentSpriteObject` still exists at full size. It is instantiated by `useRenderer.createSprite()` and serves as the PixiJS sprite wrapper. Its movement/animation methods (`update()`, `moveTo()`, `followPath()`, `playHDAnimation()`, `startRandomBehavior()`) are no longer called by `useGameWorld` -- the ECS systems handle that logic now. However, the class has not been reduced to a thin sprite wrapper yet.

## 3. Architecture

### Layer Diagram

```
Vue Layer (Reactive)
    |
    +-- Pinia Stores (experiment, agent, world, social, gm, ui)
    |       |
    +-- SimulationView.vue
            |
            +-- useGameWorld.ts (parent composable)
            |     |
            |     +-- Owns: bitECS World, entity registry, tick loop
            |     +-- Runs: pathfindingSystem -> movementSystem -> animationSystem -> renderSyncSystem
            |     +-- API: spawnAgent(), moveAgentAlongPath(), playAction(), removeAgent()
            |     |
            |     +-- useRenderer.ts (child composable)
            |           |
            |           +-- Owns: PixiJS Application, display tree, camera, isoMap
            |           +-- Provides: RenderBridge interface for renderSyncSystem
            |           +-- Manages: AgentSpriteObject pool (sprite creation/destruction)
            |
            +-- ECS Layer (pure TypeScript -- no Vue, no PixiJS imports)
                  |
                  +-- ecs/world.ts          -- createGameWorld()
                  +-- ecs/components.ts     -- All component definitions
                  +-- ecs/systems/          -- System functions
```

### Relationship to PixiJS Rendering

ECS systems never import PixiJS. The bridge between ECS and PixiJS is the `RenderBridge` interface, implemented by `useRenderer`:

```
ECS World                           PixiJS
---------                           ------
Position.screenX/Y  ---->  RenderBridge.updateSpritePosition()  ---->  sprite.container.x/y
AnimState.frameIndex ---->  RenderBridge.updateSpriteTexture()   ---->  sprite.setPose()
SpriteRef.spriteIndex      (lookup key into spritePool[])
```

`renderSyncSystem` is the only system that takes the `RenderBridge` as a parameter. All other systems are pure.

### Relationship to Pinia Stores

Pinia stores remain the source of truth for game-level state (experiment config, agent metadata, world map, social events). ECS owns per-frame simulation state (position, velocity, animation frames). The flow is:

```
WebSocket message --> Pinia store action --> SimulationView watcher --> useGameWorld API call
                                                                         |
                                                                         v
                                                                   ECS component update
                                                                         |
                                                                         v
                                                                   System processes it
                                                                         |
                                                                         v
                                                                   RenderBridge --> PixiJS
```

ECS does not read Pinia stores. Pinia stores do not read ECS components. `useGameWorld` is the bridge.

### Relationship to Vue Composables

| Composable | Role | ECS Interaction |
|-----------|------|-----------------|
| `useGameWorld` | Parent -- owns ECS world, tick loop, entity registry | Creates/destroys entities, sets components, runs systems |
| `useRenderer` | Child -- owns PixiJS app, sprite pool | Provides `RenderBridge`, manages `AgentSpriteObject` instances |
| `usePathfinding` | BFS pathfinding on tile grid | Called by `useGameWorld` before setting `PathState` (provides the path array) |

### System Execution Order

Each tick (driven by PixiJS `app.ticker`):

1. `pathfindingSystem` -- Advances waypoint progress, removes `PathState` when path complete
2. `movementSystem` -- Lerps screen position between from/to tiles based on progress
3. `animationSystem` -- Advances animation frame timers, removes `AnimState` when complete
4. `renderSyncSystem` -- Pushes position and texture to PixiJS sprites via `RenderBridge`
5. `renderer.updateVisuals()` -- Updates ambient overlay and day/night cycle (not ECS)

## 4. Component Registry

### Core Components

| Component | Fields | Purpose |
|-----------|--------|---------|
| `Position` | `x`, `y`, `screenX`, `screenY` | Tile coordinates + cached pixel coordinates for rendering |
| `Velocity` | `dx`, `dy` | Movement velocity in tiles/second per axis (defined but not currently used -- `PathState` drives movement instead) |
| `PathState` | `waypointIndex`, `waypointCount`, `progress`, `fromX`, `fromY`, `toX`, `toY` | Active path-following state. Presence means entity is walking. Removal triggers path-complete callback. |
| `AnimState` | `frameIndex`, `elapsed`, `loop`, `animIndex` | Animation playback state. `animIndex` references a registered `HDAnimationDef`. Removal triggers anim-complete callback. |
| `AgentId` | `idIndex` | Links ECS entity to string agent ID via lookup table (`agentIdTable[idIndex]`) |
| `SpriteRef` | `spriteIndex` | Links ECS entity to PixiJS sprite via renderer pool index (`spritePool[spriteIndex]`) |
| `StatusEffect` | `type`, `intensity`, `remaining` | Active status effect (bleeding, poisoned, stunned, etc.). Observer stubs exist but no visual effects yet. |

### Stub Components (defined, not wired to systems)

| Component | Fields | Intended Use |
|-----------|--------|--------------|
| `Mood` | `happiness`, `fear`, `anger` | Emotional state driven by GM events and social interactions |
| `Social` | `influence`, `suspicion` | Social standing metrics for meeting votes and alliance formation |
| `Inventory` | `itemCount` | Resource possession tracking |
| `TaskAssignment` | `taskIndex`, `progress` | GM-assigned task tracking (gather, build, explore, etc.) |

### Relations

| Relation | Modifiers | Purpose |
|----------|-----------|---------|
| `CausedBy` | `withAutoRemoveSubject` | Consequence-to-aggressor link. Auto-cleans if aggressor entity is destroyed. |
| `Targets` | `makeExclusive` | Aggressor-to-victim. One target per action at a time. |
| `Trusts` | `withStore(() => ({ level: 0.5 }))` | Social trust between agents, with a data store for trust level. |
| `LocatedAt` | `makeExclusive` | Agent-to-location link. One location at a time. |

### Status Effect Types

| Constant | Value | Description |
|----------|-------|-------------|
| `BLEEDING` | 0 | Physical damage over time |
| `POISONED` | 1 | Toxin effect |
| `STUNNED` | 2 | Temporarily unable to act |
| `INJURED` | 3 | Reduced capability |
| `FLEEING` | 4 | Forced movement away from threat |

## 5. System Registry

| System | File | Purpose | Reads | Writes | Status |
|--------|------|---------|-------|--------|--------|
| `pathfindingSystem` | `systems/pathfindingSystem.ts` | Advances entities along waypoint paths; removes `PathState` on completion | `Position`, `PathState` | `PathState`, `Position` | Done |
| `movementSystem` | `systems/movementSystem.ts` | Lerps screen position between from/to tiles each tick | `PathState` | `Position` (screenX/Y, snaps x/y on arrival) | Done |
| `animationSystem` | `systems/animationSystem.ts` | Advances animation frame timers; removes `AnimState` when non-looping anim completes | `AnimState` | `AnimState` (frameIndex, elapsed) | Done |
| `renderSyncSystem` | `systems/renderSyncSystem.ts` | Pushes ECS state to PixiJS sprites via `RenderBridge` | `Position`, `SpriteRef`, `AnimState`, `PathState` | None (side effects via bridge) | Done |
| `zSortSystem` | (not separate file) | Reorders sprites by tile Y position | `Position`, `SpriteRef` | Sprite z-index | Done (inline in renderSyncSystem) |
| `statusEffectSystem` | -- | Tick down status effect durations, apply effects, remove expired | `StatusEffect` | `StatusEffect`, potentially `Position`/`AnimState` | Planned |
| `moodSystem` | -- | Update mood based on events, proximity, and status effects | `Mood`, `StatusEffect`, `Social` | `Mood` | Planned |
| `taskSystem` | -- | Advance task progress, handle task completion/failure | `TaskAssignment`, `Position` | `TaskAssignment` | Planned |
| `socialSystem` | -- | Update social metrics based on interactions and proximity | `Social`, `Trusts` | `Social`, `Trusts` | Planned |

## 6. Migration Path

### Current State

The migration is partially complete. `useGameWorld` has replaced `usePixiWorld` as the entry point. All agent spawning, movement, animation, and demo behavior flow through ECS. However, `AgentSpriteObject` still contains the old movement/animation logic (unused but not removed).

### Phase 1: Reduce AgentSpriteObject (Low Risk)

**What:** Strip `AgentSpriteObject` down to a thin sprite wrapper. Remove `update()`, `moveTo()`, `followPath()`, `walkNextStep()`, `startWalkCycle()`, `stopWalkCycle()`, `playHDAnimation()`, `advanceHDFrame()`, `startRandomBehavior()`, `stopAllBehavior()`, and all associated timer/callback state. Keep only sprite creation, `setPose()`, selection/highlight rings, texture caching, and `destroy()`.

**Why it's safe:** These methods are already unused -- `useGameWorld` drives movement and animation through ECS systems. The `useRenderer` only calls `setPose()`, position setters, and highlight methods.

**Backwards compatibility:** None needed. The old API surface is not called by any current code path.

### Phase 2: Status Effect Visuals (Low Risk)

**What:** Implement `statusEffectSystem` that ticks down `remaining` duration and removes expired effects. Wire `onAdd(StatusEffect)` and `onRemove(StatusEffect)` observers to add/remove visual indicators on sprites (color tints, particle effects, overlay icons).

**Why it's safe:** `StatusEffect` component is already defined and registered. Observer stubs exist. This is additive -- no existing behavior changes.

### Phase 3: Wire Stub Components to GM Pipeline (Requires Coordination)

**What:** When the backend GM system sends agent state updates (mood changes, task assignments, inventory changes), `useGameWorld` will set the corresponding ECS components. New systems (`moodSystem`, `taskSystem`) will process them each tick.

**Coordination needed:**
- WebSocket message types for mood/task/inventory updates must be defined in `shared/schemas/`
- Pinia stores need new actions to receive these messages
- `SimulationView` watchers need to call `useGameWorld` methods that set ECS components
- Visual feedback for mood/task state needs design (sprite overlays, HUD indicators)

### Phase 4: State Serialization (Medium Risk)

**What:** Implement snapshot/restore using bitECS serialization. Serialize all game-state components (exclude `SpriteRef` which is rendering-only). Support round-trip: serialize at end of round, deserialize on reconnect or replay.

**Coordination needed:**
- Snapshot format must be compatible with backend state representation
- Reconnection flow in `useWebSocket` needs to accept and apply snapshots
- Replay system (if built) needs to store and playback snapshot sequences

### Phase 5: LocatedAt Relation for Spatial Queries (Low Risk)

**What:** Wire the `LocatedAt` relation so agents are linked to location entities. This enables spatial queries like "which agents are at the campfire?" without iterating all entities and checking tile coordinates.

**Requires:** Location entities to be created for each map location (currently locations are just data in the `IsometricMap`).

## 7. Next Steps

Prioritized by impact and risk:

1. **Reduce AgentSpriteObject** -- Remove dead movement/animation code from the class. This is cleanup with zero risk and makes the codebase easier to understand. Estimated scope: delete ~150 lines from `AgentSprite.ts`.

2. **Add statusEffectSystem** -- Implement duration tick-down and visual indicators. This exercises the pattern for adding new systems and validates the component lifecycle with real visual feedback.

3. **Create location entities** -- Spawn ECS entities for map locations (campfire, shelter, etc.) and wire the `LocatedAt` relation. This enables spatial queries that the GM pipeline will need.

4. **Design GM-to-ECS data flow** -- Define how backend agent state updates map to ECS component writes. This is a design task that should happen before implementing `moodSystem`/`taskSystem`.

5. **Implement state serialization** -- Add snapshot/restore for game-state components. This unblocks replay and reconnection features.

6. **Add unit tests for systems** -- Systems are pure functions that take a world and delta time. They can be tested without PixiJS or Vue. Write tests for `pathfindingSystem`, `movementSystem`, and `animationSystem` to lock in behavior before adding more systems.
