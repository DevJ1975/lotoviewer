import shutil
import subprocess
from pathlib import Path

import pytest

from studio.render import (
    CARD_SECONDS,
    NARRATION_TAIL_S,
    CardSegment,
    SceneSegment,
    build_segments,
    card_command,
    concat_command,
    probe_duration,
    render_module,
    scene_command,
    zoompan_expr,
)

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def module(blocks):
    return {"content": {"blocks": blocks}}


def scene(key="s1", **overrides):
    block = {"key": key, "kind": "motion_scene", "title": "Isolate", "eyebrow": "Step 4",
             "animation": "ken_burns_in", "image": {"path": "global/loto/v1/a.png"},
             "narration": {"audio_path": "a.mp3", "duration_ms": 1000},
             "beats": [{"at_ms": 0, "text": "Lock"}, {"at_ms": 500, "text": "Verify"}],
             "script": "Lock it out, then verify."}
    block.update(overrides)
    return block


def test_build_segments_resolves_bucket_paths_to_local_basenames(tmp_path):
    (tmp_path / "a.png").write_bytes(b"png")
    (tmp_path / "a.mp3").write_bytes(b"mp3")
    [segment] = build_segments(module([scene()]), tmp_path)
    assert isinstance(segment, SceneSegment)
    assert segment.image == tmp_path / "a.png"
    assert segment.audio == tmp_path / "a.mp3"
    assert segment.duration_s == 1 + NARRATION_TAIL_S
    assert segment.beats == ((0.0, "Lock"), (0.5, "Verify"))


def test_scene_without_local_audio_falls_back_to_a_silent_timed_scene(tmp_path):
    [segment] = build_segments(module([scene(beats=[{"at_ms": 9000, "text": "late"}])]), tmp_path)
    assert segment.audio is None
    assert segment.image is None
    assert segment.duration_s == 11.5


def test_non_scene_blocks_become_cards():
    segments = build_segments(module([
        {"key": "c", "kind": "callout", "title": "Careful", "body": "Stored energy"},
        {"key": "q", "kind": "scenario", "stem": "What do you do?"},
    ]), Path("/nonexistent"))
    callout, check = segments
    assert isinstance(callout, CardSegment) and callout.heading == "Careful"
    assert check.heading == "Interactive check"
    assert check.body == "What do you do?"
    assert check.duration_s == CARD_SECONDS


@pytest.mark.parametrize("animation,fragment", [
    ("ken_burns_in", "z='1+0.12*on/89'"),
    ("ken_burns_out", "z='1.12-0.12*on/89'"),
    ("pan_left", "x='(iw-iw/zoom)*(1-on/89)'"),
    ("pan_right", "x='(iw-iw/zoom)*on/89'"),
    ("static", "z='1'"),
])
def test_zoompan_matches_the_scene_animation(animation, fragment):
    assert fragment in zoompan_expr(animation, 90)


def test_scene_command_writes_text_through_textfiles_not_the_filter_graph(tmp_path):
    segment = build_segments(module([scene(title="It's 100% \"safe\": really")]), tmp_path)[0]
    command = scene_command(segment, tmp_path / "out.mp4", tmp_path, burn_captions=True)
    graph = command.args[command.args.index("-filter_complex") + 1]
    assert "100%" not in graph
    assert "It's 100% \"safe\": really" in command.text_files.values()
    assert "enable='gte(t,0.500)'" in graph
    assert any("between(t," in part for part in graph.split(":"))
    assert command.args[-1] == str(tmp_path / "out.mp4")
    assert "libx264" in command.args and "aac" in command.args


def test_card_and_concat_commands(tmp_path):
    card = CardSegment("q", "Interactive check", "Order the steps", "Complete it in the app", 3.0)
    command = card_command(card, tmp_path / "q.mp4", tmp_path)
    assert "Order the steps" in command.text_files.values()
    concat = concat_command([tmp_path / "a.mp4", tmp_path / "b.mp4"], tmp_path / "l.txt",
                            tmp_path / "out.mp4")
    assert "+faststart" in concat.args
    assert concat.text_files[tmp_path / "l.txt"].count("file '") == 2


@needs_ffmpeg
def test_render_module_produces_an_mp4_of_the_expected_length(tmp_path):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "color=c=red:s=800x600", "-frames:v", "1", str(tmp_path / "a.png")], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=1", str(tmp_path / "a.mp3")], check=True)
    progress = []
    out = render_module(
        module([scene(), scene("s2", image=None, narration=None, beats=[]),
                {"key": "q", "kind": "drag_sort", "prompt": "Order the steps."}]),
        tmp_path, tmp_path / "out" / "module.mp4", burn_captions=True,
        on_segment=lambda done, total, key: progress.append((done, total, key)))
    expected = (1 + NARRATION_TAIL_S) + 5.0 + CARD_SECONDS
    assert abs(probe_duration(out) - expected) < 0.35
    assert progress[-1] == (3, 3, "q")
