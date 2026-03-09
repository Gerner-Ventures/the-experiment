# Frontend State Architecture

This document describes how the frontend manages state through Pinia domain stores,
how WebSocket messages flow from the server into those stores, and how stores
coordinate with each other and the PixiJS rendering layer.

All file paths are relative to the repository root.

---

## 1. Overview

The frontend uses **7 Pinia stores** organized by domain. Each store owns a
slice of application state and exposes reactive refs, computed getters, and
action methods. Stores never write directly to another store's state -- they
call the target store's actions when cross-store updates are needed.

A central `useWebSocket` composable manages the single WebSocket connection and
routes incoming messages to the correct store handler. The `SimulationView`
component (`frontend/src/views/SimulationView.vue`) orchestrates initialization,
wires turn handlers that bridge PixiJS and Vue, and manages the auto-play loop.

```
                           WebSocket
                              |
                     useWebSocket composable
                      (routeMessage)
                              |
        +-----------+---------+---------+----------+----------+
        |           |         |         |          |          |
   experiment    agent      world      gm       social      ui
     Store       Store      Store     Store      Store      Store
        |           |         |         |          |
        +--------+--+---------+---------+----------+
                 |                        |
            turn Store  <----------  (enqueue)
                 |
         TurnHandlers (bridge)
                 |
        PixiWorld (canvas)
```

---

## 2. Store Ownership Matrix

| Store | File | Owns | Key Responsibilities |
|-------|------|------|---------------------|
| **experiment** | `frontend/src/stores/experiment.ts` | Experiment id, name, status, currentRound, totalRounds, currentPhase, completedRounds, events log | Tracks experiment lifecycle (setup -> running -> completed/collapsed). Handles round_start, round_end, phase_change, experiment_end. Coordinates readiness gating between turn queue drain and meeting dismissal via `waitForReady`. |
| **agent** | `frontend/src/stores/agent.ts` | Agent map (id -> Agent), derived agentList, agentConfigs | Single source of truth for agent data. Parses backend snake_case into TS interfaces. Handles agent_action by enqueuing turns. Provides `agentConfigs` computed for PixiWorld rendering. |
| **world** | `frontend/src/stores/world.ts` | resources (food, water, materials, power), threatLevel, currentPhase, activeCrisis | Handles resource_update, threat_update, crisis_event. Provides derived `threatColor` and `isCollapsing`. Phase is also tracked here (mirrored from experiment store) for the day/night rendering pipeline. |
| **gm** | `frontend/src/stores/gm.ts` | currentPlan, narration text/audio state, plan approval state | Handles gm_plan, gm_narration, gm_audio_status. Manages narration identity tracking and TTS audio status (pending/ready/error/unavailable). Supports audio hydration for reconnect scenarios. |
| **social** | `frontend/src/stores/social.ts` | conversations[], meeting state (proposal, speeches, votes, result, scenePhase), factionUpdates[], exileEvents[] | Handles agent_speak, agent_speech_audio, meeting_start/speech/vote/result, faction_update, cult_activity, exile_vote/result. Meeting speeches and votes are enqueued into the turn store for sequenced animation. |
| **turn** | `frontend/src/stores/turn.ts` | Turn queue, activeTurn, phase (idle/thinking/moving/acting/hud-only) | Sequences agent actions through phases: thought bubble -> movement -> action animation -> HUD display. Bridges Vue and PixiJS via externally-set `TurnHandlers`. Fires drain callbacks when queue empties. |
| **ui** | `frontend/src/stores/ui.ts` | selectedAgentId, activePanel, playbackSpeed, isPlaying, isStepping, steppingStatus, showNarration | Purely local UI state -- not persisted to backend. Controls which panel is open (dossier, log, gm-plan, meeting, relationship-web). Manages stepping status text shown in the HUD control bar. |

---

## 3. WebSocket Message Routing

### Connection lifecycle

`useWebSocket` (`frontend/src/composables/useWebSocket.ts`) wraps a single
`WebSocket` instance. It exposes a reactive `state` ref
(`connecting | connected | disconnected`) and auto-reconnects with exponential
backoff (1s, 2s, 4s, ... max 30s).

`SimulationView.onMounted` calls `ws.connect(url)` after loading the experiment
via REST. On unmount, it calls `ws.disconnect()`.

### Message envelope

Every message conforms to `shared/schemas/ws_message.json`:

```typescript
interface WSMessage<T = Record<string, unknown>> {
  type: WSMessageType   // e.g. "agent_action"
  round: number
  phase?: RoundPhase    // "gm_plan" | "dawn" | "morning" | "midday" | "afternoon" | "night"
  timestamp: string     // ISO 8601
  data: T
}
```

### Routing table

