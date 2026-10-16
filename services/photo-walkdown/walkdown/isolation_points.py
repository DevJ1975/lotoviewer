"""What to photograph at a machine, derived from its energy codes.

The same table the printed photo checklist uses, so the walkdown app and
the paper fallback tell a technician the same thing.
"""
import re

POINTS = [
    ("E", "Electrical disconnect (OFF, lock point and ID tag in frame)"),
    ("CP", "Control-panel disconnect"),
    ("G", "Manual gas shutoff valve"),
    ("P", "Air lockout valve at the filter/regulator"),
    ("CG", "Compressed-gas / receiver valve"),
    ("H", "Hydraulic unit shutoff and bleed point"),
    ("T", "Heat source and hot-oil valves"),
    ("S", "Steam valve(s)"),
    ("W", "Water valve(s)"),
    ("GR", "Blocking point (pin, stand or lowered position)"),
]
DEFAULT_POINT = "Main disconnect"

# Short enough for an arrow label (the platform prints labels on the placard).
SHORT_LABELS = {
    "E": "Electrical disconnect", "CP": "Control panel disconnect", "G": "Gas shutoff valve",
    "P": "Air lockout valve", "CG": "Compressed gas valve", "H": "Hydraulic shutoff",
    "T": "Hot oil / heat valve", "S": "Steam valve", "W": "Water valve", "GR": "Blocking point",
}

# Photo codes from the audit's internal catalogue mean nothing at the machine.
_INTERNAL_IMAGE = re.compile(r"\b(?:G\d{3}|U-[A-Za-z0-9#-]+-(?:iso|equip))\b")
_BOOKKEEPING = ("Confirm at the machine that this is its isolation point and that it covers "
                "every energy source, then mark 'Re-shot & verified'. ")


def points_to_photograph(energy_codes: list[str]) -> list[str]:
    points = [text for code, text in POINTS if code in energy_codes]
    return points or [DEFAULT_POINT]


def label_options(energy_codes: list[str]) -> list[str]:
    options = [SHORT_LABELS[code] for code, _ in POINTS if code in energy_codes]
    return options or [DEFAULT_POINT]


def reviewer_note(text: str) -> str:
    """The auditors' re-shoot advice, minus internal photo codes and the
    register bookkeeping sentence."""
    text = text.replace(_BOOKKEEPING, "")
    text = _INTERNAL_IMAGE.sub("a photo from another placard", text)
    text = re.sub(r"\(\s*(?:see|seen in)\s+a photo from another placard\s*\)", "", text)
    return re.sub(r"\s{2,}", " ", text).strip()
