# Frontend Architecture Decisions

## 1. State Management — Domain Pinia Stores

**Decision:** Use multiple domain-specific Pinia stores, not one monolith.

```
stores/
├── experimentStore.ts    # Experiment config, status, current round
├── agentStore.ts         # All agent state: positions, goals, memories, relationships
├── worldStore.ts         # Map, locations, resources, threat meter
├── gmStore.ts            # GM plans, narration, arc state, current act
├── socialStore.ts        # Conversations, meetings, votes in progress
└── uiStore.ts            # Selected agent, active panel, camera position, playback speed
```

**Rules:**
- Stores own their domain. `agentStore` is the single source of truth for agent data.
- Stores can read from other stores (`const world = useWorldStore()`), but should not write to them directly.
- Cross-store coordination happens through **actions**, not getters reaching into other stores.
- WebSocket messages are routed to the appropriate store via a central `useWebSocket` composable.
- Each store exposes: `state` (reactive), `getters` (computed), `actions` (methods).
- UI store is the only store that doesn't persist to the backend — it's purely local.

**Why not a single store:** The experiment has 5-6 distinct data domains that change independently. A god store would be impossible to reason about during a live simulation.

---

## 2. PixiJS ↔ Vue Integration — Composable Bridge

**Decision:** PixiJS runs in its own rendering loop inside a Vue component wrapper. Communication goes through a `usePixiWorld` composable that bridges reactive Vue state into imperative PixiJS calls.

```
┌──────────────────────────────────────────────┐
│  Vue Layer (Reactive)                        │
│  ┌────────┐  ┌─────────┐  ┌──────────────┐  │
│  │ Stores │  │ Panels  │  │ Overlays/HUD │  │
│  └───┬────┘  └─────────┘  └──────────────┘  │
│      │                                       │
│  ┌───▼──────────────────────────────────┐    │
│  │  usePixiWorld() composable           │    │
│  │  - watches store changes             │    │
│  │  - calls PixiJS scene methods        │    │
│  │  - emits events back to Vue          │    │
│  └───┬──────────────────────────────────┘    │
│      │                                       │
│  ┌───▼──────────────────────────────────┐    │
│  │  <PixiCanvas /> component            │    │
│  │  - owns the PIXI.Application         │    │
│  │  - mounts/unmounts on lifecycle       │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  PixiJS Layer (Imperative)           │    │
│  │  ┌───────────┐ ┌───────────────────┐ │    │
│  │  │ TileMap   │ │ AgentSprites      │ │    │
│  │  │ renderer  │ │ (move, animate)   │ │    │
│  │  └───────────┘ └───────────────────┘ │    │
│  │  ┌───────────┐ ┌───────────────────┐ │    │
│  │  │ Camera    │ │ Effects           │ │    │
│  │  │ controls  │ │ (day/night, fog)  │ │    │
│  │  └───────────┘ └───────────────────┘ │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

**Rules:**
- Vue never directly manipulates PIXI display objects.
- PixiJS never reads Pinia stores directly.
- The `usePixiWorld` composable is the **only** bridge. It uses `watch()` on store state and calls scene methods.
- Click events on PixiJS sprites emit through the composable back to Vue (e.g., agent clicked → `uiStore.selectAgent(id)`).
- PixiJS scene classes are pure — they take data in, render pixels out. No business logic.

**Why:** Mixing reactive and imperative paradigms directly creates memory leaks and update storms. The composable bridge keeps them cleanly separated.

---

## 3. WebSocket Architecture — Central Composable + Store Router

**Decision:** A single `useWebSocket` composable manages the connection. Incoming messages are routed to stores by message type.

```typescript
// composables/useWebSocket.ts
const messageRouter: Record<string, (data: any) => void> = {
  'round_start':      (d) => experimentStore.onRoundStart(d),
  'round_end':        (d) => experimentStore.onRoundEnd(d),
  'phase_change':     (d) => experimentStore.onPhaseChange(d),
  'gm_plan':          (d) => gmStore.onPlan(d),
  'gm_narration':     (d) => gmStore.onNarration(d),
  'agent_action':     (d) => agentStore.onAction(d),
  'agent_speak':      (d) => socialStore.onSpeak(d),
  'crisis_event':     (d) => worldStore.onCrisis(d),
  'threat_update':    (d) => worldStore.onThreatUpdate(d),
  'resource_update':  (d) => worldStore.onResourceUpdate(d),
  'meeting_start':    (d) => socialStore.onMeetingStart(d),
  'meeting_speech':   (d) => socialStore.onMeetingSpeech(d),
  'meeting_vote':     (d) => socialStore.onMeetingVote(d),
  'meeting_result':   (d) => socialStore.onMeetingResult(d),
  'observer_event':   (d) => worldStore.onObserverEvent(d),
  'experiment_end':   (d) => experimentStore.onEnd(d),
}
```

`agent_action` is the only mid-round agent activity message. Location changes now come through
`agent_action.data.action.location`; the final authoritative state still arrives in `round_end`.

**Rules:**
- One WebSocket connection per experiment session.
- Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s).
- Connection state exposed as reactive ref: `'connecting' | 'connected' | 'disconnected'`.
- Messages are validated against `shared/schemas/ws_message.json` before routing.
- Outbound messages (approve GM plan, inject event) go through store actions that call `ws.send()`.
- During reconnect, the composable requests a full state snapshot from the backend to resync.

**Why:** Centralizing the socket prevents multiple connections, makes reconnection reliable, and keeps stores focused on their domain rather than socket plumbing.

---

## 4. Component Structure — Feature Folders + Ant Design Boundaries

**Decision:** Components organized by feature, not type. Ant Design used for all standard UI. Custom components only for game-specific rendering.

```
components/
├── setup/                  # S1.2 — Experiment configuration
│   ├── AgentConfigurator.vue
│   ├── ArcSelector.vue
│   └── ParameterControls.vue
│
├── world/                  # S1.3, S1.4 — PixiJS isometric world
│   ├── PixiCanvas.vue         # Mounts PIXI.Application
│   ├── WorldOverlay.vue       # HTML overlays on top of canvas (speech bubbles, labels)
│   └── pixi/                  # Pure PixiJS classes (no Vue)
│       ├── IsometricScene.ts
│       ├── TileMap.ts
│       ├── AgentSprite.ts
│       ├── Camera.ts
│       └── Effects.ts
│
├── hud/                    # S1.5 — Game UI panels
│   ├── ControlBar.vue
│   ├── ThreatMeter.vue
│   ├── ResourceBars.vue
│   ├── ArcTimeline.vue
│   ├── GMPlanPanel.vue
│   └── NarrationOverlay.vue
│
├── dossier/                # S1.6 — Agent inspection
│   └── AgentDossier.vue
│
├── social/                 # S1.7 — Meetings, conversations
│   ├── TownMeeting.vue
│   └── ConversationBubble.vue
│
├── log/                    # S1.8 — Event log, post-game
│   ├── ExperimentLog.vue
│   └── PostGameReport.vue
│
└── ui/                     # Game-specific custom components only
    └── GlitchText.vue