The `routeMessage` function in `useWebSocket.ts` dispatches every incoming
message. Every message is also logged to `experimentStore.addEvent(msg)` first.

| Message Type | Target Store | Handler | Effect |
|---|---|---|---|
| `connected` | -- | no-op | Connection confirmed |
| `round_start` | experiment | `onRoundStart(msg)` | Sets currentRound, status -> running, clears phase, updates HUD |
| `round_end` | experiment | `onRoundEnd(msg)` | Syncs round/status, pushes resources and threat to world store, defers agent sync and round finalization via `waitForReady` |
| `phase_change` | experiment | `onPhaseChange(msg)` | Updates currentPhase, forwards to world store `onPhaseChange`, updates HUD label (deferred if meeting active) |
| `gm_plan` | gm | `onPlan(msg)` | Parses plan, sets narration fallback, shows plan panel |
| `gm_narration` | gm | `onNarration(msg)` | Legacy handler -- sets narration text |
| `gm_audio_status` | gm | `onAudioStatus(msg)` | Updates narration TTS audio status (pending/ready/error) |
| `agent_action` | agent | `onAction(msg)` | Parses action type, location, thought; enqueues a Turn into turn store |
| `agent_speak` | social | `onSpeak(msg)` | Adds conversation entry (dialogue or inner_thought) |
| `agent_speech_audio` | social | `onSpeechAudio(msg)` | Matches audio URL/status to existing conversation entry by agent+round+index |
| `crisis_event` | world | `onCrisis(msg)` | Sets activeCrisis with type, description, severity |
| `threat_update` | world | `onThreatUpdate(msg)` | Updates threatLevel |
| `resource_update` | world | `onResourceUpdate(msg)` | Updates food, water, materials, power |
| `meeting_start` | social | `onMeetingStart(msg)` | Initializes meeting state (active=true, scenePhase=entering) |
| `meeting_speech` | social | `onMeetingSpeech(msg)` | Buffers speech into meeting state, enqueues as turn for sequenced animation |
| `meeting_vote` | social | `onMeetingVote(msg)` | Records vote in meeting state, enqueues as turn |
| `meeting_result` | social | `onMeetingResult(msg)` | Sets result summary, tally, passed flag |
| `faction_update` | social | `onFactionUpdate(msg)` | Appends to factionUpdates array |
| `cult_activity` | social | `onCultActivity(msg)` | Appends to factionUpdates with type=cult_activity |
| `exile_vote` | social | `onExileVote(msg)` | Appends to exileEvents |
| `exile_result` | social | `onExileResult(msg)` | Appends to exileEvents, transitions meeting to exile phase if applicable |
| `experiment_end` | experiment | `onEnd(msg)` | Sets status to completed/collapsed, clears stepping |
| `step_error` | ui | `clearStepping()` | Clears stepping indicator |

---

## 4. Store Communication Patterns

### Cross-store reads (store A calls into store B)

```
experiment  --->  world       onRoundEnd: sets threat level and resources
experiment  --->  agent       onRoundEnd (deferred): setAgents with end-of-round snapshot
experiment  --->  ui          onRoundStart/onRoundEnd/onPhaseChange: updates stepping status
experiment  --->  turn        waitForReady: checks isProcessing, registers onDrained callback
experiment  --->  social      waitForReady/onPhaseChange: checks isMeetingActive

agent       --->  turn        onAction: enqueues a Turn

social      --->  turn        onMeetingSpeech/onMeetingVote: enqueues turns

turn        --->  ui          processNext: updates stepping status text
```

### The TurnHandlers bridge

The turn store cannot directly call PixiJS (the architecture forbids it). Instead,
`SimulationView` sets external handler functions on the turn store at mount time:

```typescript
// SimulationView.wireTurnHandlers()
turnStore.setHandlers({
  move(agentId, location, onComplete)       // -> pixiWorld.moveAgentToLocation
  playAction(agentId, animationName, onComplete) // -> pixiWorld.playAction
  updateAgent(agentId, status, location)    // -> agentStore.updateAgentStatus
  addConversation(agentId, name, msg, ...)  // -> socialStore.addConversation
  getAgentLocation(agentId)                 // -> agentStore.getAgent(id)?.location
})
```

This keeps the turn store as a pure queue/sequencer without any rendering knowledge.

### The waitForReady gate

When `round_end` or `phase_change` arrives, the experiment store uses `waitForReady`
to defer finalization until two conditions are met:

1. The turn queue has fully drained (`turnStore.isProcessing === false`)
2. No meeting overlay is active (`socialStore.isMeetingActive === false`)

This prevents phases from advancing or agents from being bulk-updated while
animations are still playing or a meeting scene is on screen.

---

## 5. State Lifecycle

