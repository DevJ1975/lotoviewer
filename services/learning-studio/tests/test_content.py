from studio.content import (
    board_assets,
    bucket_path,
    content_type_for,
    estimated_script_ms,
    rescale_beats,
    rewrite_media_paths,
    set_approval,
)

from .conftest import scene_content


def test_bucket_path_prefixes_bare_filenames_only():
    assert bucket_path("global/loto-101/v1/", "a.png") == "global/loto-101/v1/a.png"
    assert bucket_path("global/loto-101/v1", "global/x/a.png") == "global/x/a.png"


def test_rescale_beats_stretches_and_clamps_to_the_audio():
    beats = [{"at_ms": 0, "text": "a"}, {"at_ms": 10_000, "text": "b"}, {"at_ms": 20_000, "text": "c"}]
    assert [b["at_ms"] for b in rescale_beats(beats, 20_000, 30_000)] == [0, 15_000, 29_500]
    assert rescale_beats(beats, 0, 30_000) == beats


def test_estimated_script_ms_uses_the_authoring_pace():
    assert estimated_script_ms("one two three four five") == 2000


def test_content_types():
    assert content_type_for("a/b.MP3") == "audio/mpeg"
    assert content_type_for("x.vtt") == "text/vtt"
    assert content_type_for("x.bin") == "application/octet-stream"


def test_rewrite_media_paths_lists_uploads_and_missing_files(tmp_path):
    (tmp_path / "s1.png").write_bytes(b"png")
    content = {"blocks": [
        {"key": "s1", "kind": "motion_scene", "image": {"path": "s1.png"},
         "narration": {"audio_path": "s1.mp3", "captions_path": "s1.vtt"}},
        {"key": "h", "kind": "hotspot", "image": {"path": "global/already/there.png"}},
    ]}
    rewritten, uploads, missing = rewrite_media_paths(content, "global/loto-101/v1", tmp_path)
    assert rewritten["blocks"][0]["image"]["path"] == "global/loto-101/v1/s1.png"
    assert rewritten["blocks"][0]["narration"]["audio_path"] == "global/loto-101/v1/s1.mp3"
    assert [u.bucket_path for u in uploads] == ["global/loto-101/v1/s1.png"]
    assert missing == ["s1.mp3", "s1.vtt"]
    assert content["blocks"][0]["image"]["path"] == "s1.png"  # input untouched


def test_set_approval_stamps_and_clears_matching_assets_only():
    content = scene_content()
    approved, matched = set_approval(content, "global/loto-101/v1/s1.png", "root@example.com", "T")
    assert matched == 1
    assert approved["blocks"][0]["image"]["approved_by"] == "root@example.com"
    assert approved["blocks"][0]["narration"]["approved_by"] is None
    cleared, _ = set_approval(approved, "global/loto-101/v1/s1.png", None, None)
    assert cleared["blocks"][0]["image"]["approved_at"] is None
    assert set_approval(content, "nope.png", "x", "T")[1] == 0


def test_board_assets_lists_images_and_narration_in_order():
    assets = board_assets(scene_content())
    assert [(a.kind, a.path) for a in assets] == [
        ("image", "global/loto-101/v1/s1.png"), ("narration", "global/loto-101/v1/s1.mp3")]
    assert assets[1].captions_path == "global/loto-101/v1/s1.vtt"