```

**Ant Design usage boundaries:**
- **USE Ant for:** Buttons, inputs, selects, sliders, tags, cards, collapse, modals, tooltips, badges, progress bars, tables, tabs, drawers, notifications, dropdowns, space, flex, grid, typography.
- **DON'T use Ant for:** PixiJS rendering, game-specific visualizations (threat meter, arc timeline, narration overlay), anything that needs custom animation beyond what Ant provides.
- **Override Ant styles** through our `main.css` dark theme overrides, never inline `!important` in components.

**Rules:**
- Every component is a single `.vue` file unless it has a PixiJS counterpart.
- PixiJS classes in `components/world/pixi/` are pure TypeScript — no `.vue`, no Vue imports.
- Feature folders map 1:1 to tickets (setup = S1.2, world = S1.3+S1.4, etc.).
- Shared composables live in `composables/`, shared types in `types/`.

---

## 5. Animation Strategy — Right Tool for the Job

**Decision:** Three animation systems, each with a clear domain.

| System | Use For | Examples |
|--------|---------|---------|
| **CSS/Tailwind** | UI transitions, hover states, simple enters/exits | Panel slide-in, button hover glow, fade transitions between routes |
| **GSAP** | Orchestrated sequences, complex timelines, scroll-based | Boot sequence, narration typewriter, post-game reveal, round transition cinematics |
| **PixiJS Ticker** | Anything on the canvas — sprite movement, particle effects, camera | Agent walking, day/night cycle, fog, building damage, tile shimmer |

**Rules:**
- **CSS first.** If it can be done with `transition` or `@keyframes`, do it in CSS/Tailwind. No GSAP for a simple fade.
- **GSAP for orchestration.** When you need to chain multiple animations with precise timing, use GSAP `gsap.timeline()`. Clean up in `onUnmounted`.
- **PixiJS Ticker for canvas.** All canvas animation runs on `app.ticker`. Never use `requestAnimationFrame` manually alongside PixiJS.
- **Performance budget:** Target 60fps on the canvas. UI animations should never block the main thread. Use `will-change` sparingly.
- **Reduced motion:** Respect `prefers-reduced-motion`. GSAP and CSS animations should check this. PixiJS can reduce particle counts.

```typescript
// Example: GSAP cleanup pattern
onMounted(() => {
  const tl = gsap.timeline()
  tl.from('.panel', { y: 20, opacity: 0, stagger: 0.1 })

  onUnmounted(() => tl.kill())
})
```

**GSAP + PixiJS hybrid pattern (day/night cycle):**

The day/night cycle uses both GSAP and PixiJS Ticker together. GSAP drives finite-duration phase transitions (arc movement, brightness, sky color crossfade) while the ticker handles continuous per-frame effects (star twinkle, corona shimmer). All GSAP tweens are tracked in an `activeTweens[]` array and killed on phase change or destroy.

```typescript
// Pattern: track all tweens, kill on next transition
private activeTweens: (gsap.core.Tween | gsap.core.Timeline)[] = []

