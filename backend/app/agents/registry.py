from app.agents.models import ActionDefinition

ACTION_REGISTRY: dict[str, ActionDefinition] = {
    "move": ActionDefinition(
        type="move",
        category="neutral",
        description="Move to a new location.",
        requires_location=True,
    ),
    "gather": ActionDefinition(
        type="gather",
        category="cooperative",
        description="Gather or produce a resource.",
        requires_location=True,
    ),
    "repair": ActionDefinition(
        type="repair",
        category="cooperative",
        description="Repair town infrastructure.",
        requires_location=True,
    ),
    "trade": ActionDefinition(
        type="trade",
        category="social",
        description="Exchange goods or favors.",
        requires_target=True,
    ),
    "talk": ActionDefinition(
        type="talk", category="social", description="Speak to another agent.", requires_target=True
    ),
    "hoard": ActionDefinition(
        type="hoard",
        category="selfish",
        description="Privately accumulate supplies.",
        requires_target=True,
    ),
    "sabotage": ActionDefinition(
        type="sabotage",
        category="selfish",
        description="Undermine a structure or plan.",
        requires_target=True,
    ),
    "explore": ActionDefinition(
        type="explore",
        category="neutral",
        description="Search the town or its edges.",
        requires_location=True,
    ),
    "accuse": ActionDefinition(
        type="accuse",
        category="social",
        description="Openly accuse another agent.",
        requires_target=True,
    ),
    "vote": ActionDefinition(
        type="vote", category="social", description="Cast a meeting vote.", requires_target=True
    ),
    "rest": ActionDefinition(type="rest", category="neutral", description="Recover privately."),
    "observe": ActionDefinition(
        type="observe", category="neutral", description="Watch without intervening."
    ),
}


def get_action_definition(action_type: str) -> ActionDefinition:
    return ACTION_REGISTRY[action_type]