### Initialization (experiment launch)

```
SetupView creates experiment via REST API
  -> navigates to /simulation/:id

SimulationView.onMounted()
  -> api.getExperiment(id)
  -> experimentStore.setExperiment({id, name, status, currentRound, totalRounds})
  -> agentStore.setAgents(detail.agents)
  -> worldStore.setResources(...) / setThreatLevel(...)
  -> ws.connect(wsUrl)
  -> wireTurnHandlers()              // bridge turn store <-> PixiWorld
  -> replay currentPhase into PixiWorld (if already set)
```

### During simulation (round processing)

```
User clicks Step (or auto-play triggers)
  -> api.stepRound(id)               // POST to backend
  -> uiStore.startStepping(...)

Backend streams WS messages:
  round_start -> phase_change (gm_plan) -> gm_plan
    -> phase_change (dawn) -> agent_action* -> agent_speak*
    -> phase_change (morning) -> agent_action* -> ...
    -> ... (midday, afternoon, night phases)
    -> round_end

Each agent_action enqueues a Turn -> turn store processes sequentially:
  thinking phase (speech bubble + audio)
    -> moving phase (pathfinding animation)
    -> acting phase (sprite animation + minimum duration gate)
    -> hud-only phase (brief status display)
    -> next turn

round_end deferred via waitForReady:
  -> syncs final agent state from backend
  -> increments completedRounds
  -> clears stepping status
```

### Teardown (unmount / navigation away)

```
SimulationView.onUnmounted()
  -> ws.disconnect()
  -> clear auto-play timer
  -> $reset() on ALL 7 stores (experiment, agent, world, gm, ui, social, turn)
```

Every store's `$reset()` returns state to initial values and clears timers/handlers.

---

## 6. Key Computed Properties

| Store | Property | Type | Description |
|-------|----------|------|-------------|
| experiment | `isRunning` | boolean | `status === 'running'` |
| experiment | `isComplete` | boolean | `status === 'completed' \|\| status === 'collapsed'` |
| experiment | `progress` | number | `currentRound / totalRounds` (0 to 1) |
| agent | `agentList` | Agent[] | Array view of the agents Map |
| agent | `agentCount` | number | Size of agents Map |
| agent | `agentConfigs` | AgentConfig[] | Agents mapped to PixiWorld rendering format |
| world | `threatColor` | string | CSS hex color based on threat level thresholds (green/yellow/orange/red) |
| world | `isCollapsing` | boolean | `threatLevel >= 80` |
| social | `recentConversations` | ConversationMessage[] | Last 20 conversation entries |
| social | `isMeetingActive` | boolean | `meeting?.active ?? false` |
| turn | `isProcessing` | boolean | `activeTurn !== null \|\| queue.length > 0` |
| turn | `hasPendingTurns` | boolean | `queue.length > 0` |
| ui | `hasSelectedAgent` | boolean | `selectedAgentId !== null` |

---

## 7. Example Flows

### 7.1 How does a meeting_speech message flow from WebSocket to UI?

```
1. WebSocket receives: { type: "meeting_speech", round: 3, data: { agent_id: "a1", agent_name: "Marcus", content: "We must ration food.", stance: "support" } }

2. useWebSocket.routeMessage()
   -> experimentStore.addEvent(msg)             // logged to event timeline
   -> socialStore.onMeetingSpeech(msg)           // routed by type

3. socialStore.onMeetingSpeech()
   -> Pushes speech into meeting.speeches[]     // buffered for MeetingScene panel
   -> useTurnStore().enqueue({                  // creates a Turn
        agentId: "a1",
        agentName: "Marcus",
        actionType: "meeting_speech",
        thought: "We must ration food.",
        thoughtSource: "dialogue",
      })

4. turnStore.enqueue()
   -> Pushes Turn onto queue
   -> If no activeTurn, calls processNext()

5. turnStore.processNext()
   -> Sets activeTurn, phase = "thinking"
   -> Calls handlers.updateAgent("a1", "talking")  // sets agent status
   -> Calls handlers.addConversation(...)           // adds to socialStore.conversations
   -> Shows thought bubble via ConversationBubble component

6. SimulationView template reacts:
   -> MeetingScene renders (isMeetingActive === true)
   -> MeetingScene receives activeTurn + turnPhase as props
   -> Speech bubble appears over the meeting scene

7. Audio completes (or bubble dismissed)
   -> turnStore.notifyAudioComplete() / onBubbleDismissed()
   -> completeThoughtPhase() -> startMovementPhase()
   -> SPEECH_ONLY_ACTIONS matches "meeting_speech" -> completeTurnPhase()
   -> finishTurn() -> scheduleNext()
```

