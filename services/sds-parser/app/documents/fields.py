"""Pattern extractors for identifiers and dates in environmental documents.

Honest by construction, like the SDS parser: a field is reported only when its
pattern validates, every field carries the text it came from (the reviewer
checks it against the original), and nothing is guessed. Confidence says how
much to trust it:

* ``high``   — a distinctive, validated format (a manifest tracking number, a
               TCEQ regulated-entity number) or a validated value next to its label
* ``medium`` — a label-driven capture, or a valid format with no label near it
* ``low``    — repaired from probable OCR digit confusions (O→0, I→1 ...)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from ..parser import normalize_date

CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2}

# US states, DC and territories: the first two characters of an EPA ID number.
STATE_CODES = frozenset(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT "
    "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split()
)

# RCRA waste-code lists and the highest number each has been assigned.
# (Verify against the current 40 CFR 261 subparts C and D before relying on a
# ceiling; a code above it is treated as not a waste code.)
WASTE_CODE_CEILING = {"D": 43, "F": 39, "K": 181, "P": 205, "U": 411}


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    value: str
    confidence: str
    evidence: str
    repaired: bool = False

    def as_dict(self) -> dict:
        return {
            "key": self.key, "label": self.label, "value": self.value,
            "confidence": self.confidence, "evidence": self.evidence, "repaired": self.repaired,
        }


def _snippet(text: str, start: int, end: int, pad: int = 40) -> str:
    """The matched text with a little context, on one line, for the reviewer."""
    raw = text[max(0, start - pad):end + pad]
    return re.sub(r"\s+", " ", raw).strip()[:160]


def _label_before(text: str, position: int, label: re.Pattern, window: int = 90) -> bool:
    return bool(label.search(text[max(0, position - window):position]))


def _unique(fields: Iterable[Field]) -> list[Field]:
    """First occurrence of each (key, value) wins; a later repeat adds nothing."""
    seen: set[tuple[str, str]] = set()
    out = []
    for f in fields:
        if (f.key, f.value) not in seen:
            seen.add((f.key, f.value))
            out.append(f)
    return out


# ── OCR digit repair ─────────────────────────────────────────────────────────
# Tesseract confuses look-alike glyphs most in exactly the characters these
# identifiers are made of. We only repair inside a slot that MUST be digits, and
# only when most of it already is, then mark the result low-confidence.
_DIGIT_LOOKALIKES = str.maketrans("OoIlSBZ", "0011582")


def _repair_digits(chars: str) -> Optional[str]:
    """Digits-only form of ``chars``, or None if too little of it is digits."""
    real = sum(c.isdigit() for c in chars)
    if real < len(chars) - 2:  # at most two look-alikes may be repaired
        return None
    fixed = chars.translate(_DIGIT_LOOKALIKES)
    return fixed if fixed.isdigit() else None


# ── Manifest tracking numbers ────────────────────────────────────────────────
_TRACKING_LABEL = re.compile(r"tracking\s*(?:no\.?|number|#)", re.IGNORECASE)
_TRACKING = re.compile(r"(?<![A-Za-z0-9])([0-9OoIlSBZ]{9})( ?)([A-Z]{3})(?![A-Za-z0-9])")


def extract_manifest_tracking_numbers(text: str) -> list[Field]:
    """Nine digits then a three-letter suffix (e.g. 012345678JJK)."""
    out = []
    for m in _TRACKING.finditer(text):
        digits, space, suffix = m.group(1), m.group(2), m.group(3)
        labelled = _label_before(text, m.start(), _TRACKING_LABEL)
        if space and not labelled:
            continue  # a spaced form is too easily two unrelated words
        repaired = not digits.isdigit()
        if repaired:
            fixed = _repair_digits(digits)
            if fixed is None or not labelled:
                continue  # never repair an unlabelled candidate: too many look-alikes
            digits = fixed
        if sum(c.isdigit() for c in digits) != 9:
            continue
        out.append(Field(
            "manifest_tracking_number", "Manifest tracking number", digits + suffix,
            "low" if repaired else ("high" if labelled else "medium"),
            _snippet(text, m.start(), m.end()), repaired,
        ))
    return _unique(out)


# ── EPA ID numbers ───────────────────────────────────────────────────────────
_EPA_ID = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2})([A-Z])([0-9OoIlSBZ]{9})(?![A-Za-z0-9])")
_EPA_ID_LABEL = re.compile(r"(?:epa|id)\s*(?:id)?\s*(?:no\.?|number|#)|generator.{0,12}id|transporter.{0,12}id", re.IGNORECASE)


def extract_epa_ids(text: str) -> list[Field]:
    """Twelve characters: state code, one letter, nine digits (e.g. CAD000000000).
    The role (generator, transporter, TSDF) is not told apart: the layout of a
    scan rarely makes that reliable, so the reviewer assigns it."""
    out = []
    for m in _EPA_ID.finditer(text):
        state, letter, digits = m.group(1), m.group(2), m.group(3)
        if state not in STATE_CODES:
            continue
        repaired = not digits.isdigit()
        if repaired:
            fixed = _repair_digits(digits)
            if fixed is None:
                continue
            digits = fixed
        labelled = _label_before(text, m.start(), _EPA_ID_LABEL, window=60)
        out.append(Field(
            "epa_id_number", "EPA ID number", f"{state}{letter}{digits}",
            "low" if repaired else ("high" if labelled else "medium"),
            _snippet(text, m.start(), m.end()), repaired,
        ))
    return _unique(out)


# ── Waste codes and DOT numbers (manifests) ──────────────────────────────────
_WASTE_CODE = re.compile(r"(?<![A-Za-z0-9])([DFKPU])(\d{3})(?![A-Za-z0-9])")
_WASTE_LABEL = re.compile(r"waste\s*codes?|epa\s+waste|hazardous\s+waste", re.IGNORECASE)


def extract_waste_codes(text: str) -> list[Field]:
    """Federal (RCRA) codes D001-D043, F001-F039, K001-K181, P001-P205, U001-U411.
    State-specific codes (California's three-digit codes, Texas's eight-digit
    waste codes) are NOT read: they are ambiguous without the form's layout."""
    out = []
    for m in _WASTE_CODE.finditer(text):
        letter, number = m.group(1), int(m.group(2))
        if not 1 <= number <= WASTE_CODE_CEILING[letter]:
            continue
        labelled = _label_before(text, m.start(), _WASTE_LABEL, window=120)
        out.append(Field(
            "waste_code", "Waste code", f"{letter}{number:03d}",
            "high" if labelled else "medium", _snippet(text, m.start(), m.end()),
        ))
    return _unique(out)