setPhase(phase) {
  // Kill all in-progress tweens first
  for (const tween of this.activeTweens) tween.kill()
  this.activeTweens = []

  // Create new tweens, push each to tracking array
  this.activeTweens.push(gsap.to(target, { ... }))
}

destroy() {
  for (const tween of this.activeTweens) tween.kill()
  gsap.killTweensOf(this.sunContainer) // belt-and-suspenders
}
```

---

## 6. Day/Night Cycle — Phase-Driven Visual System

**Decision:** Game phases drive visual changes through a dedicated `DayNightCycle` class that renders on `app.stage` (screen-space, camera-independent).

**Data flow:**
```
WebSocket phase_change → experimentStore.currentPhase
  → SimulationView watcher → pixiWorldRef.setPhase(phase)
    → usePixiWorld.setPhase → DayNightCycle.setPhase(phase)
```

**Layer architecture:**
```
app.stage
  ├─ skyGraphics (z=-1)         FillGradient rect, full viewport
  ├─ worldContainer (z=0)       Camera-affected (map, agents, ambient)
  │   └─ [ColorMatrixFilter]    Brightness tinting per phase
  └─ celestialContainer (z=1)   Screen-space sun/moon/stars/shadow
```

**Key design choices:**
- **Screen-space celestials.** Sun, moon, stars, and sky don't move with camera pan/zoom — they're on `app.stage`, not `worldContainer`.
- **ColorMatrixFilter on worldContainer.** Night dims everything including agents and buildings. Filter is appended in constructor, removed in `destroy()`.
- **Config-driven palettes.** `config/day-night-palettes.ts` is pure data — per-theme colors, brightness, and visibility for each phase. The renderer reads palettes, never hardcodes colors.
- **`gm_plan` is a no-op.** It's a meta-phase (GM planning), not in-world time. Inherits the previous visual state.
- **MotionPathPlugin for sun arc.** A paused tween defines the bezier path; GSAP tweens the `progress` property to jump to any arc position. Handles arbitrary phase jumps (e.g., dawn→afternoon) correctly.
- **Demo mode.** Auto-cycles through dawn→morning→midday→afternoon→night every 10s via ticker timer.

**Files:** `config/day-night-palettes.ts` (data), `pixi/DayNightCycle.ts` (renderer), `composables/usePixiWorld.ts` (bridge), `views/SimulationView.vue` (watcher).

---

## 7. State Ownership — Pinia vs ECS vs PixiJS

**Decision:** Three distinct state domains with a one-directional bridge.

| Domain | Owns | Examples |
|--------|------|----------|
| **Pinia stores** | Episodic game state driven by backend | Agent identity, personality, relationships, inventory, suspicion, resources, turn sequencing, experiment config |
| **ECS (bitECS)** | Per-frame simulation state | Position interpolation, animation frames, water tile animation, path progress; future: buildings, weather, hazards |
| **PixiJS (useRenderer)** | GPU resources and display tree | Sprite objects, tilemap, camera, ambient overlay, day/night cycle, tile atlas textures |

**Bridge rules:**
- `GameSession` is the one-directional bridge: Pinia → ECS. Stores push state into the ECS world via `spawnAgent()`, `moveAgentAlongPath()`, `playAction()`, etc.
- Callbacks flow back as **timing signals only** (e.g., "movement complete", "animation done"), never state. The callback tells the turn store to advance, not what position the agent is at.
- `renderSyncSystem` is the ECS → PixiJS bridge, operating through the `RenderBridge` interface. It pushes position, animation pose, and tile texture state into the renderer each frame.
- PixiJS never reads Pinia stores. ECS systems never import Vue.

**GameSession lifecycle:**
- `GameSession` owns all non-Vue state: bitECS world, entity registries, pending callbacks, tile frame tracking, performance monitor, fixed-timestep accumulator.
- `useGameWorld()` is a thin Vue composable wrapper that delegates to `GameSession`, preserving the public API.
- Session token pattern: every async callback captures `sessionId` at creation. Before executing, it checks `isActive`. If the session has been disposed, the callback is silently discarded.
- `dispose()` tears down in deterministic order: stop timers → clear callbacks → destroy entities → destroy renderer → null references.

**Stub components** (Mood, Social, Inventory) are defined in ECS for future use as rendering hooks — e.g., angry sprite tint from Mood data. Pinia remains the authoritative source for these values; the ECS components are write-targets for visual effects, not state of record.

**Guidance for Phases 2-7:**
- `BuildingState` → ECS component (tiles with visual state changes)
- `WeatherData` → plain object in GameSession (drives ambient overlay, not per-entity)
- `HazardState` → ECS component (per-tile hazard state with visual effects)
- Domain-specific bridges (BuildingBridge, WeatherBridge) should be built when those systems are implemented, following the same `RenderBridge` pattern.
