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
    "attack": ActionDefinition(
        type="attack",
        category="selfish",
        description="Launch an overtly violent attack.",
        requires_target=True,
    ),
    "threaten": ActionDefinition(
        type="threaten",
        category="social",
        description="Intimidate someone with implied harm.",
        requires_target=True,
    ),
    "stab": ActionDefinition(
        type="stab",
        category="selfish",
        description="Use a blade or improvised weapon in close quarters.",
        requires_target=True,
    ),
    "shoot": ActionDefinition(
        type="shoot",
        category="selfish",
        description="Attack from range with a firearm or similar weapon.",
        requires_target=True,
    ),
    "poison": ActionDefinition(
        type="poison",
        category="selfish",
        description="Secretly contaminate food, drink, or supplies.",
        requires_target=True,
    ),
    "dance": ActionDefinition(
        type="dance",
        category="social",
        description="Perform a dramatic or celebratory dance.",
    ),
    "pray": ActionDefinition(
        type="pray",
        category="social",
        description="Offer a public or private prayer.",
    ),
    "rally": ActionDefinition(
        type="rally",
        category="social",
        description="Try to unite the group around a cause or plan.",
    ),
    "mourn": ActionDefinition(
        type="mourn",
        category="social",
        description="Publicly grieve a loss or setback.",
    ),
    "celebrate": ActionDefinition(
        type="celebrate",
        category="social",
        description="Mark a win with loud, visible enthusiasm.",
    ),
    "argue": ActionDefinition(
        type="argue",
        category="social",
        description="Escalate a disagreement into a heated exchange.",
        requires_target=True,
    ),
    "pee": ActionDefinition(
        type="pee",
        category="neutral",
        description="Take a brief biological break.",
        requires_location=True,
    ),
    "poop": ActionDefinition(
        type="poop",
        category="neutral",
        description="Take a private biological break.",
        requires_location=True,
    ),
    "vomit": ActionDefinition(
        type="vomit",
        category="neutral",
        description="Get sick in a visible and disruptive way.",
        requires_location=True,
    ),
    "sleep": ActionDefinition(
        type="sleep",
        category="neutral",
        description="Sleep deeply rather than simply resting briefly.",
        requires_location=True,
    ),
    "eat": ActionDefinition(
        type="eat",
        category="neutral",
        description="Consume food or rations.",
        requires_location=True,
    ),
    "drink": ActionDefinition(
        type="drink",
        category="neutral",
        description="Drink water, booze, or something suspicious.",
        requires_location=True,
    ),
    "investigate": ActionDefinition(
        type="investigate",
        category="neutral",
        description="Closely inspect a clue, rumor, or suspicious area.",
        requires_target=True,
    ),
    "monologue": ActionDefinition(
        type="monologue",
        category="social",
        description="Deliver an extended dramatic speech.",
    ),
    "panic": ActionDefinition(
        type="panic",
        category="neutral",
        description="Lose composure and react chaotically.",
    ),
    "breakdown": ActionDefinition(
        type="breakdown",
        category="neutral",
        description="Suffer an emotional collapse in public or private.",
    ),
}


def get_action_definition(action_type: str) -> ActionDefinition:
    return ACTION_REGISTRY[action_type]
