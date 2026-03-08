from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass(frozen=True)
class NarrationAudioRequest:
    experiment_id: str
    round_number: int
    text: str
    voice_id: str
    model_id: str
    output_format: str
    voice_settings: dict[str, float]


@dataclass
class ProviderAudioStream:
    content_type: str
    request_id: str | None
    stream: AsyncIterator[bytes]


@dataclass
class CachedNarrationAudio:
    cache_key: str
    content_type: str
    audio_bytes: bytes
    created_at_monotonic: float
    request_id: str | None = None


@dataclass
class NarrationAudioStreamResult:
    cache_key: str
    content_type: str
    cache_hit: bool
    stream: AsyncIterator[bytes]


@dataclass
class InflightNarrationAudio:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    entry: CachedNarrationAudio | None = None
    error: Exception | None = None
