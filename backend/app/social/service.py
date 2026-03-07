from __future__ import annotations

from random import Random

from app.db.models import AgentStatus
from app.engine.models import (
    ConversationTone,
    ConversationOutcome,
    ConversationTurn,
    EngineAgentState,
    ExileOutcome,
    ExileVote,
    ExileVoteChoice,
    MeetingOutcome,
    MeetingStance,
    MeetingSpeech,
    MeetingVote,
    MeetingVoteChoice,
    SimulationState,
)


class SocialService:
    def __init__(self, *, random_seed: int = 17) -> None:
        self.random = Random(random_seed)

    def run_conversations(
        self,
        state: SimulationState,
        *,
        location: str,
        participants: list[EngineAgentState],
    ) -> list[ConversationOutcome]:
        ordered = sorted(participants, key=lambda agent: (agent.suspicion_level, agent.name))
        outcomes: list[ConversationOutcome] = []
        for index in range(0, len(ordered) - 1, 2):
            speaker = ordered[index]
            listener = ordered[index + 1]
            first = self._build_conversation_turn(speaker, listener, state)
            second = self._build_conversation_turn(listener, speaker, state)
            summary = (
                f"{speaker.name} and {listener.name} trade a tense read of the situation at "
                f"{location}."
            )
            outcomes.append(
                ConversationOutcome(
                    location=location,
                    participants=[speaker.agent_id, listener.agent_id],
                    turns=[first, second],
                    summary=summary,
                )
            )
        return outcomes

    def run_meeting(self, state: SimulationState, *, proposal: str) -> MeetingOutcome:
        speeches: list[MeetingSpeech] = []
        vote_records: list[MeetingVote] = []
        active_agents = [
            agent
            for agent in state.agents
            if agent.status not in {AgentStatus.EXILED, AgentStatus.DEAD}
        ]

        for agent in active_agents:
            stance = self._meeting_stance(agent, state)
            speeches.append(
                MeetingSpeech(
                    agent_id=agent.agent_id,
                    agent_name=agent.name,
                    stance=stance,
                    content=self._meeting_speech(agent, stance, proposal, state),
                )
            )
            vote_records.append(self._meeting_vote(agent, stance, proposal, state))

        votes = {record.agent_id: record.vote for record in vote_records}
        vote_rationales = {record.agent_id: record.rationale for record in vote_records}
        tally = {
            "support": sum(1 for record in vote_records if record.vote == "support"),
            "oppose": sum(1 for record in vote_records if record.vote == "oppose"),
            "abstain": sum(1 for record in vote_records if record.vote == "abstain"),
        }
        passed = tally["support"] > tally["oppose"]
        exile = self._run_exile_vote(state, active_agents)
        faction_pressures = self._faction_pressures(state)
        summary = (
            f"The town meeting {'backs' if passed else 'rejects'} '{proposal}' "
            f"with {tally['support']} support, {tally['oppose']} opposition, "
            f"and {tally['abstain']} abstentions."
        )
        if exile is not None and exile.target_agent_name is not None:
            summary = (
                f"{summary} The room turns on {exile.target_agent_name} and "
                f"{'banishes them.' if exile.enacted else 'fails to reach exile.'}"
            )
        return MeetingOutcome(
            proposal=proposal,
            speeches=speeches,
            votes=votes,
            vote_rationales=vote_rationales,
            tally=tally,
            passed=passed,
            summary=summary,
            exile=exile,
            faction_pressures=faction_pressures,
        )

    def conversation_trust_delta(
        self,
        speaker: EngineAgentState,
        listener: EngineAgentState,
    ) -> float:
        delta = 0.0
        if speaker.goal.archetype == listener.goal.archetype:
            delta += 1.5
        if speaker.personality.axes.empathy >= 60:
            delta += 1.0
        if speaker.personality.axes.loyalty >= 60:
            delta += 0.5
        if speaker.personality.axes.paranoia >= 65:
            delta -= 1.5
        if speaker.personality.axes.ambition >= 70:
            delta -= 0.5
        if "gossipy" in speaker.personality.trait_tags:
            delta -= 0.5
        if "protective" in speaker.personality.trait_tags:
            delta += 0.5
        return round(max(-4.0, min(4.0, delta)), 2)

    def relationship_delta_for_vote(
        self,
        source: EngineAgentState,
        target: EngineAgentState,
        *,
        source_vote: MeetingVoteChoice,
        target_vote: MeetingVoteChoice,
    ) -> float:
        if source_vote == "abstain" or target_vote == "abstain":
            return 0.0

        delta = 1.5 if source_vote == target_vote else -2.0
        if source.personality.axes.loyalty >= 65:
            delta += 0.5 if source_vote == target_vote else -0.5
        if source.personality.axes.paranoia >= 65 and source_vote != target_vote:
            delta -= 0.5
        return round(max(-4.0, min(3.0, delta)), 2)

    def _build_conversation_turn(
        self,
        speaker: EngineAgentState,
        listener: EngineAgentState,
        state: SimulationState,
    ) -> ConversationTurn:
        tone = self._conversation_tone(speaker)
        content = self._conversation_line(speaker, listener, tone, state)
        return ConversationTurn(
            speaker_id=speaker.agent_id,
            speaker_name=speaker.name,
            listener_id=listener.agent_id,
            listener_name=listener.name,
            tone=tone,
            content=content,
            trust_delta=self.conversation_trust_delta(speaker, listener),
        )

    def _conversation_tone(self, agent: EngineAgentState) -> ConversationTone:
        if agent.personality.axes.paranoia >= 65:
            return "suspicious"
        if agent.personality.axes.empathy >= 65:
            return "supportive"
        if agent.personality.axes.ambition >= 70:
            return "manipulative"
        return "guarded"

    def _conversation_line(
        self,
        speaker: EngineAgentState,
        listener: EngineAgentState,
        tone: ConversationTone,
        state: SimulationState,
    ) -> str:
        crisis = (
            state.gm_plan.plan.crisis_event.description
            if state.gm_plan
            else "the day keeps slipping out of control"
        )
        if tone == "supportive":
            return f"{speaker.name} tells {listener.name} they need to stay steady while {crisis.lower()}."
        if tone == "suspicious":
            return (
                f"{speaker.name} quietly warns {listener.name} that {crisis.lower()} feels staged."
            )
        if tone == "manipulative":
            return f"{speaker.name} nudges {listener.name} to remember who benefits if {crisis.lower()}."
        return f"{speaker.name} keeps their voice low with {listener.name}, circling around {crisis.lower()}."

    def _meeting_stance(self, agent: EngineAgentState, state: SimulationState) -> MeetingStance:
        crisis_type = state.gm_plan.plan.crisis_event.type if state.gm_plan else "resource"
        if agent.faction_role == "leader" and agent.faction_id:
            return "support" if agent.goal.archetype != "social_disruption" else "oppose"
        if agent.personality.axes.loyalty >= 65 or agent.goal.archetype == "communal_survival":
            return "support"
        if agent.personality.axes.paranoia >= 70 or crisis_type in {"social", "discovery"}:
            return "oppose"
        if agent.personality.axes.empathy >= 60 and state.world_state.threat_level < 55:
            return "support"
        return "hesitant"

    def _meeting_speech(
        self,
        agent: EngineAgentState,
        stance: MeetingStance,
        proposal: str,
        state: SimulationState,
    ) -> str:
        crisis = state.gm_plan.plan.crisis_event.description if state.gm_plan else "the crisis"
        faction_line = self._faction_line(agent, state)
        if stance == "support":
            return (
                f"{agent.name} argues that '{proposal}' is the cleanest way to answer "
                f"{crisis.lower()}. {faction_line}"
            ).strip()
        if stance == "oppose":
            return (
                f"{agent.name} rejects '{proposal}', warning it will only harden the town's panic. "
                f"{faction_line}"
            )
        return (
            f"{agent.name} hedges on '{proposal}', asking who will carry the cost if it fails. "
            f"{faction_line}"
        )

    def _meeting_vote(
        self,
        agent: EngineAgentState,
        stance: MeetingStance,
        proposal: str,
        state: SimulationState,
    ) -> MeetingVote:
        if stance == "support":
            vote: MeetingVoteChoice = "support"
        elif stance == "oppose":
            vote = "oppose"
        else:
            vote = "support" if state.world_state.threat_level >= 60 else "abstain"

        rationale = f"{agent.name} votes {vote} on '{proposal}' from a {stance} position."
        return MeetingVote(
            agent_id=agent.agent_id,
            agent_name=agent.name,
            vote=vote,
            rationale=rationale,
        )

    def _run_exile_vote(
        self,
        state: SimulationState,
        active_agents: list[EngineAgentState],
    ) -> ExileOutcome | None:
        target = self._select_exile_target(active_agents)
        if target is None:
            return None

        vote_records: list[ExileVote] = []
        for agent in active_agents:
            vote_records.append(self._exile_vote(agent, target, state))

        tally = {
            "banish": sum(1 for record in vote_records if record.vote == "banish"),
            "protect": sum(1 for record in vote_records if record.vote == "protect"),
            "abstain": sum(1 for record in vote_records if record.vote == "abstain"),
        }
        enacted = tally["banish"] > tally["protect"] and tally["banish"] >= max(
            2, len(active_agents) // 2
        )
        return ExileOutcome(
            round_number=state.world_state.round_number,
            target_agent_id=target.agent_id,
            target_agent_name=target.name,
            votes={record.agent_id: record.vote for record in vote_records},
            vote_rationales={record.agent_id: record.rationale for record in vote_records},
            tally=tally,
            enacted=enacted,
            reason=(
                f"{target.name} drew concentrated suspicion and became the focus of a banishment vote."
            ),
        )

    def _select_exile_target(
        self, active_agents: list[EngineAgentState]
    ) -> EngineAgentState | None:
        candidates = [agent for agent in active_agents if agent.suspicion_level >= 55]
        if not candidates:
            cult_leaders = [
                agent
                for agent in active_agents
                if agent.faction_role == "leader"
                and agent.faction_id
                and agent.suspicion_level >= 45
            ]
            candidates = cult_leaders
        if not candidates:
            return None
        return max(candidates, key=lambda agent: (agent.suspicion_level, agent.influence))

    def _exile_vote(
        self,
        agent: EngineAgentState,
        target: EngineAgentState,
        state: SimulationState,
    ) -> ExileVote:
        vote: ExileVoteChoice
        if agent.agent_id == target.agent_id:
            vote = "protect"
            rationale = f"{agent.name} fights exile when their own name is on the block."
        elif target.suspicion_level >= 80:
            vote = "banish"
            rationale = (
                f"{agent.name} decides {target.name}'s instability is too dangerous to ignore."
            )
        elif agent.faction_id and agent.faction_id == target.faction_id:
            vote = "protect"
            rationale = f"{agent.name} closes ranks with {target.name}'s faction."
        elif agent.personality.axes.paranoia >= 65 or target.suspicion_level >= 70:
            vote = "banish"
            rationale = f"{agent.name} sees exile as the only way to contain {target.name}."
        elif (
            agent.goal.archetype == "belief_transformation"
            and target.faction_id != agent.faction_id
        ):
            vote = "banish"
            rationale = f"{agent.name} treats dissent around {target.name} as a threat to belief."
        else:
            vote = "abstain" if state.world_state.threat_level < 50 else "banish"
            rationale = f"{agent.name} {vote}s after weighing the town's escalating fear."

        return ExileVote(
            agent_id=agent.agent_id,
            agent_name=agent.name,
            vote=vote,
            rationale=rationale,
        )

    def _faction_pressures(self, state: SimulationState) -> list[str]:
        pressures: list[str] = []
        for faction in state.factions:
            if faction.kind == "cult":
                pressures.append(
                    f"{faction.name} pushes doctrine '{faction.doctrine or 'obedience'}' through the meeting."
                )
            else:
                pressures.append(f"{faction.name} coordinates its members behind the scenes.")
        return pressures

    def _faction_line(self, agent: EngineAgentState, state: SimulationState) -> str:
        if not agent.faction_id:
            return ""
        faction = next(
            (item for item in state.factions if item.faction_id == agent.faction_id),
            None,
        )
        if faction is None:
            return ""
        if faction.kind == "cult":
            return f"They frame everything through {faction.name}'s doctrine."
        if agent.faction_role == "leader":
            return f"They are clearly steering {faction.name}."
        return f"They glance toward {faction.name} before committing."
