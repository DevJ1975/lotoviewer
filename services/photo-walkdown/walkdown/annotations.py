"""Validation for the arrows drawn on a photo.

The platform stores overlays as jsonb arrays (apps/web/lib/photoAnnotations.ts):
equipment photo in `annotations`, isolation photo in `iso_annotations`, each
arrow {type, x1, y1, x2, y2, label?} with coordinates 0-1 *relative to that
photo*. The platform's own parser silently drops anything malformed, so this
validates strictly and refuses instead.
"""
import json

from .models import Slot

COLUMN = {Slot.EQUIP: "annotations", Slot.ISO: "iso_annotations"}
MAX_ARROWS = 6
MAX_LABEL_CHARS = 40


class InvalidAnnotations(ValueError):
    pass


def _unit(value) -> bool:
    # bool is an int subclass; NaN fails the range check.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1


def parse_annotations(raw: str) -> list[dict]:
    try:
        data = json.loads(raw)
    except ValueError as error:
        raise InvalidAnnotations("Arrow data is not valid.") from error
    if not isinstance(data, list) or len(data) > MAX_ARROWS:
        raise InvalidAnnotations(f"Use at most {MAX_ARROWS} arrows.")
    arrows = []
    for item in data:
        if not isinstance(item, dict) or item.get("type") != "arrow":
            raise InvalidAnnotations("Only arrows are supported.")
        points = {key: item.get(key) for key in ("x1", "y1", "x2", "y2")}
        if not all(_unit(value) for value in points.values()):
            raise InvalidAnnotations("An arrow is outside the photo.")
        arrow = {"type": "arrow", **points}
        label = item.get("label")
        if label is not None:
            if not isinstance(label, str) or len(label.strip()) > MAX_LABEL_CHARS:
                raise InvalidAnnotations(f"Arrow labels are limited to {MAX_LABEL_CHARS} characters.")
            if label.strip():
                arrow["label"] = label.strip()
        arrows.append(arrow)
    return arrows
