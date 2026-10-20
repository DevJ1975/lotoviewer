import base64
import json

import httpx
import pytest
import respx

from studio.elevenlabs import ElevenLabsError, synthesize

URL = "https://api.elevenlabs.io/v1/text-to-speech/voice-1/with-timestamps"


def tts_body(text="Hi."):
    chars = list(text)
    return {
        "audio_base64": base64.b64encode(b"ID3fake-mp3").decode(),
        "alignment": {
            "characters": chars,
            "character_start_times_seconds": [i * 0.1 for i in range(len(chars))],
            "character_end_times_seconds": [(i + 1) * 0.1 for i in range(len(chars))],
        },
    }


@respx.mock
def test_synthesize_posts_text_and_returns_audio_and_alignment():
    route = respx.post(URL).mock(return_value=httpx.Response(200, json=tts_body()))
    speech = synthesize("Hi.", voice_id="voice-1", api_key="k", model_id="eleven_multilingual_v2")
    request = route.calls.last.request
    assert request.headers["xi-api-key"] == "k"
    assert request.url.params["output_format"] == "mp3_44100_128"
    assert json.loads(request.content)["model_id"] == "eleven_multilingual_v2"
    assert speech.audio == b"ID3fake-mp3"
    assert speech.characters == ["H", "i", "."]
    assert speech.duration_ms == 300


@respx.mock
def test_api_errors_surface_without_the_key():
    respx.post(URL).mock(return_value=httpx.Response(401, json={"detail": "invalid api key"}))
    with pytest.raises(ElevenLabsError) as error:
        synthesize("Hi.", voice_id="voice-1", api_key="secret-key", model_id="m")
    assert "401" in str(error.value)
    assert "secret-key" not in str(error.value)


@respx.mock
def test_missing_alignment_is_an_error():
    respx.post(URL).mock(return_value=httpx.Response(200, json={"audio_base64": "AA=="}))
    with pytest.raises(ElevenLabsError, match="no audio or alignment"):
        synthesize("Hi.", voice_id="voice-1", api_key="k", model_id="m")


def test_missing_key_or_voice_fails_before_any_request():
    with pytest.raises(ElevenLabsError, match="ELEVENLABS_API_KEY"):
        synthesize("Hi.", voice_id="v", api_key="", model_id="m")
    with pytest.raises(ElevenLabsError, match="voice"):
        synthesize("Hi.", voice_id="", api_key="k", model_id="m")