_DOT_NUMBER = re.compile(r"(?<![A-Za-z0-9])(UN|NA)\s?(\d{4})(?!\d)")


def extract_dot_numbers(text: str) -> list[Field]:
    out = []
    for m in _DOT_NUMBER.finditer(text):
        out.append(Field(
            "dot_number", "UN / NA number", f"{m.group(1)}{m.group(2)}", "high",
            _snippet(text, m.start(), m.end()),
        ))
    return _unique(out)


# ── Program identifiers with distinctive formats ─────────────────────────────
@dataclass(frozen=True)
class _Distinct:
    key: str
    label: str
    pattern: re.Pattern
    normalize: Callable[[str], str] = lambda s: re.sub(r"\s+", "", s).upper()


_DISTINCT = (
    # TCEQ identifiers: regulated entity and customer reference numbers.
    _Distinct("tceq_regulated_entity", "TCEQ regulated entity (RN)", re.compile(r"(?<![A-Za-z0-9])(RN\d{9})(?!\d)")),
    _Distinct("tceq_customer", "TCEQ customer reference (CN)", re.compile(r"(?<![A-Za-z0-9])(CN\d{9})(?!\d)")),
    # Texas MSGP authorization (TXR05xxxx) and TPDES wastewater permit (WQ0000000-000).
    # TXR050000 is the general permit itself, which every authorization letter
    # cites; it is not the facility's own number, so it must not be proposed as one.
    _Distinct("tpdes_stormwater_authorization", "TPDES stormwater authorization", re.compile(r"(?<![A-Za-z0-9])(TXR05(?!0000)[0-9A-Z]{4})(?![A-Za-z0-9])")),
    _Distinct("tceq_wastewater_permit", "TCEQ wastewater permit", re.compile(r"(?<![A-Za-z0-9])(WQ\d{7}-\d{3})(?!\d)")),
    # California State Water Board order numbers (e.g. the Industrial General Permit).
    _Distinct("water_board_order", "State Water Board order", re.compile(r"(?<![A-Za-z0-9])(\d{4}-\d{4}-DWQ)(?![A-Za-z0-9])")),
)


