"""Port of packages/core/src/storagePaths.ts for the photos this tool writes.

Storage RLS (migration 033) requires the first path segment to be the
tenant UUID, and the platform's tooling expects this exact layout, so a
photo taken here is indistinguishable from one taken in the app.
"""
import re

from .models import Slot

_UNSAFE = re.compile(r"[^a-zA-Z0-9_-]")


def sanitize_id(equipment_id: str) -> str:
    return _UNSAFE.sub("_", equipment_id)


def equipment_photo_path(tenant_id: str, equipment_id: str, slot: Slot, timestamp_ms: int) -> str:
    safe = sanitize_id(equipment_id)
    return f"{tenant_id}/{safe}/{safe}_{slot.upper()}_{timestamp_ms}.jpg"
