# ECS Design Skill

Use this skill when working with the bitECS entity component system: adding components, creating systems, spawning entities, wiring ECS to PixiJS rendering, or debugging entity state.

## Architecture Overview

```
Vue Application Layer
    |
    useGameWorld.ts (composable - owns world lifecycle)
    |
    +-- bitECS World (createGameWorld)
    |   +-- Components: Position, Velocity, PathState, AnimState, AgentId, SpriteRef, StatusEffect, Mood, Social, Inventory, TaskAssignment
    |   +-- Relations: CausedBy, Targets, Trusts, LocatedAt
    |
    +-- Systems (run every tick in order)
    |   1. pathfindingSystem  -- advance waypoints, update Position
    |   2. movementSystem     -- interpolate screen coordinates
    |   3. animationSystem    -- advance frame timers
    |   4. renderSyncSystem   -- push ECS state to PixiJS sprites
    |
    +-- useRenderer.ts (PixiJS backend)
        +-- spritePool: AgentSpriteObject[]
        +-- RenderBridge interface (ECS -> PixiJS)
```

## Component Registry

All components defined in `frontend/src/ecs/components.ts`.

### Active Components (wired to systems)

| Component | Fields | Type | Used By |
|-----------|--------|------|---------|
| `Position` | `x`, `y`, `screenX`, `screenY` | f32 | pathfindingSystem, movementSystem, renderSyncSystem |
| `PathState` | `waypointIndex`, `waypointCount`, `progress`, `fromX`, `fromY`, `toX`, `toY` | f32 | pathfindingSystem, movementSystem |
| `AnimState` | `frameIndex`, `elapsed`, `loop`, `animIndex` | f32 | animationSystem, renderSyncSystem |
| `AgentId` | `idIndex` | u32 | useGameWorld (agent ID lookup) |
| `SpriteRef` | `spriteIndex` | u32 | renderSyncSystem |

### Stub Components (defined, not yet wired)

| Component | Fields | Type | Future Use |
|-----------|--------|------|------------|
| `Velocity` | `dx`, `dy` | f32 | Physics/smooth movement |
| `StatusEffect` | `type`, `intensity`, `remaining` | u8/f32 | Status overlay rendering |
| `Mood` | `happiness`, `fear`, `anger` | f32 | GM emotional state |
| `Social` | `influence`, `suspicion` | f32 | Social network |
| `Inventory` | `itemCount` | u32 | Item carrying |
| `TaskAssignment` | `taskIndex`, `progress` | u32/f32 | Task queue |

### Relations

| Relation | Modifier | Purpose |
|----------|----------|---------|
| `CausedBy` | `withAutoRemoveSubject` | Consequence -> aggressor |
| `Targets` | `makeExclusive` | Aggressor -> victim (1:1) |
| `Trusts` | `withStore` | Social trust (carries data) |
| `LocatedAt` | `makeExclusive` | Agent -> location (1:1) |

## System Execution

Systems run in `useGameWorld.ts` tick loop at ~60fps:

```typescript
// In tick callback (called by renderer ticker)
pathfindingSystem(world, dt)   // Advance waypoints, update tile position
movementSystem(world, dt)      // Lerp tile -> screen coordinates
animationSystem(world, dt)     // Advance animation frame timers
renderSyncSystem(world, dt)    // Push to PixiJS sprites via RenderBridge
```

### System Contract

Every system follows this pattern:
```typescript
export function mySystem(world: World, dt: number): void {
  // 1. Query entities with required components
  const entities = query(world, [ComponentA, ComponentB])

  // 2. Iterate and update
  for (const eid of entities) {
    const value = ComponentA.field[eid]
    ComponentB.otherField[eid] = computeNewValue(value, dt)
  }

  // 3. Optional: remove components when done
  if (isDone) {
    removeComponent(world, eid, ComponentA)
  }
}
```

### Observer Hooks

Registered in `useGameWorld.ts`:
- `onAdd(PathState)` -> auto-start walk animation
- `onRemove(PathState)` -> fire path-complete callback, stop walk animation
- `onRemove(AnimState)` -> fire animation-complete callback
- `onAdd(StatusEffect)` -> debug log
- `onRemove(StatusEffect)` -> debug log

## Entity Lifecycle

### Spawning an Agent Entity

```typescript
// In useGameWorld.ts
function spawnAgent(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }) {
  const eid = addEntity(world)

  // Register in lookup tables
  const idIndex = agentIdTable.length
  agentIdTable.push(id)
  agentEntityMap.set(id, eid)

  // Set components
  addComponents(world, eid, [Position, AgentId, SpriteRef])
  Position.x[eid] = tile.x
  Position.y[eid] = tile.y
  AgentId.idIndex[eid] = idIndex
  SpriteRef.spriteIndex[eid] = renderBridge.createSprite(id, name, sprite, tile)
}
```

### Moving an Entity Along a Path

