from __future__ import annotations

from app.gm.models import CrisisEvent, CrisisSeverity, CrisisTemplate, DirectorAct, GMPlanningContext
from app.gm.models import ResourceDelta

CRISIS_RESPONSE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "round": {"type": "integer"},
        "round_theme": {"type": "string"},
        "reasoning": {"type": "string"},
        "crisis_event": {
            "type": "object",
            "properties": {
                "type": {"type": "string"},
                "description": {"type": "string"},
                "affects": {"type": "array", "items": {"type": "string"}},
                "severity": {"type": "string"},
            },
            "required": ["type", "description", "severity"],
        },
        "resource_modifiers": {
            "type": "object",
            "properties": {
                "food": {"type": "number"},
                "water": {"type": "number"},
                "materials": {"type": "number"},
                "power": {"type": "number"},
            },
        },
        "environmental": {"type": ["string", "null"]},
        "narration": {"type": "string"},
        "meta_hint": {"type": ["string", "null"]},
    },
    "required": ["round", "round_theme", "reasoning", "crisis_event", "resource_modifiers", "narration"],
}

CRISIS_TEMPLATES: tuple[CrisisTemplate, ...] = (
    CrisisTemplate(
        type="resource",
        title="The Shelves Thin Overnight",
        description_template="Essential supplies vanish between dusk and dawn, and the town starts counting who had access.",
        base_affects=["general_store", "farm"],
        resource_modifiers=ResourceDelta(food=-2.0, water=0.0, materials=-1.0, power=0.0),
    ),
    CrisisTemplate(
        type="structural",
        title="A Key System Fails",
        description_template="A mechanical failure leaves one part of the town unusable until someone sacrifices time and supplies to repair it.",
        environmental="Metal fatigue and a low electrical groan unsettle the morning.",
        base_affects=["workshop", "town_hall"],
        resource_modifiers=ResourceDelta(food=0.0, water=0.0, materials=-2.0, power=-2.0),
    ),
    CrisisTemplate(
        type="social",
        title="Rumor Gains Teeth",
        description_template="A private accusation spreads fast enough to change how every conversation starts.",
        base_affects=["town_hall", "bar", "brothel"],
        resource_modifiers=ResourceDelta(food=0.0, water=0.0, materials=0.0, power=0.0),
    ),
    CrisisTemplate(
        type="environmental",
        title="The Weather Turns Hostile",
        description_template="The sky shifts into a punishing pattern that slows work and forces hard choices about shelter and movement.",
        environmental="A heavy fog folds the edges of town inward.",
        base_affects=["farm", "perimeter_fence", "well"],
        resource_modifiers=ResourceDelta(food=-1.0, water=-1.0, materials=0.0, power=-1.0),
    ),
    CrisisTemplate(
        type="discovery",
        title="Something Hidden Is Found",
        description_template="Evidence surfaces that someone has been lying, hiding, or tampering with the town's reality.",
        environmental="The air feels charged, as if the town is waiting to see who speaks first.",
        base_affects=["locked_building", "perimeter_fence"],
        resource_modifiers=ResourceDelta(food=0.0, water=0.0, materials=-1.0, power=-1.0),
    ),
    CrisisTemplate(
        type="meta",
        title="The Experiment Leaks Through",
        description_template="An impossible detail breaks the town's logic and forces at least one agent to wonder who is watching.",
        environmental="A fluorescent hum arrives from nowhere and then refuses to leave.",
        base_affects=["locked_building", "well", "brothel"],
        resource_modifiers=ResourceDelta(food=0.0, water=0.0, materials=0.0, power=-2.0),
    ),
)


def select_crisis_template(context: GMPlanningContext, current_act: DirectorAct) -> CrisisTemplate:
    pressure = current_act.resource_pressure.value
    plotline_bias = "meta" if any("watch" in plot.lower() for plot in context.unresolved_plotlines) else None

    if context.threat_level < 25 and plotline_bias is None:
        return _find_template("social")
    if context.world_state.resources.power <= 4 or context.world_state.resources.materials <= 4:
        return _find_template("structural")
    if plotline_bias is not None:
        return _find_template(plotline_bias)
    if pressure in {"high", "critical"} and context.cooperation_ratio < 0.5:
        return _find_template("resource")
    if current_act.tone.startswith("desperate") or current_act.tone.startswith("feral"):
        return _find_template("discovery")
    return _find_template("environmental")


def choose_severity(context: GMPlanningContext, current_act: DirectorAct) -> CrisisSeverity:
    if context.threat_level >= 70 or current_act.resource_pressure.value == "critical":
        return "critical"
    if context.threat_level >= 45 or context.cooperation_ratio < 0.4:
        return "high"
    if context.threat_level >= 20 or current_act.resource_pressure.value == "medium":
        return "medium"
    return "low"


def scale_resource_modifiers(base: ResourceDelta, severity: CrisisSeverity) -> ResourceDelta:
    factor = {"low": 0.6, "medium": 1.0, "high": 1.4, "critical": 1.8}[severity]
    return ResourceDelta(
        food=round(base.food * factor, 2),
        water=round(base.water * factor, 2),
        materials=round(base.materials * factor, 2),
        power=round(base.power * factor, 2),
    )


def render_crisis_event(
    template: CrisisTemplate,
    severity: CrisisSeverity,
    current_act: DirectorAct,
    unresolved_plotlines: list[str],
) -> CrisisEvent:
    plotline_suffix = ""
    if unresolved_plotlines:
        plotline_suffix = f" The pressure connects to {unresolved_plotlines[0].rstrip('.')}."
    return CrisisEvent(
        type=template.type,
        description=(
            f"{template.description_template} The act '{current_act.name}' sharpens it into a {severity} problem."
            f"{plotline_suffix}"
        ),
        affects=template.base_affects,
        severity=severity,
    )


def _find_template(crisis_type: str) -> CrisisTemplate:
    for template in CRISIS_TEMPLATES:
        if template.type == crisis_type:
            return template
    raise KeyError(crisis_type)
