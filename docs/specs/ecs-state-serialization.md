---
title: "ECS State Serialization"
type: spec
status: todo
owner: ""
team: "frontend"
review_status: draft
tags: [stream-1, frontend, ecs, architecture, persistence]
depends_on: [bitecs-entity-component-system, ecs-typed-array-migration]
created: "2026-03-16"
updated: "2026-03-16"
---

# ECS State Serialization

## 1. Background

Section 6 of `bitecs-entity-component-system.md` defines four acceptance criteria for state serialization but has no implementation plan. PR #201 introduced session-owned state (pathData Maps, AnimationRegistry, lastTileFrame Map) that lives outside bitECS's component store, complicating serialization beyond bitECS's built-in `serialize`/`deserialize` API.

TypedArray migration (see `ecs-typed-array-migration.md`) is recommended before this work because TypedArrays serialize more cleanly to ArrayBuffer/JSON than plain JS arrays.

## 2. What Gets Serialized

### ECS Component Data
All component data for all entities, via bitECS `serialize()`:
- Position, Velocity, PathState, AnimationState, AgentIdentity
- WaterTile, TileEntity, LocationIndex
- Mood, Social, Inventory, TaskAssignment

### Session-Owned State
Maps and registries owned by the GameSession that are not stored in bitECS components:
- `pathDataMap: Map<entityId, PathData>` — active path waypoints per entity
- `animRegistry: AnimationRegistry` — animation definitions and frame data
- `lastTileFrame: Map<tileKey, number>` — water tile animation frame tracking
- Entity ID ↔ agent ID mapping

### Entity Metadata
- Active entity list (which entity IDs are alive)
- Entity-to-component membership (which entities have which components)

## 3. What Gets Excluded

- `SpriteRef` component — rendering-only, rebuilt on restore from entity→sprite mapping
- RenderBridge runtime state — PixiJS objects, sprite pools, container references
- PixiJS Application state — renderer, stage, ticker
- Performance monitor accumulators — transient diagnostic data

## 4. bitECS Serialize/Deserialize API

```typescript
import { serialize, deserialize } from 'bitecs'

// Serialize: world → ArrayBuffer per component
const snapshot = {
  position: serialize(world, [Position]),
  velocity: serialize(world, [Velocity]),
  pathState: serialize(world, [PathState]),
  // ... all non-excluded components
}

// Deserialize: ArrayBuffer → restore component data
deserialize(world, [Position], snapshot.position)
```

Key considerations:
- `serialize()` captures all entities that have the component
- Entity IDs are preserved in the serialized data
- After `deserialize()`, queries automatically pick up restored entities

## 5. Custom Serialization for Session-Owned State

Session-owned Maps must be serialized separately since they live outside bitECS:

```typescript
interface SessionSnapshot {
  // bitECS component data
  components: Record<string, ArrayBuffer>
  // Session-owned state
  pathData: Array<[entityId: number, pathData: SerializedPathData]>
  animRegistry: SerializedAnimRegistry
  lastTileFrame: Array<[tileKey: string, frame: number]>
  entityAgentMap: Array<[entityId: number, agentId: string]>
  // Metadata
  timestamp: number
  roundNumber: number
}
```

`SerializedPathData` flattens the path waypoints to a JSON-safe format (array of `{x, y}` pairs + current index).

## 6. Restore Flow

1. **Deserialize bitECS components** — `deserialize(world, components, buffers)` for each component
2. **Restore session Maps** — rebuild `pathDataMap`, `animRegistry`, `lastTileFrame` from snapshot
3. **Rebuild renderer bindings** — create sprites for all entities with Position, assign to SpriteRef, add to PixiJS containers
4. **Resume tick** — game loop picks up from restored state

Order matters: components must be restored before renderer bindings (which read Position to place sprites).

## 7. Use Cases

### Reconnect Without Refresh
- User's WebSocket disconnects (network blip, tab sleep)
- On reconnect, backend sends current world state
- Frontend deserializes into existing ECS world without page refresh
- Sprites rebind, game resumes seamlessly

### Round Snapshots for Post-Game Replay
- At end of each round, serialize full state
- Store snapshots in IndexedDB or send to backend
- Post-game replay scrubs through round snapshots
- Each snapshot restores complete world state at that point in time

### Acceptance Criteria

- [ ] All component data for all entities can be serialized to a JSON-compatible snapshot
- [ ] Snapshots can be deserialized to restore world state
- [ ] Serialization excludes SpriteRef (rendering-only data)
- [ ] Snapshot round-trip preserves entity IDs and all component values
- [ ] Session-owned Maps (pathData, animRegistry, lastTileFrame) correctly serialized and restored
- [ ] Reconnect flow: disconnect → reconnect → world restores without page refresh
