"""Tell what kind of environmental document a block of text is.

Weighted keyword signals, deterministic and explainable: the result says which
phrases it saw, so a reviewer can see why a permit was filed as a SWPPP.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

DOC_TYPES = (
    "hazardous_waste_manifest",
    "stormwater_permit",
    "swppp",
    "air_permit",
    "wastewater_permit",
    "monitoring_report",
    "other",
)

# (pattern, weight). A weight-3 phrase is something only that document type says.
_SIGNALS: dict[str, tuple[tuple[str, int], ...]] = {
    "hazardous_waste_manifest": (
        (r"uniform\s+hazardous\s+waste\s+manifest", 3),
        (r"manifest\s+tracking\s+number", 3),
        (r"8700-22", 3),
        (r"designated\s+facility", 2),
        (r"generator'?s?\s+(?:us\s+)?epa\s+id", 2),
        (r"transporter", 1),
        (r"waste\s+codes?", 1),
    ),
    "swppp": (
        (r"storm\s?water\s+pollution\s+prevention\s+plan", 3),
        (r"\bswppp\b", 3),
        (r"\bswp3\b", 3),
        (r"pollution\s+prevention\s+team", 2),
        (r"best\s+management\s+practices", 1),
        (r"site\s+map", 1),
    ),
    "stormwater_permit": (
        (r"multi-?sector\s+general\s+permit", 3),
        (r"industrial\s+general\s+permit", 3),
        (r"txr05", 3),
        (r"notice\s+of\s+intent", 2),
        (r"storm\s?water", 1),
        (r"\bnpdes\b|\btpdes\b", 1),
        (r"\bdwq\b", 1),
    ),
    "air_permit": (
        (r"air\s+(?:quality\s+)?permit", 3),
        (r"permit\s+to\s+operate", 3),
        (r"title\s+v\b", 2),
        (r"emission\s+(?:unit|limit|point|source)s?", 2),
        (r"\baqmd\b|air\s+quality\s+management\s+district", 2),
        (r"permit\s+by\s+rule|standard\s+permit", 2),
        (r"new\s+source\s+review|\bnsr\b", 2),
    ),
    "wastewater_permit": (
        (r"wastewater", 2),
        (r"pretreatment", 2),
        (r"\bpotw\b", 2),
        (r"industrial\s+user", 2),
        (r"sewer\s+(?:use|discharge)", 2),
        (r"discharge\s+permit", 2),
    ),
    "monitoring_report": (
        (r"discharge\s+monitoring\s+report", 4),
        (r"\bdmr\b", 2),
        (r"monitoring\s+period", 2),
        (r"effluent", 1),
    ),
}

# Below this score nothing is distinctive enough to name a type.
_MIN_SCORE = 3
# Both: a strong score and a clear lead over the runner-up.
_HIGH_SCORE, _HIGH_LEAD = 6, 3


@dataclass(frozen=True)
class Classification:
    doc_type: str
    confidence: str
    # The phrases that decided it, for the reviewer.
    signals: tuple[str, ...]


def classify_document(text: str) -> Classification:
    scores: dict[str, int] = {}
    seen: dict[str, list[str]] = {}
    for doc_type, signals in _SIGNALS.items():
        for pattern, weight in signals:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                scores[doc_type] = scores.get(doc_type, 0) + weight
                seen.setdefault(doc_type, []).append(re.sub(r"\s+", " ", match.group(0)).lower())
    if not scores:
        return Classification("other", "low", ())

    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    best, best_score = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0
    if best_score < _MIN_SCORE:
        return Classification("other", "low", ())
    confidence = "high" if best_score >= _HIGH_SCORE and best_score - runner_up >= _HIGH_LEAD else "medium"
    return Classification(best, confidence, tuple(seen[best]))
