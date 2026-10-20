import json

import pytest

from walkdown.annotations import InvalidAnnotations, parse_annotations
from walkdown.models import Slot, photo_version
from walkdown.photo_status import compute_photo_status
from walkdown.storage_paths import equipment_photo_path, sanitize_id

TENANT = "ae3f1973-4c3e-4b6e-b91f-9de5ff10529e"


@pytest.mark.parametrize("equip,iso,needs_equip,needs_iso,expected", [
    ("a", "b", True, True, "complete"),
    ("a", None, True, True, "partial"),
    (None, "b", True, True, "partial"),
    (None, None, True, True, "missing"),
    ("a", None, True, False, "complete"),   # iso not required
    (None, "b", False, True, "complete"),   # equip not required
    (None, None, False, False, "complete"),
    ("  ", "", True, True, "missing"),       # blank URLs are absent
    ("a", None, None, None, "partial"),      # null needs_* means required
])
def test_photo_status_matches_platform(equip, iso, needs_equip, needs_iso, expected):
    assert compute_photo_status(equip, iso, needs_equip, needs_iso) == expected


def test_storage_path_matches_platform_layout():
    assert equipment_photo_path(TENANT, "SK-001", Slot.ISO, 1760000000000) == \
        f"{TENANT}/SK-001/SK-001_ISO_1760000000000.jpg"


def test_storage_path_sanitises_ids_with_slashes_and_hashes():
    assert sanitize_id("302-MX/1 #2") == "302-MX_1__2"
    assert "/" not in equipment_photo_path(TENANT, "A/B", Slot.EQUIP, 1).split("/", 2)[1]


def test_photo_version_changes_with_url_and_is_empty_without_one():
    assert photo_version("") == ""
    assert photo_version("https://a/1.jpg") != photo_version("https://a/2.jpg")
    assert len(photo_version("https://a/1.jpg")) == 10


ARROW = {"type": "arrow", "x1": 0.1, "y1": 0.2, "x2": 0.8, "y2": 0.9, "label": " Main disconnect "}


def test_annotations_accept_and_trim_valid_arrows():
    [arrow] = parse_annotations(json.dumps([ARROW]))
    assert arrow["label"] == "Main disconnect"
    assert arrow["x2"] == 0.8


def test_annotations_allow_clearing():
    assert parse_annotations("[]") == []


@pytest.mark.parametrize("raw", [
    "not json", "{}", '[{"type":"label","x":0,"y":0,"text":"x"}]',
    json.dumps([{**ARROW, "x1": 1.5}]), json.dumps([{**ARROW, "y2": -0.1}]),
    json.dumps([{**ARROW, "x1": True}]), json.dumps([{**ARROW, "x1": "0.5"}]),
    json.dumps([{**ARROW, "label": "x" * 41}]), json.dumps([ARROW] * 7),
    '[{"type":"arrow","x1":NaN,"y1":0,"x2":0,"y2":0}]',
])
def test_annotations_reject_anything_the_platform_would_drop(raw):
    with pytest.raises(InvalidAnnotations):
        parse_annotations(raw)
