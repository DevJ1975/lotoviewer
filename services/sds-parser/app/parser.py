"""Deterministic (non-AI) Safety Data Sheet parser.

This module turns the plain text of a manufacturer SDS (authored under OSHA
HazCom 2012 / GHS Rev 8+ in the standard 16-section layout) into the exact
``ParsedSdsPayload`` shape the web app's AI parser produces
(``packages/core/src/chemicals.ts``). It exists as a fallback for when the
Anthropic API is unavailable (e.g. a monthly usage cap): the output drops into
``chemical_sds_documents.parsed_payload`` with ``parse_review_status='pending'``
so it flows through the same human review queue as the AI parse.

Design notes
------------
* Stdlib only. The heavy lifting is regex + heuristics over labeled SDS text,
  so this file has no third-party imports and is unit-testable on raw text
  without a PDF reader, FastAPI, or a network call.
* It never invents values. A field that can't be found is ``None`` (strings,
  numbers, enums) or ``[]`` (lists) — matching the web app's null semantics.
* Honesty over bravado. A heuristic parser cannot match an LLM's reading
  comprehension, so the overall confidence is intentionally capped at
  ``medium`` — the payload always lands in the review queue for a human to
  confirm, and ``parser_notes`` says so.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

# ── Vocabularies mirrored from packages/core/src/chemicals.ts ────────────────
# Kept in sync by hand; the web app's input validator rejects anything off
# these lists, so emitting an off-list value would just fail the apply step.

PHYSICAL_STATES = ["solid", "liquid", "gas", "aerosol", "mixture", "other"]
GHS_SIGNAL_WORDS = ["danger", "warning"]
GHS_PICTOGRAMS = ["GHS01", "GHS02", "GHS03", "GHS04", "GHS05", "GHS06", "GHS07", "GHS08", "GHS09"]

# This parser's identifier, stored in chemical_sds_documents.parse_model so an
# auditor can tell a heuristic parse from a Claude parse at a glance.
PARSER_MODEL = "python-sds-parser@1"

# ── Section detection ────────────────────────────────────────────────────────
# The 16 GHS sections, by the keyword that anchors each header. Headers vary
# wildly ("SECTION 1: Identification", "1. Identification", "Section 1 -
# IDENTIFICATION OF THE SUBSTANCE"), so we match the number plus a keyword.

_SECTION_KEYWORDS = {
    1:  r"identification",
    2:  r"hazard",
    3:  r"composition|ingredient",
    4:  r"first[\s-]?aid",
    5:  r"fire[\s-]?fighting|fire fighting",
    6:  r"accidental release",
    7:  r"handling|storage",
    8:  r"exposure control|personal protection",
    9:  r"physical and chemical|physical/chemical|physical & chemical",
    10: r"stability|reactivity",
    11: r"toxicolog",
    12: r"ecolog",
    13: r"disposal",
    14: r"transport",
    15: r"regulatory",
    16: r"other information",
}


def normalize_text(raw: str) -> str:
    """Collapse the noise PDF extraction leaves behind: NBSPs, carriage
    returns, runs of spaces, and long blank-line gaps."""
    text = raw.replace(" ", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_sections(text: str) -> dict[int, str]:
    """Slice the SDS into its numbered sections.

    Returns a map of section-number -> section body. A section absent from the
    document simply won't appear in the map; callers treat a missing section as
    "not found" and degrade the relevant confidence band.
    """
    # Find every plausible section header and where it starts.
    starts: list[tuple[int, int]] = []  # (char_index, section_number)
    for num, keyword in _SECTION_KEYWORDS.items():
        # "Section 1: Identification" / "1. Identification" / "1 Identification"
        pattern = re.compile(
            rf"(?im)^\s*(?:section\s+)?{num}\s*[:.\)\-]?\s+(?:[^\n]*?)(?:{keyword})",
        )
        m = pattern.search(text)
        if m:
            starts.append((m.start(), num))

    if not starts:
        return {}

    starts.sort()
    sections: dict[int, str] = {}
    for i, (start, num) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        # Skip the header line itself so a label search doesn't match it.
        body_start = text.find("\n", start)
        body_start = body_start + 1 if body_start != -1 else start
        sections[num] = text[body_start:end].strip()
    return sections


# ── Generic label extraction ─────────────────────────────────────────────────

def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    # Collapse whitespace and trim stray label punctuation / bullets — but NOT
    # a leading ASCII hyphen, which would silently flip a negative number
    # (e.g. a -20 °C flash point) to positive.
    v = re.sub(r"\s+", " ", value).strip().strip(":•·–—").strip()
    return v or None


def extract_labeled(text: str, labels: list[str]) -> Optional[str]:
    """Find the value for the first matching ``Label:`` in ``text``.

    Handles both inline ("Product name: Acetone") and stacked ("Product name\n
    Acetone") layouts. Stops the value at the next blank line so a label can't
    swallow the rest of a section.
    """
    for label in labels:
        # Wrap the label in a non-capturing group so an alternation inside it
        # binds locally and can't leave the value's capture group unmatched.
        # Inline: "Label: value" on one line.
        inline = re.search(rf"(?im)^\s*(?:{label})\s*[:\-–]\s*(\S.*)$", text)
        if inline:
            cleaned = _clean(inline.group(1))
            if cleaned:
                return cleaned
        # Stacked: "Label" then the next non-empty line.
        stacked = re.search(rf"(?im)^\s*(?:{label})\s*[:\-–]?\s*$\n+\s*(\S.*)$", text)
        if stacked:
            cleaned = _clean(stacked.group(1))
            if cleaned:
                return cleaned
    return None


def _section(sections: dict[int, str], num: int) -> str:
    return sections.get(num, "")


# ── Section 1 — identification ───────────────────────────────────────────────

def parse_identification(sec: str) -> dict:
    return {
        "product_name": extract_labeled(sec, [
            r"product name", r"product identifier", r"product",
            r"trade name", r"material name",
        ]),
        "manufacturer": extract_labeled(sec, [
            r"manufacturer", r"supplier", r"company name", r"company",
            r"manufactured by", r"distributor",
        ]),
        "product_code": extract_labeled(sec, [
            r"product code", r"product no\.?", r"product number",
            r"catalog(?:ue)? (?:no\.?|number)", r"item number", r"sku",
        ]),
        "recommended_use": extract_labeled(sec, [
            r"recommended use", r"relevant identified uses",
            r"identified uses", r"intended use", r"use of the substance",
        ]),
        "emergency_phone": _extract_phone(sec),
    }


def _extract_phone(sec: str) -> Optional[str]:
    near = extract_labeled(sec, [
        r"emergency (?:telephone|phone)(?: number)?",
        r"emergency contact", r"24[\s-]?hour emergency", r"chemtrec",
    ])
    if near:
        phone = re.search(r"[\d][\d\-\.\(\)\s\+x]{6,}\d", near)
        if phone:
            return _clean(phone.group(0))
        return near
    return None


# ── Section 3 — composition / CAS ────────────────────────────────────────────

_CAS_RE = re.compile(r"\b(\d{2,7}-\d{2}-\d)\b")


def is_valid_cas(cas: str) -> bool:
    """Validate a CAS Registry Number's trailing check digit.

    The check digit = (sum of each preceding digit * its position from the
    right, starting at 1) mod 10. Filters out look-alike numbers (dates,
    catalog codes) that match the digit pattern but aren't real CAS numbers.
    """
    digits = cas.replace("-", "")
    if len(digits) < 4:
        return False
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * i for i, d in enumerate(reversed(body), start=1))
    return total % 10 == check


def extract_cas_numbers(text: str) -> list[str]:
    seen: list[str] = []
    for m in _CAS_RE.finditer(text):
        cas = m.group(1)
        if is_valid_cas(cas) and cas not in seen:
            seen.append(cas)
    return seen


def extract_synonyms(sec: str) -> list[str]:
    raw = extract_labeled(sec, [r"synonyms?", r"other names?"])
    return _split_list(raw)


def _split_list(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    parts = re.split(r"[;,/•]|\s–\s", raw)
    out: list[str] = []
    for p in parts:
        c = _clean(p)
        if c and c.lower() not in {"none", "n/a", "na", "not applicable", "not available"}:
            out.append(c)
    return out


# ── Section 2 — hazard identification ────────────────────────────────────────

_HCODE_RE = re.compile(r"\b(H\d{3}[A-Za-z]?)\b\s*[:\-–]?\s*([^\n]*)")
_PCODE_RE = re.compile(r"\b(P\d{3}(?:\s*\+\s*P\d{3})*)\b\s*[:\-–]?\s*([^\n]*)")

# Pictogram phrases mapped to GHS codes. Order matters: the more specific
# "flame over circle" must win before the bare "flame".
_PICTOGRAM_PHRASES: list[tuple[str, str]] = [
    (r"explosiv|exploding bomb", "GHS01"),
    (r"flame over circle|oxidiz", "GHS03"),
    (r"\bflame\b|flammable", "GHS02"),
    (r"gas cylinder|compressed gas", "GHS04"),
    (r"corros", "GHS05"),
    (r"skull|acute tox", "GHS06"),
    (r"exclamation|\birritant\b|\bharmful\b", "GHS07"),
    (r"health hazard|carcinogen|silhouette|respiratory sensiti", "GHS08"),
    (r"environment|aquatic", "GHS09"),
]


def extract_signal_word(sec: str) -> Optional[str]:
    labeled = extract_labeled(sec, [r"signal word"])
    target = labeled if labeled else sec
    if re.search(r"(?i)\bdanger\b", target):
        return "danger"
    if re.search(r"(?i)\bwarning\b", target):
        return "warning"
    return None


def extract_code_statements(sec: str, regex: re.Pattern) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for m in regex.finditer(sec):
        code = re.sub(r"\s+", "", m.group(1))
        if code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "text": _clean(m.group(2)) or ""})
    return out


def extract_pictograms(sec: str) -> list[str]:
    out: list[str] = []
    # Explicit "GHS0x" codes win if present.
    for code in GHS_PICTOGRAMS:
        if re.search(rf"\b{code}\b", sec):
            out.append(code)
    if out:
        return out
    lowered = sec.lower()
    for phrase, code in _PICTOGRAM_PHRASES:
        if code in out:
            continue
        if re.search(phrase, lowered):
            out.append(code)
    # Preserve canonical GHS01..09 order.
    return [c for c in GHS_PICTOGRAMS if c in out]


# ── Section 9 — physical / chemical ──────────────────────────────────────────

def extract_physical_state(sec: str) -> Optional[str]:
    labeled = extract_labeled(sec, [r"physical state", r"\bform\b", r"\bstate\b", r"appearance"])
    target = (labeled or sec).lower()
    for state in PHYSICAL_STATES:
        if state == "other":
            continue
        if re.search(rf"\b{state}\b", target):
            return state
    # Common words that imply a state.
    if re.search(r"\bpowder|granul|crystal|pellet|flake\b", target):
        return "solid"
    return None


_TEMP_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*°?\s*([CF])\b", re.IGNORECASE)


def _to_celsius(value: float, unit: str) -> float:
    return round((value - 32) * 5 / 9, 1) if unit.upper() == "F" else value


def extract_temp_c(sec: str, labels: list[str]) -> Optional[float]:
    raw = extract_labeled(sec, labels)
    if not raw:
        return None
    m = _TEMP_RE.search(raw)
    if not m:
        return None
    return _to_celsius(float(m.group(1)), m.group(2))


def extract_vapor_pressure_kpa(sec: str) -> Optional[float]:
    raw = extract_labeled(sec, [r"vapou?r pressure"])
    if not raw:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(kpa|hpa|pa|mmhg|mm hg|torr|psi|bar|atm)", raw, re.IGNORECASE)
    if not m:
        return None
    value, unit = float(m.group(1)), m.group(2).lower().replace(" ", "")
    factors = {
        "kpa": 1.0, "hpa": 0.1, "pa": 0.001,
        "mmhg": 0.133322, "torr": 0.133322,
        "psi": 6.89476, "bar": 100.0, "atm": 101.325,
    }
    return round(value * factors.get(unit, 1.0), 3)


# ── Section 8 — exposure controls ────────────────────────────────────────────

def _extract_ppm(sec: str, label_pattern: str) -> Optional[float]:
    m = re.search(rf"(?i)(?:{label_pattern})[^\n]*?(\d+(?:\.\d+)?)\s*ppm", sec)
    return float(m.group(1)) if m else None


_PPE_KEYWORDS = [
    ("safety glasses", r"safety glass"),
    ("goggles", r"goggle"),
    ("face shield", r"face shield"),
    ("gloves", r"glove"),
    ("respirator", r"respirator|respiratory protection"),
    ("apron", r"apron"),
    ("protective clothing", r"protective clothing|protective suit|coverall"),
    ("boots", r"\bboots?\b"),
    ("local exhaust ventilation", r"local exhaust|ventilation|fume hood"),
]


def extract_ppe(sec: str) -> list[str]:
    lowered = sec.lower()
    return [label for label, pat in _PPE_KEYWORDS if re.search(pat, lowered)]


# ── Section 4 — first aid ────────────────────────────────────────────────────

def parse_first_aid(sec: str) -> dict:
    return {
        "inhalation": extract_labeled(sec, [r"inhalation", r"if inhaled", r"breathing"]),
        "skin":       extract_labeled(sec, [r"skin contact", r"\bskin\b", r"if on skin"]),
        "eyes":       extract_labeled(sec, [r"eye contact", r"\beyes?\b", r"if in eyes"]),
        "ingestion":  extract_labeled(sec, [r"ingestion", r"if swallowed", r"swallowed"]),
        "notes":      extract_labeled(sec, [r"notes? to physician", r"most important symptoms", r"general advice"]),
    }


# ── Section 5 — firefighting ─────────────────────────────────────────────────

def parse_firefighting(sec: str) -> dict:
    return {
        "suitable_extinguishers": _split_list(extract_labeled(sec, [
            r"suitable extinguishing media", r"extinguishing media",
        ])),
        "unsuitable_extinguishers": _split_list(extract_labeled(sec, [
            r"unsuitable extinguishing media", r"extinguishing media (?:that|which) must not be used",
        ])),
        "special_hazards": extract_labeled(sec, [
            r"special hazards?", r"specific hazards", r"hazardous combustion products",
        ]),
        "protective_equipment": extract_labeled(sec, [
            r"protective equipment", r"special protective equipment", r"advice for fire[\s-]?fighters",
        ]),
    }


# ── Section 6 — accidental release ───────────────────────────────────────────

def parse_spill_cleanup(sec: str) -> dict:
    return {
        "personal_precautions": extract_labeled(sec, [r"personal precautions"]),
        "environmental_precautions": extract_labeled(sec, [r"environmental precautions"]),
        "containment_methods": extract_labeled(sec, [
            r"methods? .* containment", r"\bcontainment\b",
        ]),
        "cleanup_methods": extract_labeled(sec, [
            r"methods? .* clean(?:ing)?[\s-]?up", r"clean[\s-]?up methods?", r"\bcleaning up\b",
        ]),
    }


# ── Section 7 / 10 — storage & incompatibilities ─────────────────────────────

def extract_storage_class(sec: str) -> Optional[str]:
    return extract_labeled(sec, [
        r"storage class", r"conditions for safe storage", r"\bstorage\b",
    ])


def extract_incompatibilities(sec: str) -> list[str]:
    return _split_list(extract_labeled(sec, [
        r"incompatible materials", r"materials to avoid", r"incompatibilit",
    ]))


# ── Section 14 — transport (DOT) ─────────────────────────────────────────────

def parse_transport(sec: str) -> dict:
    un = re.search(r"\bUN\s?(\d{4})\b", sec, re.IGNORECASE)
    return {
        "dot_un_number": f"UN{un.group(1)}" if un else None,
        "dot_hazard_class": extract_labeled(sec, [
            r"hazard class", r"transport hazard class(?:\(es\))?", r"\bclass\b",
        ]),
        "dot_packing_group": extract_labeled(sec, [r"packing group", r"packaging group"]),
    }


# ── NFPA 704 ─────────────────────────────────────────────────────────────────

def extract_nfpa(text: str) -> dict:
    """Pull NFPA 704 health/flammability/instability 0-4 ratings, but only
    when the document actually references NFPA — never derived from H-codes
    (the rating systems differ)."""
    blank = {"nfpa_health": None, "nfpa_flammability": None, "nfpa_instability": None, "nfpa_special": None}
    if not re.search(r"(?i)nfpa", text):
        return blank
    window = text[max(0, text.lower().find("nfpa")): text.lower().find("nfpa") + 400]

    def rating(label: str) -> Optional[int]:
        # Wrap the label in a non-capturing group so an alternation like
        # "flammability|fire" can't bind the bare word and leave group(1) None.
        m = re.search(rf"(?i)(?:{label})\D{{0,12}}([0-4])\b", window)
        return int(m.group(1)) if m else None

    return {
        "nfpa_health": rating(r"health"),
        "nfpa_flammability": rating(r"flammability|fire"),
        "nfpa_instability": rating(r"instability|reactivity"),
        "nfpa_special": extract_labeled(window, [r"special(?: hazard)?"]),
    }


# ── Metadata: revision date & language ───────────────────────────────────────

_DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d.%m.%Y", "%B %d, %Y", "%d %B %Y", "%b %d, %Y", "%d %b %Y", "%Y/%m/%d"]


def normalize_date(raw: Optional[str]) -> Optional[str]:
    """Best-effort parse of the many date layouts SDS use into ISO yyyy-mm-dd.
    Returns None if no recognized date is present (never guesses)."""
    if not raw:
        return None
    iso = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", raw)
    if iso:
        candidate = iso.group(0)
        try:
            return datetime.strptime(candidate, "%Y-%m-%d").date().isoformat()
        except ValueError:
            pass
    token = re.search(r"([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}[ /.\-][A-Za-z]+[ /.\-]\d{4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})", raw)
    candidate = token.group(0) if token else raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            d = datetime.strptime(candidate.replace(",", ""), fmt.replace(",", "")).date()
            if date(1980, 1, 1) <= d <= date(2100, 1, 1):
                return d.isoformat()
        except ValueError:
            continue
    return None


def extract_revision_date(sec16: str, full_text: str) -> Optional[str]:
    raw = extract_labeled(sec16, [
        r"revision date", r"date of (?:the latest )?revision", r"\brevision\b",
        r"version date", r"date prepared", r"issue date", r"date of issue",
    ]) or extract_labeled(full_text, [r"revision date", r"date of revision"])
    return normalize_date(raw)


# ── Confidence ───────────────────────────────────────────────────────────────

_RANK = {"high": 2, "medium": 1, "low": 0}
_BY_RANK = {2: "high", 1: "medium", 0: "low"}


def _band(found_strong: bool, found_any: bool) -> str:
    if found_strong:
        return "high"
    return "medium" if found_any else "low"


def compute_confidence(p: dict, sections_found: set[int]) -> dict:
    ident = _band(bool(p["product_name"]), bool(p["product_name"] or p["manufacturer"]))
    hazards = _band(bool(p["ghs_signal_word"] and p["hazard_statements"]),
                    bool(p["ghs_signal_word"] or p["hazard_statements"] or p["ghs_pictograms"]))
    physical = _band(bool(p["physical_state"] and (p["flash_point_c"] is not None or p["boiling_point_c"] is not None)),
                     bool(p["physical_state"] or p["appearance"]))
    exposure = _band(bool(p["pel_twa_ppm"] is not None or p["stel_ppm"] is not None),
                     bool(p["ppe_required"]))
    fa = p["first_aid"]
    fa_count = sum(1 for k in ("inhalation", "skin", "eyes", "ingestion") if fa.get(k))
    first_aid = _band(fa_count >= 2, fa_count >= 1)
    ff = p["firefighting"]
    firefighting = _band(bool(ff.get("suitable_extinguishers")), any(ff.values()))
    sc = p["spill_cleanup"]
    sc_count = sum(1 for v in sc.values() if v)
    spill = _band(sc_count >= 2, sc_count >= 1)
    transport = _band(bool(p["dot_un_number"]), bool(p["dot_hazard_class"] or p["dot_un_number"]))

    bands = {
        "identification": ident, "hazards": hazards, "physical": physical,
        "exposure": exposure, "first_aid": first_aid, "firefighting": firefighting,
        "spill_cleanup": spill, "transport": transport,
    }
    worst = _BY_RANK[min(_RANK[b] for b in bands.values())]
    # A heuristic parse is never trusted as "high" overall — it always gets a
    # human review. Cap the overall so canAutoApplyParse can never auto-apply.
    overall = "medium" if worst == "high" else worst
    return {"overall": overall, **bands}


# ── Top-level ────────────────────────────────────────────────────────────────

def parse_sds_text(raw_text: str) -> dict:
    """Parse SDS plain text into a ParsedSdsPayload-shaped dict."""
    text = normalize_text(raw_text)
    sections = split_sections(text)

    ident = parse_identification(_section(sections, 1) or text)
    sec2 = _section(sections, 2) or text
    sec3 = _section(sections, 3) or text
    sec9 = _section(sections, 9)

    payload: dict = {
        **ident,
        "cas_numbers": extract_cas_numbers(sec3),
        "synonyms": extract_synonyms(_section(sections, 1) or text),

        "physical_state": extract_physical_state(sec9),
        "appearance": extract_labeled(sec9, [r"appearance", r"colou?r and (?:form|odou?r)", r"colou?r"]),
        "flash_point_c": extract_temp_c(sec9, [r"flash point"]),
        "boiling_point_c": extract_temp_c(sec9, [r"boiling point", r"boiling point/range", r"initial boiling point"]),
        "vapor_pressure_kpa": extract_vapor_pressure_kpa(sec9),

        "ghs_signal_word": extract_signal_word(sec2),
        "ghs_pictograms": extract_pictograms(sec2),
        "hazard_statements": extract_code_statements(sec2, _HCODE_RE),
        "precautionary_statements": extract_code_statements(sec2, _PCODE_RE),

        **extract_nfpa(text),

        "pel_twa_ppm": _extract_ppm(_section(sections, 8), r"pel|twa|permissible"),
        "stel_ppm": _extract_ppm(_section(sections, 8), r"stel|short[\s-]?term"),
        "idlh_ppm": _extract_ppm(_section(sections, 8), r"idlh"),
        "ppe_required": extract_ppe(_section(sections, 8)),

        "first_aid": parse_first_aid(_section(sections, 4)),
        "firefighting": parse_firefighting(_section(sections, 5)),
        "spill_cleanup": parse_spill_cleanup(_section(sections, 6)),

        "storage_class": extract_storage_class(_section(sections, 7)),
        "incompatibilities": extract_incompatibilities(_section(sections, 10)),

        **parse_transport(_section(sections, 14)),

        "sds_revision_date": extract_revision_date(_section(sections, 16), text),
        "sds_language": "en",
    }

    payload["confidence"] = compute_confidence(payload, set(sections.keys()))
    payload["parser_notes"] = _build_notes(sections)
    return payload


def _build_notes(sections: dict[int, str]) -> str:
    missing = [str(n) for n in range(1, 17) if n not in sections]
    note = (
        "Parsed by the deterministic (non-AI) SDS fallback parser; overall "
        "confidence is intentionally capped — please review every field before "
        "approving. Pictograms are inferred from text labels and image-only "
        "pictograms are not captured."
    )
    if missing:
        note += f" Sections not detected in the document: {', '.join(missing)}."
    return note