```typescript
function moveAgentAlongPath(id: string, path: Array<{x: number; y: number}>, onComplete?: () => void) {
  const eid = agentEntityMap.get(id)
  if (!eid) return

  // Store path data externally (bitECS components are fixed-size)
  setEntityPath(eid, path)

  // Set PathState component - system will advance it
  addComponent(world, eid, PathState)
  PathState.waypointIndex[eid] = 0
  PathState.waypointCount[eid] = path.length
  PathState.progress[eid] = 0
  PathState.fromX[eid] = Position.x[eid]
  PathState.fromY[eid] = Position.y[eid]
  PathState.toX[eid] = path[0].x
  PathState.toY[eid] = path[0].y

  // Store completion callback
  if (onComplete) {
    pendingCallbacks.set(`${id}:path`, onComplete)
  }
}
```

### Playing an Animation

```typescript
function playAction(id: string, animationName: string, onComplete: () => void) {
  const eid = agentEntityMap.get(id)
  if (!eid) return

  const animIndex = registerAnimation(animationName)

  addComponent(world, eid, AnimState)
  AnimState.frameIndex[eid] = 0
  AnimState.elapsed[eid] = 0
  AnimState.loop[eid] = animation.loop ? 1 : 0
  AnimState.animIndex[eid] = animIndex

  pendingCallbacks.set(`${id}:anim`, onComplete)
}
```

## RenderBridge Interface

The bridge between ECS (data) and PixiJS (rendering):

```typescript
interface RenderBridge {
  createSprite(id: string, name: string, sprite: CharacterSprite, tile: {x: number; y: number}): number
  updateSpritePosition(spriteIndex: number, screenX: number, screenY: number): void
  updateSpriteZIndex(spriteIndex: number, y: number): void
  updateSpritePose(spriteIndex: number, poseName: string): void
  removeSprite(spriteIndex: number): void
}
```

## Adding New Features

### Adding a New Component

1. Define in `frontend/src/ecs/components.ts`:
```typescript
export const MyComponent = defineComponent({
  field1: Types.f32,
  field2: Types.u32,
})
```

2. Register in `frontend/src/ecs/world.ts`:
```typescript
registerComponents(world, [/* existing */, MyComponent])
```

3. Create or update a system to use it

### Adding a New System

1. Create `frontend/src/ecs/systems/mySystem.ts`:
```typescript
import { query, World } from 'bitecs'
import { MyComponent, Position } from '../components'

export function mySystem(world: World, dt: number): void {
  const entities = query(world, [MyComponent, Position])
  for (const eid of entities) {
    // Update logic
  }
}
```

2. Add to tick loop in `useGameWorld.ts` (respect execution order):
```typescript
pathfindingSystem(world, dt)
movementSystem(world, dt)
mySystem(world, dt)        // <-- insert based on data dependencies
animationSystem(world, dt)
renderSyncSystem(world, dt) // Always last (reads everything)
```

3. Add observer hooks if needed (onAdd/onRemove lifecycle)

### Adding a New Relation

```typescript
import { createRelation, makeExclusive, withStore } from 'bitecs'

export const MyRelation = createRelation(makeExclusive)
// or with data:
export const MyRelation = createRelation(withStore({ strength: Types.f32 }))
```

Query with: `query(world, [MyRelation(targetEid)])`

## Key Patterns

### External Path Storage
bitECS components are fixed-size SoA. Variable-length data (path waypoints) is stored externally in `Map<number, Array<{x,y}>>` and accessed by entity ID.

### Callback Registry
Completion callbacks for async operations (path following, animation) stored in `Map<string, () => void>` keyed as `"agentId:path"` or `"agentId:anim"`. Fired from observer hooks when components are removed.

### Agent ID Mapping
String agent IDs map to numeric ECS entity IDs via:
- `agentEntityMap: Map<string, number>` (string -> eid)
- `agentIdTable: string[]` (index -> string, stored in `AgentId.idIndex`)

### Demo Mode
Random walk + random animation behavior for idle agents. Each agent gets a setTimeout that picks a random action, plays it through ECS, then schedules the next.

## File Map

```
frontend/src/ecs/
  components.ts          -- All component + relation definitions
  world.ts               -- createGameWorld(), component registration
  systems/
    pathfindingSystem.ts  -- Waypoint advancement
    movementSystem.ts     -- Position interpolation (tile -> screen)
    animationSystem.ts    -- Frame timer advancement
    renderSyncSystem.ts   -- ECS -> PixiJS sprite sync

frontend/src/composables/
  useGameWorld.ts         -- World lifecycle, entity management, tick loop
  useRenderer.ts          -- PixiJS backend, sprite pool, RenderBridge

docs/specs/
  bitecs-entity-component-system.md  -- Full design spec
docs/
  ECS_ROADMAP.md          -- Implementation status + next steps
```

## Testing

- ECS components/systems are pure data + functions -- test without PixiJS mocks
- Spawn entities, set components, run system, assert component values
- Use `jest.useFakeTimers()` for animation/path timing
- No DOM or canvas needed for system-level tests
