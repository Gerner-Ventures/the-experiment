from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from app.agents.models import AgentTurnResult
from app.api.ws_manager import ConnectionManager
from app.engine import EngineAgentState, RoundResult, SimulationState
from app.engine.models import PhaseName, PhaseResult
from app.gm.models import GMPlanRecord
from app.schemas.ws_message import WSMessageType

from .audio import RuntimeAudioService
from .runtime_support import AgentSpeechEntry, status_value

_EVENT_KIND_TO_WS_TYPE: dict[str, WSMessageType] = {
    "agent_speak": "agent_speak",
    "meeting_start": "meeting_start",
    "meeting_speech": "meeting_speech",
    "meeting_vote": "meeting_vote",
    "meeting_result": "meeting_result",
    "faction_update": "faction_update",
    "cult_activity": "cult_activity",
    "exile_vote": "exile_vote",
    "exile_enacted": "exile_result",
}


def _phase_event_ws_type(event: Any) -> WSMessageType | None:
    data = getattr(event, "data", {})
    if not isinstance(data, dict):
        return None
    kind = str(data.get("kind", ""))
    if kind == "agent_action" and bool(data.get("is_consequence")):
        return "agent_action"
    return _EVENT_KIND_TO_WS_TYPE.get(kind) if kind else None


class RuntimeStreamBroadcaster:
    def __init__(
        self,
        *,
        connection_manager: ConnectionManager,
        get_state: Callable[[str], Awaitable[SimulationState]],
        message_builder: Callable[..., dict[str, Any]],
        agent_speech_log: dict[str, list[AgentSpeechEntry]],
        audio_service: RuntimeAudioService,
    ) -> None:
        self.connection_manager = connection_manager
        self.get_state = get_state
        self.message_builder = message_builder
        self.agent_speech_log = agent_speech_log
        self.audio_service = audio_service

    def build_hook(self, experiment_id: str) -> StreamingHook:
        return StreamingHook(experiment_id=experiment_id, broadcaster=self)

    def schedule_broadcast(self, experiment_id: str, payload: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.connection_manager.broadcast(experiment_id, payload))

    async def broadcast_round_end(
        self,
        experiment_id: str,
        round_result: RoundResult,
        state: SimulationState,
    ) -> None:
        await self.connection_manager.broadcast(
            experiment_id,
            self.message_builder(
                "resource_update",
                round_number=round_result.round_number,
                data=state.world_state.resources.model_dump(mode="json"),
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self.message_builder(
                "threat_update",
                round_number=round_result.round_number,
                data={"threat_level": state.world_state.threat_level},
            ),
        )
        await self.connection_manager.broadcast(
            experiment_id,
            self.message_builder(
                "round_end",
                round_number=round_result.round_number,
                data={
                    "status": state.status,
                    "current_round": state.current_round,
                    "total_rounds": state.total_rounds,
                    "threat_level": state.world_state.threat_level,
                    "resources": state.world_state.resources.model_dump(mode="json"),
                    "agents": [
                        {
                            "agent_id": agent.agent_id,
                            "name": agent.name,
                            "character_id": agent.character_id,
                            "status": status_value(agent.status),
                            "location": agent.location,
                            "suspicion_level": agent.suspicion_level,
                            "faction_id": agent.faction_id,
                            "faction_role": agent.faction_role,
                            "influence": agent.influence,
                        }
                        for agent in state.agents
                    ],
                },
            ),
        )
        if state.status in ("completed", "collapsed"):
            await self.connection_manager.broadcast(
                experiment_id,
                self.message_builder(
                    "experiment_end",
                    round_number=round_result.round_number,
                    data={"status": state.status, "total_rounds": state.total_rounds},
                ),
            )


class StreamingHook:
    def __init__(self, *, experiment_id: str, broadcaster: RuntimeStreamBroadcaster) -> None:
        self._experiment_id = experiment_id
        self._broadcaster = broadcaster

    async def on_round_start(self, round_number: int, gm_plan: GMPlanRecord) -> None:
        cm = self._broadcaster.connection_manager
        msg = self._broadcaster.message_builder
        eid = self._experiment_id
        narration_audio = (
            await self._broadcaster.audio_service.resolve_narration_audio_snapshot_for_plan(
                eid,
                gm_plan,
                prewarm=True,
            )
        )
        gm_plan_payload = gm_plan.model_dump(mode="json")
        gm_plan_payload["narration_audio"] = narration_audio

        await cm.broadcast(
            eid,
            msg(
                "round_start",
                round_number=round_number,
                data={"theme": gm_plan.plan.round_theme},
            ),
        )
        await cm.broadcast(
            eid,
            msg(
                "gm_plan",
                round_number=round_number,
                data=gm_plan_payload,
            ),
        )
        narration_id = narration_audio.get("narration_id")
        if isinstance(narration_id, str) and narration_id:
            audio_payload: dict[str, Any] = {
                "status": narration_audio["status"],
                "narration_id": narration_id,
            }
            if narration_audio.get("audio_url") is not None:
                audio_payload["audio_url"] = narration_audio["audio_url"]
            if narration_audio.get("error") is not None:
                audio_payload["error"] = narration_audio["error"]
            await cm.broadcast(
                eid,
                msg(
                    "gm_audio_status",
                    round_number=round_number,
                    phase="gm_plan",
                    data=audio_payload,
                ),
            )
        await cm.broadcast(
            eid,
            msg(
                "crisis_event",
                round_number=round_number,
                phase="dawn",
                data=gm_plan.plan.crisis_event.model_dump(mode="json"),
            ),
        )

    async def on_phase_start(self, round_number: int, phase: PhaseName) -> None:
        await self._broadcaster.connection_manager.broadcast(
            self._experiment_id,
            self._broadcaster.message_builder(
                "phase_change",
                round_number=round_number,
                phase=phase,
                data={"status": "starting"},
            ),
        )

    async def on_phase_complete(self, round_number: int, phase_result: PhaseResult) -> None:
        cm = self._broadcaster.connection_manager
        msg = self._broadcaster.message_builder
        eid = self._experiment_id

        await cm.broadcast(
            eid,
            msg(
                "phase_change",
                round_number=round_number,
                phase=phase_result.phase,
                data={"events": [event.model_dump(mode="json") for event in phase_result.events]},
            ),
        )
        new_speech_entries: list[AgentSpeechEntry] = []
        for event in phase_result.events:
            msg_type = _phase_event_ws_type(event)
            if msg_type:
                await cm.broadcast(
                    eid,
                    msg(
                        msg_type,
                        round_number=round_number,
                        phase=phase_result.phase,
                        data=event.data,
                        is_consequence=bool(event.data.get("is_consequence")),
                    ),
                )
            event_kind = str(event.data.get("kind", ""))
            if event_kind != "agent_speak":
                continue
            agent_id = str(event.data.get("agent_id", ""))
            message_text = str(event.data.get("message", ""))
            if not agent_id or not message_text.strip():
                continue
            existing = [
                entry
                for entry in self._broadcaster.agent_speech_log.get(eid, [])
                if entry["agent_id"] == agent_id and entry["round_number"] == round_number
            ]
            index = len(existing)
            character_id = ""
            try:
                state = await self._broadcaster.get_state(eid)
                for agent in state.agents:
                    if agent.agent_id == agent_id:
                        character_id = agent.character_id or ""
                        break
            except KeyError:
                pass
            entry: AgentSpeechEntry = {
                "agent_id": agent_id,
                "character_id": character_id,
                "round_number": round_number,
                "index": index,
                "text": message_text,
                "source": str(event.data.get("source", "dialogue")),
            }
            self._broadcaster.agent_speech_log[eid].append(entry)
            new_speech_entries.append(entry)

        if new_speech_entries:
            await self._broadcaster.audio_service.prepare_agent_speech_audio(
                eid, round_number, phase_result, new_speech_entries
            )

    async def on_agent_action(
        self,
        round_number: int,
        phase: PhaseName,
        agent: EngineAgentState,
        turn: AgentTurnResult,
    ) -> None:
        await self._broadcaster.connection_manager.broadcast(
            self._experiment_id,
            self._broadcaster.message_builder(
                "agent_action",
                round_number=round_number,
                phase=phase,
                data={
                    "agent_id": agent.agent_id,
                    "agent_name": agent.name,
                    "action": turn.decision.action.model_dump(mode="json"),
                    "is_consequence": False,
                    "inner_thought": turn.decision.inner_thought,
                    "speech_text": turn.decision.inner_thought,
                    "speech_source": "inner_thought",
                    "dialogue": turn.decision.dialogue.message if turn.decision.dialogue else None,
                    "cooperation_intent": turn.decision.cooperation_intent,
                    "goal_progress": turn.decision.goal_progress,
                },
            ),
        )
