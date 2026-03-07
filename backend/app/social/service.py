from __future__ import annotations

from random import Random

from app.engine.models import (
    ConversationTone,
    ConversationOutcome,
    ConversationTurn,
    EngineAgentState,
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

        for agent in state.agents:
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
        summary = (
            f"The town meeting {'backs' if passed else 'rejects'} '{proposal}' "
            f"with {tally['support']} support, {tally['oppose']} opposition, "
            f"and {tally['abstain']} abstentions."
        )
        return MeetingOutcome(
            proposal=proposal,
            speeches=speeches,
            votes=votes,
            vote_rationales=vote_rationales,
            tally=tally,
            passed=passed,
            summary=summary,
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

    def _conversation_tone(
        self, agent: EngineAgentState
    ) -> ConversationTone:
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
            return (
                f"{speaker.name} tells {listener.name} they need to stay steady while {crisis.lower()}."
            )
        if tone == "suspicious":
            return (
                f"{speaker.name} quietly warns {listener.name} that {crisis.lower()} feels staged."
            )
        if tone == "manipulative":
            return (
                f"{speaker.name} nudges {listener.name} to remember who benefits if {crisis.lower()}."
            )
        return (
            f"{speaker.name} keeps their voice low with {listener.name}, circling around {crisis.lower()}."
        )

    def _meeting_stance(self, agent: EngineAgentState, state: SimulationState) -> MeetingStance:
        crisis_type = state.gm_plan.plan.crisis_event.type if state.gm_plan else "resource"
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
        if stance == "support":
            return (
                f"{agent.name} argues that '{proposal}' is the cleanest way to answer {crisis.lower()}."
            )
        if stance == "oppose":
            return (
                f"{agent.name} rejects '{proposal}', warning it will only harden the town's panic."
            )
        return (
            f"{agent.name} hedges on '{proposal}', asking who will carry the cost if it fails."
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

        rationale = (
            f"{agent.name} votes {vote} on '{proposal}' from a {stance} position."
        )
        return MeetingVote(
            agent_id=agent.agent_id,
            agent_name=agent.name,
            vote=vote,
            rationale=rationale,
        )
