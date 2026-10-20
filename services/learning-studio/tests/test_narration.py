import json

import pytest

from studio.elevenlabs import Speech
from studio.narration import narrate_module


def fake_speech(text: str) -> Speech:
    chars = list(text)
    return Speech(b"mp3:" + text[:8].encode(), chars,
                  [i * 0.05 for i in range(len(chars))], [(i + 1) * 0.05 for i in range(len(chars))])


def test_narrates_every_scene_writes_files_and_rescales_beats(seed_dir):
    before = json.loads((seed_dir / "module.json").read_text())
    done = narrate_module(seed_dir, voice_id="voice-1", synthesize=fake_speech, log=lambda _: None)
    after = json.loads((seed_dir / "module.json").read_text())

    scene_keys = [b["key"] for b in before["content"]["blocks"] if b["kind"] == "motion_scene"]
    assert done == scene_keys
    first = after["content"]["blocks"][0]
    narration = first["narration"]
    assert narration["audio_path"] == "s1-why.mp3"
    assert narration["voice"] == "voice-1"
    assert narration["ai_generated"] is True and narration["approved_by"] is None
    assert narration["duration_ms"] == round(len(first["script"]) * 50)
    assert (seed_dir / "s1-why.mp3").read_bytes().startswith(b"mp3:")
    assert (seed_dir / "s1-why.vtt").read_text().startswith("WEBVTT")
    assert all(b["at_ms"] < narration["duration_ms"] for b in first["beats"])
    assert first["beats"] != before["content"]["blocks"][0]["beats"]


def test_single_scene_and_unknown_scene(seed_dir):
    assert narrate_module(seed_dir, voice_id="v", synthesize=fake_speech, scene_key="s3-roles",
                          log=lambda _: None) == ["s3-roles"]
    with pytest.raises(ValueError, match="No motion_scene"):
        narrate_module(seed_dir, voice_id="v", synthesize=fake_speech, scene_key="nope",
                       log=lambda _: None)
