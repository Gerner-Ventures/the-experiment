from __future__ import annotations

from app.gm.director import get_current_act, get_next_act, is_act_transition
from app.gm.events import (
    CRISIS_RESPONSE_SCHEMA,
    choose_severity,
    render_crisis_event,
    scale_resource_modifiers,
    select_crisis_template,
)
from app.gm.models import GMPlanData, GMPlanningContext, PromptPackage


def build_prompt_package(context: GMPlanningContext) -> PromptPackage:
    act = get_current_act(context.arc, context.round_number)
    next_act = get_next_act(context.arc, context.round_number)
    transition_note = ""
    if is_act_transition(context.arc, context.round_number):
        transition_note = "This round begins a new act, so the dramatic turn should feel unmistakable."

    system_prompt = (
        "You are the assertive AI Game Master for a social-collapse simulation. "
        "You do not wait passively for drama to emerge. Even in calm states, you introduce a meaningful turn "
        "that deepens conflict, reveals information, or destabilizes certainty while staying coherent with the director's arc. "
        "Return valid JSON only."
    )
    user_prompt = (
        f"Experiment round: {context.round_number}/{context.total_rounds}\n"
        f"Arc: {context.arc.name}\n"
        f"Current act: {act.name} ({act.tone})\n"
        f"Act instructions: {act.gm_instructions}\n"
        f"Director notes: {act.director_notes or 'None'}\n"
        f"Threat level: {context.threat_level}\n"
        f"Cooperation ratio: {context.cooperation_ratio}\n"
        f"Resources: {context.world_state.resources.model_dump()}\n"
        f"World modifiers: {context.world_state.active_modifiers}\n"
        f"Relationships summary: {context.relationships_summary or 'No relationship summary yet.'}\n"
        f"Unresolved plotlines: {context.unresolved_plotlines or ['None']}\n"
        f"Recent events: {context.recent_events or ['None']}\n"
        f"Upcoming act: {next_act.name if next_act else 'None'}\n"
        f"Transition guidance: {transition_note or 'No act transition this round.'}\n"
        "Generate a GM plan that includes a clear round theme, a crisis event, resource modifiers, narration, "
        "and an optional meta hint. Favor bold narrative turns over inactivity."
    )
    return PromptPackage(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        response_schema=CRISIS_RESPONSE_SCHEMA,
    )


def generate_rule_based_plan(context: GMPlanningContext) -> GMPlanData:
    act = get_current_act(context.arc, context.round_number)
    severity = choose_severity(context, act)
    template = select_crisis_template(context, act)
    crisis_event = render_crisis_event(template, severity, act, context.unresolved_plotlines)
    resource_modifiers = scale_resource_modifiers(template.resource_modifiers, severity)
    round_theme = _pick_round_theme(template.type, act.tone, context.threat_level)
    narration = (
        f"Day {context.round_number}. {round_theme}. "
        f"The town enters {act.name.lower()} with {act.tone} energy, and the pressure refuses to stay subtle."
    )
    reasoning = (
        f"Current act '{act.name}' demands assertive pacing. "
        f"Threat at {context.threat_level} and cooperation at {context.cooperation_ratio:.2f} justify a "
        f"{severity} {template.type} turn aimed at {', '.join(crisis_event.affects)}."
    )
    meta_hint = None
    if template.type in {"discovery", "meta"} or any("watch" in plot.lower() for plot in context.unresolved_plotlines):
        meta_hint = "Someone in town may be closer to understanding the experiment than they should be."

    return GMPlanData(
        round=context.round_number,
        round_theme=round_theme,
        reasoning=reasoning,
        crisis_event=crisis_event,
        resource_modifiers=resource_modifiers,
        environmental=template.environmental,
        narration=narration,
        meta_hint=meta_hint,
    )


def _pick_round_theme(crisis_type: str, tone: str, threat_level: float) -> str:
    if crisis_type == "social":
        return "A Private Rumor Becomes Public"
    if crisis_type == "resource":
        return "Scarcity Finds a Face"
    if crisis_type == "structural":
        return "The Town Starts Failing Back"
    if crisis_type == "meta":
        return "The Mask Slips"
    if crisis_type == "discovery":
        return "Evidence Refuses to Stay Buried"
    if threat_level < 30:
        return f"Calm Breaks Under {tone.title()}"
    return "The Environment Takes Sides"
