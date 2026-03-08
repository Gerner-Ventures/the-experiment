# Backend Action Catalog

This document is the source of truth for how backend action configuration is modeled today: where
it lives, what it owns, what it does not own, and how to safely change it.

## Scope

The backend action catalog covers static action metadata and static rule tables. It exists so the
backend does not have to redefine the same action information in the schema layer, agent logic,
engine checks, analytics, highlights, and reporting code.

The catalog currently owns:

- the full set of backend action ids
- decision vs consequence partitioning
- action category and description
- `requires_target` and `requires_location`
- static action tags such as `cooperative`, `hostile`, `interaction`, `ranged`, `sabotage`,
  `terminal`, and `mock_cooperative`
- allowed location-type constraints for specific actions
- hostile-action consequence pools
- consequence suspicion deltas

The catalog does not own procedural runtime behavior such as:

- movement execution and rerouting
- resource effects
- memory writes
- conflict resolution
- event-log assembly
- websocket broadcasting

Those behaviors still live in the engine/runtime code and only read their static inputs from the
catalog.

## Code Ownership

Primary files:

- `backend/app/actions/models.py`
- `backend/app/actions/catalog.py`
- `backend/app/actions/__init__.py`

Important exported concepts:

- `ActionSpec`: one immutable action definition
- `ACTION_SPECS`: ordered list of canonical backend action definitions
- `ACTION_CATALOG`: lookup by action id
- `DECISION_ACTION_IDS`
- `CONSEQUENCE_ACTION_IDS`
- tag-derived groupings such as `COOPERATIVE_ACTION_IDS`, `HOSTILE_ACTION_IDS`, and
  `SABOTAGE_ACTION_IDS`
- rule maps such as `ACTION_ALLOWED_LOCATION_TYPES`, `ACTION_CONSEQUENCE_POOLS`, and
  `CONSEQUENCE_SUSPICION_DELTAS`

## Current Data Model

Each `ActionSpec` defines:

- `id`: stable wire/runtime string
- `kind`: `decision` or `consequence`
- `category`: current action category used by agent-facing metadata
- `description`: human-readable explanation
- `requires_target`
- `requires_location`
- `tags`: reusable backend group membership
- `allowed_location_types`: optional location-type allowlist
- `interaction_range`: optional range override for interaction actions
- `consequence_pool`: optional generated consequence ids for decision actions
- `suspicion_delta`: optional consequence-only suspicion delta

Design rule: if a value is a static lookup that multiple backend consumers need, prefer putting it
in the catalog instead of adding another hardcoded set elsewhere.

## Backend Consumers

The catalog is intended to be the backend source of truth for:

- schema/action-id lists in `backend/app/schemas/agent_decision.py`
- direct action metadata lookups via `app.actions.get_action(...)`
- prompt/decision helpers that need the decision action set
- engine checks in `backend/app/engine/service.py`
- report and analytics grouping in `backend/app/api/runtime.py`
- highlight classification in `backend/app/highlights/selector.py`
- headless reporting in `backend/app/headless/reporting.py`
- seeded mock-agent behavior in `backend/app/agents/mock_brain.py`

If you need a new static grouping, add it to the catalog and derive it from tags or structured
fields rather than defining it ad hoc in a consumer.

## How To Change An Action

When adding or editing an action:

1. Update the canonical spec in `backend/app/actions/catalog.py`.
2. Decide whether the action is a decision or consequence action.
3. Add or adjust tags if analytics, highlighting, mock behavior, or engine grouping should treat it
   specially.
4. Add or adjust `allowed_location_types`, `interaction_range`, `consequence_pool`, or
   `suspicion_delta` only if the behavior is a static lookup.
5. Update engine/runtime procedural code only if the action changes actual resolution logic rather
   than metadata.
6. Update docs when the backend action model or contributor workflow meaningfully changes.

## Testing Expectations

Relevant tests:

- `backend/tests/test_action_catalog.py`
- `backend/tests/test_agent_system.py`
- `backend/tests/test_simulation_engine.py`
- `backend/tests/test_api_layer.py`
- `backend/tests/test_runtime.py`
- `backend/tests/test_headless_cli.py`

At minimum, run the catalog invariants plus the backend suites that touch any consumer you changed.

## Guardrails

Keep these rules in mind:

- Preserve existing action string values unless you intentionally want a wire/API breaking change.
- Keep frontend concerns out of this backend catalog unless the backend truly needs them.
- Do not move procedural engine behavior into the catalog unless it is clearly becoming a static
  lookup table.
- If a consumer is deriving the same static action grouping as another consumer, centralize it in
  `backend/app/actions/` instead of duplicating it again.