### 7.2 How does an agent_action message update the world?

```
1. WebSocket receives: { type: "agent_action", round: 2, data: { agent_id: "a3", agent_name: "Lena", action: { type: "gather", location: "forest_clearing" }, inner_thought: "I need to find food before nightfall." } }

2. useWebSocket.routeMessage()
   -> experimentStore.addEvent(msg)
   -> agentStore.onAction(msg)

3. agentStore.onAction()
   -> Parses actionType = "gather", targetLocation = "forest_clearing"
   -> Extracts thought = "I need to find food before nightfall."
   -> useTurnStore().enqueue({
        agentId: "a3", agentName: "Lena", round: 2,
        actionType: "gather", targetLocation: "forest_clearing",
        thought: "I need to find food before nightfall.",
        thoughtSource: "inner_thought",
      })

4. turnStore processes the Turn through phases:

   a) THINKING: phase = "thinking"
      -> handlers.updateAgent("a3", "thinking")         // agentStore.updateAgentStatus
      -> handlers.addConversation("a3", "Lena", ...)     // socialStore.addConversation
      -> ConversationBubble renders above agent sprite
      -> Waits for audio playback or bubble dismiss

   b) MOVING: phase = "moving"
      -> handlers.getAgentLocation("a3") returns current location
      -> If different from "forest_clearing":
         handlers.move("a3", "forest_clearing", onComplete)
         -> PixiWorld pathfinds and animates sprite walk
         -> onComplete fires -> handlers.updateAgent("a3", "working", "forest_clearing")

   c) ACTING: phase = "acting"
      -> ACTION_TO_ANIMATION["gather"] returns animation name
      -> handlers.playAction("a3", animName, onComplete)
      -> PixiWorld plays gather sprite animation
      -> Dual gate: both animation AND 1500ms minimum must complete

   d) FINISH:
      -> handlers.updateAgent("a3", "idle")
      -> scheduleNext() with 400ms gap
```

### 7.3 How does experiment state transition from setup to running?

```
1. SetupView: user configures agents and clicks "Launch"
   -> api.createExperiment(payload)
   -> Receives ExperimentDetail with status="setup"
   -> Stores experiment_id in route params
   -> Navigates to /simulation/:id

2. SimulationView.onMounted()
   -> api.getExperiment(id) returns status="setup"
   -> experimentStore.setExperiment({status: "setup", currentRound: 0, ...})
   -> agentStore.setAgents(agents)
   -> worldStore.setResources/setThreatLevel
   -> ws.connect(wsUrl)

3. User clicks "Step" button
   -> handleStep() -> uiStore.startStepping("Running...")
   -> api.stepRound(id)  // POST

4. Backend begins processing. WebSocket delivers:
   -> { type: "round_start", round: 1, data: {} }
   -> experimentStore.onRoundStart():
      - currentRound = 1
      - currentPhase = null
      - status = "running"             // <-- transition happens here
      - HUD shows "Round 1 started"

5. Backend streams phase_change, agent_action, agent_speak messages...

6. Backend sends round_end:
   -> experimentStore.onRoundEnd():
      - Updates currentRound, totalRounds, status from data
      - Syncs resources and threat to world store immediately
      - Defers agent snapshot sync via waitForReady
      - When turns drain AND meeting closes:
        - agentStore.setAgents(data.agents)  // authoritative end-of-round state
        - completedRounds++
        - uiStore.clearStepping()

7. If auto-play is active:
   -> watch(completedRounds) fires
   -> Waits delay (3000ms / playbackSpeed)
   -> Calls autoStep() -> handleStep() for next round

8. On experiment_end:
   -> experimentStore.onEnd(): status = "completed"
   -> watch(isComplete) fires -> router.push to ReportView
```

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `frontend/src/stores/experiment.ts` | Experiment lifecycle store |
| `frontend/src/stores/agent.ts` | Agent data store |
| `frontend/src/stores/world.ts` | World resources, threat, crisis store |
| `frontend/src/stores/gm.ts` | GM plan and narration store |
| `frontend/src/stores/social.ts` | Conversations and meeting store |
| `frontend/src/stores/turn.ts` | Turn queue and sequencing store |
| `frontend/src/stores/ui.ts` | UI-only local state store |
| `frontend/src/composables/useWebSocket.ts` | WebSocket connection and message router |
| `frontend/src/services/api.ts` | REST API client |
| `frontend/src/types/websocket.ts` | WSMessage, WSMessageType, RoundPhase types |
| `frontend/src/views/SimulationView.vue` | Orchestrator: init, handler wiring, auto-play |
| `shared/schemas/ws_message.json` | Canonical WebSocket message schema |
| `docs/ARCHITECTURE.md` | High-level architecture decisions |
