"""Narrate a seed module's scenes: TTS → mp3 + WebVTT → module.json refs.

The synthesizer is injected so tests (and future providers) need no network.
New narration is always unapproved: a person must listen before it ships.
"""
from collections.abc import Callable
from pathlib import Path

from .captions import vtt_from_alignment
from .content import estimated_script_ms, load_module, rescale_beats, save_module, scenes
from .elevenlabs import Speech


def narrate_module(seed_dir: Path, *, voice_id: str,
                   synthesize: Callable[[str], Speech],
                   scene_key: str | None = None, log=print) -> list[str]:
    module = load_module(seed_dir)
    targets = [s for s in scenes(module["content"]) if scene_key in (None, s["key"])]
    if scene_key and not targets:
        raise ValueError(f"No motion_scene with key {scene_key!r}")

    narrated: list[str] = []
    for scene in targets:
        script = scene.get("script", "").strip()
        if not script:
            log(f"skip {scene['key']}: no script")
            continue
        speech = synthesize(script)
        audio_name, vtt_name = f"{scene['key']}.mp3", f"{scene['key']}.vtt"
        (seed_dir / audio_name).write_bytes(speech.audio)
        (seed_dir / vtt_name).write_text(
            vtt_from_alignment(speech.characters, speech.starts, speech.ends), encoding="utf-8")

        previous = scene.get("narration") or {}
        reference_ms = previous.get("duration_ms") or estimated_script_ms(script)
        scene["beats"] = rescale_beats(scene.get("beats", []), reference_ms, speech.duration_ms)
        scene["narration"] = {
            "audio_path": audio_name,
            "captions_path": vtt_name,
            "transcript": script,
            "duration_ms": speech.duration_ms,
            "voice": voice_id,
            "ai_generated": True,
            "approved_by": None,
            "approved_at": None,
        }
        save_module(seed_dir, module)  # after each scene, so a mid-run failure keeps progress
        narrated.append(scene["key"])
        log(f"narrated {scene['key']}: {speech.duration_ms / 1000:.1f}s")
    return narrated
