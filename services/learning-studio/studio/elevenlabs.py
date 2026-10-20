"""ElevenLabs text-to-speech with character timestamps.

The timestamped endpoint returns the audio and a per-character alignment in
one call, so captions line up with the voice instead of being estimated.
"""
import base64
from dataclasses import dataclass

import httpx

API_BASE = "https://api.elevenlabs.io"
TIMEOUT = httpx.Timeout(120.0, connect=10.0)
OUTPUT_FORMAT = "mp3_44100_128"


class ElevenLabsError(RuntimeError):
    """A TTS call failed; the message is safe to show (never echoes the key)."""


@dataclass(frozen=True)
class Speech:
    audio: bytes
    characters: list[str]
    starts: list[float]
    ends: list[float]

    @property
    def duration_ms(self) -> int:
        return round(self.ends[-1] * 1000) if self.ends else 0


def synthesize(text: str, *, voice_id: str, api_key: str, model_id: str) -> Speech:
    if not api_key:
        raise ElevenLabsError("ELEVENLABS_API_KEY is not set")
    if not voice_id:
        raise ElevenLabsError("No voice id: pass --voice or set ELEVENLABS_VOICE_ID")
    response = httpx.post(
        f"{API_BASE}/v1/text-to-speech/{voice_id}/with-timestamps",
        params={"output_format": OUTPUT_FORMAT},
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        json={"text": text, "model_id": model_id,
              "voice_settings": {"stability": 0.55, "similarity_boost": 0.75}},
        timeout=TIMEOUT,
    )
    if not response.is_success:
        raise ElevenLabsError(f"ElevenLabs TTS failed ({response.status_code}): {response.text[:300]}")
    body = response.json()
    alignment = body.get("alignment") or body.get("normalized_alignment") or {}
    characters = alignment.get("characters") or []
    starts = alignment.get("character_start_times_seconds") or []
    ends = alignment.get("character_end_times_seconds") or []
    if not body.get("audio_base64") or not characters:
        raise ElevenLabsError("ElevenLabs returned no audio or alignment")
    return Speech(base64.b64decode(body["audio_base64"]), characters, starts, ends)
