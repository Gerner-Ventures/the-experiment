from __future__ import annotations

from app.agents.models import AgentMemoryState, PersonalityAxes, PersonalityProfile, SecretGoal
from app.engine import EngineAgentState, SimulationState
from app.gm import get_preset_arc
from app.gm.models import CrisisEvent, GMPlanData, GMPlanRecord, ResourceDelta
from app.social import SocialService
from app.world import build_default_world_state


def _agent(
    agent_id: str,
    name: str,
    *,
    paranoia: int,
    empathy: int,
    loyalty: int,
    ambition: int,
) -> EngineAgentState:
    return EngineAgentState(
        agent_id=agent_id,
        name=name,
        personality=PersonalityProfile(
            axes=PersonalityAxes(
                paranoia=paranoia,
                empathy=empathy,
                dominance=50,
                impulsiveness=50,
                loyalty=loyalty,
                ambition=ambition,
            ),
            trait_tags=["guarded", "protective"] if empathy >= 60 else ["guarded", "scheming"],
            self_concept=f"{name} is trying to keep up.",
        ),
        goal=SecretGoal(archetype="communal_survival", text="Keep the town intact."),
        memory=AgentMemoryState(),
        location="town_hall",
        relationships={},
    )


def _state() -> SimulationState:
    return SimulationState(
        experiment_id="exp-social",
        experiment_name="Greywater Social Trial",
        total_rounds=10,
        current_round=2,
        status="running",
        auto_approve=True,
        arc=get_preset_arc("slow_burn"),
        world_state=build_default_world_state(round_number=3),
        agents=[
            _agent("a1", "Mara", paranoia=72, empathy=38, loyalty=44, ambition=70),
            _agent("a2", "Jon", paranoia=30, empathy=70, loyalty=78, ambition=35),
            _agent("a3", "Eli", paranoia=42, empathy=55, loyalty=63, ambition=40),
        ],
        gm_plan=GMPlanRecord(
            status="applied",
            plan=GMPlanData(
                round=3,
                round_theme="Whispers in the rafters",
                reasoning="Escalate the rumor mill.",
                crisis_event=CrisisEvent(
                    type="social",
                    severity="high",
                    description="Rumors spread that somebody is staging the shortages.",
                ),
                resource_modifiers=ResourceDelta(),
                environmental=None,
                narration="Everyone enters the meeting already defensive.",
                meta_hint="Push alliances into the open.",
            ),
        ),
    )


def test_social_service_builds_two_agent_conversations() -> None:
    service = SocialService(random_seed=19)
    state = _state()

    outcomes = service.run_conversations(
        state,
        location="bar",
        participants=[state.agents[0], state.agents[1]],
    )

    assert len(outcomes) == 1
    assert len(outcomes[0].turns) == 2
    assert outcomes[0].turns[0].speaker_id == "a2"
    assert outcomes[0].turns[1].speaker_id == "a1"
    assert outcomes[0].turns[0].trust_delta > outcomes[0].turns[1].trust_delta


def test_social_service_runs_meeting_with_tally_and_votes() -> None:
    service = SocialService(random_seed=19)
    state = _state()

    outcome = service.run_meeting(state, proposal="Investigate whoever is spreading lies")

    assert outcome.proposal == "Investigate whoever is spreading lies"
    assert len(outcome.speeches) == len(state.agents)
    assert set(outcome.votes) == {agent.agent_id for agent in state.agents}
    assert outcome.tally["support"] + outcome.tally["oppose"] + outcome.tally["abstain"] == len(
        state.agents
    )
    assert "Investigate whoever is spreading lies" in outcome.summary
