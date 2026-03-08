from __future__ import annotations

import ssl
from collections.abc import AsyncIterator

import httpx
import truststore
from elevenlabs.client import AsyncElevenLabs
from elevenlabs.core.api_error import ApiError
from elevenlabs.types.voice_settings import VoiceSettings

from app.tts.models import NarrationAudioRequest, ProviderAudioStream


class NarrationAudioError(Exception):
    def __init__(self, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class ElevenLabsNarrationProvider:
    def __init__(
        self,
        *,
        api_key: str,
        timeout_seconds: float,
        sdk_client: AsyncElevenLabs | None = None,
        httpx_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._owned_httpx_client: httpx.AsyncClient | None = None
        if sdk_client is not None:
            self._client = sdk_client
        else:
            client = httpx_client or self._build_httpx_client(timeout_seconds)
            if httpx_client is None:
                self._owned_httpx_client = client
            self._client = AsyncElevenLabs(
                api_key=api_key,
                timeout=timeout_seconds,
                httpx_client=client,
            )

    def _build_httpx_client(self, timeout_seconds: float) -> httpx.AsyncClient:
        ssl_context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        return httpx.AsyncClient(timeout=timeout_seconds, verify=ssl_context)

    async def aclose(self) -> None:
        if self._owned_httpx_client is not None:
            await self._owned_httpx_client.aclose()
            self._owned_httpx_client = None

    async def start_stream(self, request: NarrationAudioRequest) -> ProviderAudioStream:
        voice_settings = VoiceSettings(**request.voice_settings) if request.voice_settings else None
        stream_context = self._client.text_to_speech.with_raw_response.stream(
            request.voice_id,
            text=request.text,
            output_format=request.output_format,
            model_id=request.model_id,
            voice_settings=voice_settings,
        )
        try:
            response = await stream_context.__aenter__()
        except ApiError as exc:
            raise self._map_api_error(exc) from exc
        except TimeoutError as exc:
            raise NarrationAudioError(
                "Narration audio request timed out.", status_code=504
            ) from exc
        except Exception as exc:
            raise NarrationAudioError(
                "Narration audio provider request failed.",
                status_code=502,
            ) from exc

        content_type_header = response.headers.get("content-type", "audio/mpeg")
        content_type = content_type_header.split(";", 1)[0].strip() or "audio/mpeg"
        request_id = response.headers.get("request-id") or response.headers.get("x-request-id")

        async def iterate() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.data:
                    if chunk:
                        yield chunk
            except ApiError as exc:
                raise self._map_api_error(exc) from exc
            except TimeoutError as exc:
                raise NarrationAudioError(
                    "Narration audio request timed out.",
                    status_code=504,
                ) from exc
            except Exception as exc:
                raise NarrationAudioError(
                    "Narration audio provider stream failed.",
                    status_code=502,
                ) from exc
            finally:
                await stream_context.__aexit__(None, None, None)

        return ProviderAudioStream(
            content_type=content_type,
            request_id=request_id,
            stream=iterate(),
        )

    def _map_api_error(self, exc: ApiError) -> NarrationAudioError:
        if exc.status_code == 429:
            return NarrationAudioError(
                "Narration audio provider is rate limited.",
                status_code=503,
            )
        if exc.status_code in {401, 403}:
            return NarrationAudioError(
                "Narration audio provider rejected the request.",
                status_code=502,
            )
        if exc.status_code == 504:
            return NarrationAudioError("Narration audio request timed out.", status_code=504)
        return NarrationAudioError(
            f"Narration audio provider returned {exc.status_code or 502}: {exc}",
            status_code=502,
        )
