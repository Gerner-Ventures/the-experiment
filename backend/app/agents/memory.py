from __future__ import annotations

from app.agents.models import AgentMemoryState, KeyMemory, MemoryEvent, RelationshipMemory

RECENT_MEMORY_LIMIT = 8
KEY_MEMORY_LIMIT = 5
RELATIONSHIP_HISTORY_LIMIT = 6


def append_recent_event(memory: AgentMemoryState, event: MemoryEvent) -> AgentMemoryState:
    recent_events = [*memory.recent_events, event][-RECENT_MEMORY_LIMIT:]
    return memory.model_copy(update={"recent_events": recent_events})


def add_key_memory(memory: AgentMemoryState, key_memory: KeyMemory) -> AgentMemoryState:
    key_memories = [*memory.key_memories, key_memory][-KEY_MEMORY_LIMIT:]
    return memory.model_copy(update={"key_memories": key_memories})


def update_relationship_memory(
    memory: AgentMemoryState,
    other_agent_id: str,
    trust_delta: float,
    note: str,
) -> AgentMemoryState:
    relationships = dict(memory.relationship_memory)
    existing = relationships.get(other_agent_id, RelationshipMemory())
    updated = existing.model_copy(
        update={
            "trust": max(-100.0, min(100.0, existing.trust + trust_delta)),
            "history": [*existing.history, note][-RELATIONSHIP_HISTORY_LIMIT:],
        }
    )
    relationships[other_agent_id] = updated
    return memory.model_copy(update={"relationship_memory": relationships})
