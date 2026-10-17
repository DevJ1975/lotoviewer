"""Port of packages/core/src/photoStatus.ts.

loto_equipment.photo_status must be computed exactly the way the platform
computes it, or the equipment list and the placard disagree about which
machines still need photos. Keep this in lockstep with the TypeScript.
"""
from typing import Literal

PhotoStatus = Literal["missing", "partial", "complete"]


def compute_photo_status(
    equip_url: str | None,
    iso_url: str | None,
    needs_equip: bool | None = True,
    needs_iso: bool | None = True,
) -> PhotoStatus:
    """A null needs_* flag means "required", matching the platform."""
    has_equip = bool((equip_url or "").strip())
    has_iso = bool((iso_url or "").strip())
    equip_satisfied = needs_equip is False or has_equip
    iso_satisfied = needs_iso is False or has_iso
    if equip_satisfied and iso_satisfied:
        return "complete"
    if has_equip or has_iso:
        return "partial"
    return "missing"
