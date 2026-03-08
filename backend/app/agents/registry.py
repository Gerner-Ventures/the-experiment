from app.actions import ACTION_SPECS
from app.agents.models import ActionDefinition

ACTION_REGISTRY: dict[str, ActionDefinition] = {
    spec.id.value: ActionDefinition(
        type=spec.id,
        category=spec.category,
        description=spec.description,
        requires_target=spec.requires_target,
        requires_location=spec.requires_location,
    )
    for spec in ACTION_SPECS
}


def get_action_definition(action_type: str) -> ActionDefinition:
    return ACTION_REGISTRY[action_type]
