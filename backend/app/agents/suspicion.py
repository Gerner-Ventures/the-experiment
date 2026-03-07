from app.agents.models import SuspicionTrigger, SuspicionUpdate

SUSPICION_DELTAS: dict[SuspicionTrigger, float] = {
    "edge_of_map": 8.0,
    "failed_action": 5.0,
    "observer_event": 12.0,
    "paranoia_spread": 6.0,
    "meta_signal": 15.0,
}


def apply_suspicion_trigger(
    current_level: float, trigger: SuspicionTrigger, note: str
) -> tuple[float, SuspicionUpdate]:
    delta = SUSPICION_DELTAS[trigger]
    next_level = max(0.0, min(100.0, round(current_level + delta, 2)))
    return next_level, SuspicionUpdate(trigger=trigger, delta=delta, note=note)
