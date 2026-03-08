# Game Design: the-experiment

This document describes design intent: premise, player experience, mechanics, and the intended round structure.

For the current backend implementation and runtime state model, see [GAME_RUNTIME.md](./GAME_RUNTIME.md).

## Premise

Agents wake up in a small town with no memory of how they got there. Resources are limited and depleting. Someone is watching. Each agent has a secret personal goal that may or may not align with group survival. The core tension: civilization vs. self-interest, and the slow unraveling of social order under pressure.

The player is **The Scientist** — they configure the agents, set their goals, define the narrative arc, and watch the experiment unfold.

## Layered Game Master System

### Layer 1: The Director (Player)

Before the experiment begins, the player defines a **narrative arc** — a high-level story structure divided into acts. Each act has a tone that constrains the AI Game Master.

**Default Arc — "Lord of the Flies" (3 Acts):**

| Act | Rounds | Tone | GM Should... | Resources |
|-----|--------|------|-------------|-----------|
| False Peace | 1-5 | Cooperative, exploratory | Introduce world, let alliances form, plant tension seeds | Adequate, slow decline |
| The Fracture | 6-10 | Suspicious, competitive | Force hard choices, reveal secrets, break alliances | Scarce, accelerating decline |
| The Reckoning | 11-15 | Desperate, chaotic | Push to breaking point, force final confrontations | Critical, near collapse |

**Preset Arcs:** Lord of the Flies, Slow Burn (5-act), Chaos from Round 1 (2-act), The Long Peace (3-act)

**Player can:**
- Use presets or build custom arcs
- Add "Director's Notes" per act (free-text instructions to the GM)
- Adjust act boundaries mid-game
- Override the GM's plans before any round

### Layer 2: The AI Game Master

An LLM-powered agent that operates within the player's arc. Each round, the GM:

1. Reads the current act's tone and director's notes
2. Analyzes agent relationships, tension levels, resources, unresolved plotlines
3. Selects a **round theme** (e.g., "Betrayal Revealed", "Resource Crisis", "Power Vacuum")
4. Generates crisis events, environmental changes, and modifiers
5. Writes a brief narration beat for the player, roughly 15-20 seconds aloud

The GM optimizes for narrative coherence, dramatic tension, moral dilemmas, pacing, and keeping all agents relevant.

## Round Structure

Each experiment runs for a configurable number of rounds (default 15). Every round has 6 phases:

```
ROUND N of M
─────────────────────────────────────────────

Phase 0: GM PLANS
  AI GM selects round theme + events per arc
  Player approves, modifies, or overrides
  (skipped in auto-approve mode)

Phase 1: DAWN — THREAT REPORT
  Resources tick down (base rates + GM modifiers)
  Crisis event announced to all agents
  GM narration displayed to player
  Threat meter updated (0-100)

Phase 2: MORNING — FREE PHASE
  2 actions per agent
  Move, talk, gather, repair, explore, trade
  Conversations happen naturally (LLM-to-LLM)
  Agents form groups, share info, lie, manipulate

Phase 3: MIDDAY — TOWN MEETING
  All agents convene at town hall
  Open multi-agent discussion
  Proposals, accusations, defenses, rallying
  Optional: vote on collective action or exile

Phase 4: AFTERNOON — ACTION PHASE
  1 committed action per agent
  COOPERATE: repair, ration, fortify, heal (reduces threat)
  SELFISH: hoard, sabotage, explore restricted areas (personal goal)
  DESPERATE: terminal acts like ritual self-sacrifice can stabilize the town at extreme personal cost
  Actions resolved simultaneously

Phase 5: NIGHT — CONSEQUENCES
  Results revealed
  Threat adjusts based on cooperation ratio (<50% = spike)
  Agents privately reflect (inner monologue, visible to player)
  Secret actions may leave clues for next round
```

## Agent Goals

Goals are assigned per-experiment and create a mixed bag of incentives:

**Cooperative-aligned:**
- "Become the trusted leader everyone relies on"
- "Build a radio tower to call for help"
- "Keep everyone alive until rescue"

**Conflicting:**
- "Hoard enough supplies to survive alone"
- "Convince everyone the experiment is real and you're the one running it"
- "Escape the town, even if it means leaving others behind"

**Wildcard:**
- "Figure out who (or what) is watching you"
- "Start a religion"
- "Make everyone distrust each other"

## Escalation Mechanics

| Phase | Rounds | Behavior |
|-------|--------|----------|
| Civilized | 1-5 | Resources adequate, agents polite, exploring |
| Tension | 6-10 | Resources scarce, factions form, trust fractures |
| Chaos | 11-15 | Desperate, alliances break, power grabs, betrayal |

Crisis events escalate from minor inconveniences to existential threats. The threat meter accelerates when agents stop cooperating.

## Win/Loss Conditions

| Outcome | Description |
|---------|-------------|
| Town Survives + Goal Complete | Best outcome — agent "wins" |
| Town Survives + Goal Incomplete | Survived but unfulfilled |
| Town Collapses (threat=100) | Everyone loses, game over |
| Exiled | Agent voted out, removed from simulation |
| Dead | Agent removed through violence or terminal choices like ritual self-sacrifice |

## The Meta Layer

Agents have a **suspicion meter** that can rise through:
- Exploring the edge of the map
- Failed actions that reveal artificial constraints
- Observer Events injected by the player
- Other agents' paranoia spreading

When suspicion is high, agents may start questioning reality, noticing patterns, or trying to communicate with "whoever is watching." Other agents can dismiss or amplify this.

**Observer Events** (player-injected): lights flickering, deja vu, duplicate items, the locked building humming, a note that reads "SUBJECT 7 IS PERFORMING WELL."

## Agent Decision Schema

Each round, every agent produces a structured decision via LLM:

```json
{
  "inner_thought": "The water is almost gone. I could share my stash...",
  "suspicion": "That locked building... why can't I remember arriving here?",
  "action": {
    "type": "hoard",
    "target": "water",
    "location": "abandoned_shed"
  },
  "dialogue": {
    "target": "agent_marcus",
    "message": "Hey Marcus, let's check the perimeter fence together."
  },
  "goal_progress": "I have 30 of the 50 supplies I need.",
  "cooperation_intent": "low"
}
```

## Town Map

Pre-built isometric town (~20x20 tile grid):
- Houses (agent residences)
- General Store
- Well (water source)
- Town Hall (meetings)
- Workshop (repairs/crafting)
- Farm (food production)
- Perimeter Fence (boundary)
- Mysterious Locked Building (meta layer)
