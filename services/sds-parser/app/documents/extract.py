"""Turn the text of an environmental document into reviewable fields.

The output is a *proposal*: every extraction lands in a review queue and a
person approves or corrects it before anything reaches a register or the
compliance calendar. So the extractor optimizes for being checkable — each
field names the text it came from — over being clever.
"""

from __future__ import annotations

from ..parser import normalize_text
from .classify import classify_document
from .fields import (
    CONFIDENCE_RANK,
    Field,
    extract_dot_numbers,
    extract_distinct_identifiers,
    extract_epa_ids,
    extract_labelled_dates,
    extract_labelled_permit_numbers,
    extract_manifest_tracking_numbers,
    extract_npdes_ids,
    extract_waste_codes,
)

EXTRACTOR_VERSION = "python-doc-extractor@1"

_PERMIT_TYPES = frozenset({"stormwater_permit", "swppp", "air_permit", "wastewater_permit", "monitoring_report"})
# Identifier fields that mean "this document names a permit or authorization".
_PERMIT_KEYS = frozenset({
    "permit_number", "npdes_permit_id", "tpdes_stormwater_authorization",
    "tceq_wastewater_permit", "water_board_order", "tceq_regulated_entity",
})


def extract_document(text: str, *, via_ocr: bool = False, pages_skipped: int = 0) -> dict:
    """Classify the text and extract the fields that matter for its type."""
    text = normalize_text(text)
    classification = classify_document(text)
    doc_type = classification.doc_type

    fields: list[Field] = []
    fields += extract_distinct_identifiers(text)
    fields += extract_npdes_ids(text)
    fields += extract_epa_ids(text)
    fields += extract_labelled_dates(text)
    if doc_type == "hazardous_waste_manifest":
        fields += extract_manifest_tracking_numbers(text)
        fields += extract_waste_codes(text)
        fields += extract_dot_numbers(text)
    if doc_type in _PERMIT_TYPES or doc_type == "other":
        fields += extract_labelled_permit_numbers(text, already=(f.value for f in fields))

    return {
        "extractor": EXTRACTOR_VERSION,
        "doc_type": doc_type,
        "doc_type_confidence": classification.confidence,
        "doc_type_signals": list(classification.signals),
        "fields": [f.as_dict() for f in fields],
        "overall_confidence": _overall_confidence(doc_type, fields, via_ocr),
        "via_ocr": via_ocr,
        "notes": _notes(doc_type, via_ocr, pages_skipped),
    }


def _overall_confidence(doc_type: str, fields: list[Field], via_ocr: bool) -> str:
    # OCR misreads concentrate in digits, which are the whole value of these
    # fields — so a scan always asks for the closest look.
    if via_ocr:
        return "low"
    if doc_type == "hazardous_waste_manifest":
        key = [f for f in fields if f.key == "manifest_tracking_number"]
    elif doc_type in _PERMIT_TYPES:
        key = [f for f in fields if f.key in _PERMIT_KEYS or f.key == "expiration_date"]
    else:
        return "low"  # an unrecognized document is only ever a lead
    if not key:
        return "low"
    best = max(CONFIDENCE_RANK[f.confidence] for f in key)
    return "high" if best == CONFIDENCE_RANK["high"] else "medium"


def _notes(doc_type: str, via_ocr: bool, pages_skipped: int) -> str:
    notes = [
        "Extracted by pattern matching, not read by a person: confirm every value "
        "against the original document before approving."
    ]
    if via_ocr:
        notes.append(
            "The text was read by OCR from a scan, so digits and letters can be "
            "confused (0/O, 1/I, 5/S, 8/B). Fields marked repaired were corrected "
            "from probable look-alikes."
        )
    if pages_skipped:
        notes.append(f"The last {pages_skipped} page(s) were not read (OCR page limit).")
    if doc_type == "hazardous_waste_manifest":
        notes.append(
            "Federal RCRA waste codes and UN/NA numbers are read. State waste codes, "
            "company names, addresses and quantities are not; EPA ID numbers are listed "
            "without telling generator, transporter and facility apart."
        )
    elif doc_type in _PERMIT_TYPES:
        notes.append("Permit limits, benchmarks and conditions are not extracted.")
    else:
        notes.append("This document was not recognized as a known type; only identifiers and labelled dates were looked for.")
    return " ".join(notes)