def extract_distinct_identifiers(text: str) -> list[Field]:
    out = []
    for spec in _DISTINCT:
        for m in spec.pattern.finditer(text):
            out.append(Field(spec.key, spec.label, spec.normalize(m.group(1)), "high", _snippet(text, m.start(), m.end())))
    return _unique(out)


# ── NPDES permit IDs (state code + 7 digits), label required ─────────────────
_NPDES = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2})(\d{7})(?!\d)")
_NPDES_LABEL = re.compile(r"npdes|tpdes|discharge\s+permit|permit\s+(?:no\.?|number|#|id)", re.IGNORECASE)


def extract_npdes_ids(text: str) -> list[Field]:
    out = []
    for m in _NPDES.finditer(text):
        if m.group(1) in STATE_CODES and _label_before(text, m.start(), _NPDES_LABEL, window=60):
            out.append(Field(
                "npdes_permit_id", "NPDES permit ID", f"{m.group(1)}{m.group(2)}", "high",
                _snippet(text, m.start(), m.end()),
            ))
    return _unique(out)


# ── Label-driven permit numbers (anything the patterns above do not cover) ───
_PERMIT_LABEL = re.compile(
    r"(?:permit|authori[sz]ation|registration|certificate|wdid|facility\s+id(?:entification)?)"
    r"\s*(?:no\.?|number|#|id)?\s*[:#]?\s*"
    r"(?P<value>[A-Z0-9][A-Z0-9\-/.]{3,24})",
    re.IGNORECASE,
)
_NOT_A_NUMBER = frozenset({"NONE", "NOT", "TBD", "NA", "N/A", "ISSUED", "NUMBER", "APPLICABLE", "HOLDER", "EXPIRES", "EXPIRATION", "EFFECTIVE"})


def extract_labelled_permit_numbers(text: str, already: Iterable[str]) -> list[Field]:
    known = {value.upper() for value in already}
    out = []
    for m in _PERMIT_LABEL.finditer(text):
        value = m.group("value").strip(".-/").upper()
        if value in _NOT_A_NUMBER or value in known:
            continue
        if sum(c.isdigit() for c in value) < 3:
            continue  # a number needs digits; "permit holder" etc. are prose
        if normalize_date(value):
            continue  # a date that followed the word "permit"
        out.append(Field("permit_number", "Permit / authorization number", value, "medium", _snippet(text, m.start(), m.end())))
    return _unique(out)


# ── Labelled dates ───────────────────────────────────────────────────────────
_DATE_TOKEN = (
    r"\d{4}-\d{2}-\d{2}"
    r"|\d{1,2}/\d{1,2}/\d{4}"
    r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}"
    r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}"
)

_DATE_LABELS: tuple[tuple[str, str, str], ...] = (
    ("expiration_date", "Expiration date", r"expir(?:ation|es|y)(?:\s+date)?|valid\s+(?:through|until|to)|term\s+ends?|expires\s+on"),
    ("effective_date", "Effective date", r"effective(?:\s+date)?|date\s+effective|permit\s+term\s+begins?"),
    ("issue_date", "Issue date", r"(?:date\s+)?issued?(?:\s+date)?|date\s+of\s+issuance|issuance\s+date"),
    ("renewal_due_date", "Renewal due", r"renewal\s+(?:application\s+)?(?:due|deadline)(?:\s+date)?|renew\s+by"),
    ("ship_date", "Shipment date", r"(?:date\s+of\s+)?shipment|ship(?:ped|ping)?\s+date|date\s+shipped"),
)


def extract_labelled_dates(text: str) -> list[Field]:
    out = []
    for key, label, label_re in _DATE_LABELS:
        pattern = re.compile(rf"(?:{label_re})\s*[:\-–]?\s*(?:\w+\s+){{0,2}}?({_DATE_TOKEN})", re.IGNORECASE)
        for m in pattern.finditer(text):
            iso = normalize_date(m.group(1))
            if iso:
                out.append(Field(key, label, iso, "medium", _snippet(text, m.start(), m.end())))
    return _unique(out)
