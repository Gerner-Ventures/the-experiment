from app.db.models import ResourcePressure
from app.gm.models import DirectorAct, DirectorArc


PRESET_ARCS: dict[str, DirectorArc] = {
    "lord_of_the_flies": DirectorArc(
        name="Lord of the Flies",
        description="A classic three-act collapse from fragile cooperation into open desperation.",
        acts=[
            DirectorAct(
                name="False Peace",
                start_round=1,
                end_round=5,
                tone="cooperative, exploratory",
                gm_instructions="Introduce the town, seed oddities, and start quietly testing trust.",
                resource_pressure=ResourcePressure.LOW,
            ),
            DirectorAct(
                name="The Fracture",
                start_round=6,
                end_round=10,
                tone="suspicious, competitive",
                gm_instructions="Force hard social choices and expose selfish behavior.",
                resource_pressure=ResourcePressure.HIGH,
            ),
            DirectorAct(
                name="The Reckoning",
                start_round=11,
                end_round=15,
                tone="desperate, chaotic",
                gm_instructions="Drive the town toward confrontations, betrayals, and collapse conditions.",
                resource_pressure=ResourcePressure.CRITICAL,
            ),
        ],
    ),
    "slow_burn": DirectorArc(
        name="Slow Burn",
        description="A five-act pressure cooker that lets intimacy, routine, and paranoia simmer before rupture.",
        acts=[
            DirectorAct(
                name="Arrival",
                start_round=1,
                end_round=3,
                tone="uncertain, observant",
                gm_instructions="Orient the agents, let them map the town, and make the eeriness feel ambient rather than urgent.",
                resource_pressure=ResourcePressure.LOW,
            ),
            DirectorAct(
                name="Settlement",
                start_round=4,
                end_round=6,
                tone="domestic, intimate",
                gm_instructions="Encourage rituals, recurring pairings, and private confidences with subtle narrative friction.",
                resource_pressure=ResourcePressure.LOW,
            ),
            DirectorAct(
                name="Hairline Cracks",
                start_round=7,
                end_round=9,
                tone="uneasy, insinuating",
                gm_instructions="Introduce rumors, minor resource stress, and interpersonal asymmetry that cannot be ignored.",
                resource_pressure=ResourcePressure.MEDIUM,
            ),
            DirectorAct(
                name="Open Fracture",
                start_round=10,
                end_round=12,
                tone="accusatory, unstable",
                gm_instructions="Make hidden resentments visible and attach social cost to hesitation.",
                resource_pressure=ResourcePressure.HIGH,
            ),
            DirectorAct(
                name="Terminal Pressure",
                start_round=13,
                end_round=15,
                tone="desperate, feverish",
                gm_instructions="Push the town toward irreversible choices and emotionally expensive endings.",
                resource_pressure=ResourcePressure.CRITICAL,
            ),
        ],
    ),
    "chaos_from_round_1": DirectorArc(
        name="Chaos from Round 1",
        description="An aggressive two-act arc that starts unstable and quickly spirals.",
        acts=[
            DirectorAct(
                name="Immediate Disorder",
                start_round=1,
                end_round=6,
                tone="volatile, distrustful",
                gm_instructions="Open with disruption, contradictions, and early pressure that prevents any stable routine.",
                resource_pressure=ResourcePressure.HIGH,
            ),
            DirectorAct(
                name="Freefall",
                start_round=7,
                end_round=15,
                tone="feral, catastrophic",
                gm_instructions="Escalate every apparent solution into a larger crisis or moral compromise.",
                resource_pressure=ResourcePressure.CRITICAL,
            ),
        ],
    ),
    "the_long_peace": DirectorArc(
        name="The Long Peace",
        description="A restrained three-act arc where external calm masks longer-running distortions.",
        acts=[
            DirectorAct(
                name="Measured Calm",
                start_round=1,
                end_round=6,
                tone="civil, procedural",
                gm_instructions="Support cooperation and stability, but keep uncanny details persistent.",
                resource_pressure=ResourcePressure.LOW,
            ),
            DirectorAct(
                name="Doubt Without Proof",
                start_round=7,
                end_round=11,
                tone="psychological, ambiguous",
                gm_instructions="Destabilize certainty through suspicion, memory gaps, and contradictions more than brute scarcity.",
                resource_pressure=ResourcePressure.MEDIUM,
            ),
            DirectorAct(
                name="The Cost of Peace",
                start_round=12,
                end_round=15,
                tone="solemn, heartbreaking",
                gm_instructions="Force the town to confront what it sacrificed to stay orderly.",
                resource_pressure=ResourcePressure.HIGH,
            ),
        ],
    ),
}


def list_preset_arcs() -> list[DirectorArc]:
    return list(PRESET_ARCS.values())


def get_preset_arc(preset_id: str) -> DirectorArc:
    return PRESET_ARCS[preset_id]
