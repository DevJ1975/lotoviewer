"""Fetch a part of the CFR from the eCFR API and split it into sections.

The parser is deliberately forgiving about the shape of the XML, because it was
written without access to the live API: a section number may be ``N="262.10"``
or ``N="§ 262.10"`` (it is read from the heading when the attribute is missing),
sections may sit under subparts, subject groups or neither, and a part with no
sections at all yields an empty list rather than an error. The caller decides
what an empty or suspiciously small result means.
"""

from __future__ import annotations

import hashlib
import re
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Iterator

from .catalog import EcfrSource
from .http import HttpFailure, request_with_retry

USER_AGENT = "SoteriaField-RAG/1.0 (+https://soteriafield.app)"
ECFR_FULL_URL = "https://www.ecfr.gov/api/versioner/v1/full/{date}/title-{title}.xml"
REQUEST_TIMEOUT_SECONDS = 120.0
# A single part is a few megabytes; this only stops a runaway response.
MAX_RESPONSE_BYTES = 60 * 1024 * 1024
MAX_TITLE_LENGTH = 300  # knowledge_documents.title check

# Elements whose text is one block. Anything else is looked into for them.
_BLOCK_TAGS = frozenset({"P", "FP", "HD1", "HD2", "HD3", "CITA", "AUTH", "SOURCE", "EDNOTE", "FTNT"})
_SECTION_NUMBER = re.compile(r"\d+\.\d+[A-Za-z0-9.\-]*")


class EcfrError(RuntimeError):
    """The eCFR response could not be used. A retry may help (a truncated body)."""


@dataclass(frozen=True)
class Section:
    citation: str          # "262.10", or "Appendix to Part 262"
    title: str             # "40 CFR 262.10 — Purpose, scope, and applicability"
    source_url: str
    subpart: str           # "A", or "" when the section is not under a subpart
    body: str
    is_appendix: bool

    @property
    def content_sha256(self) -> str:
        """Changes when the text or the title does, which is what a reload keys on."""
        return hashlib.sha256(f"{self.title}\n{self.body}".encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ParseResult:
    sections: list[Section]
    reserved: int         # sections with no text ([Reserved], removed)
    unrecognized: int     # sections whose number could not be determined


def fetch_part_xml(source: EcfrSource, date: str, client: Any) -> bytes:
    url = ECFR_FULL_URL.format(date=date, title=source.ecfr_title)
    response = request_with_retry(
        client, "GET", url, params={"part": source.ecfr_part},
        headers={"user-agent": USER_AGENT}, timeout=REQUEST_TIMEOUT_SECONDS,
    )
    content = response.content
    if len(content) > MAX_RESPONSE_BYTES:
        raise HttpFailure("eCFR response is larger than expected", retryable=False)
    return content


def parse_sections(xml: bytes, source: EcfrSource) -> ParseResult:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise EcfrError(f"eCFR response is not well-formed XML: {exc}") from exc

    scope = _find_part(root, source.ecfr_part) or root
    found: list[Section] = []
    counts = {"reserved": 0, "unrecognized": 0}
    seen: set[str] = set()
    for element, subpart in _sections(scope, ""):
        section = _build_section(element, subpart, source, counts)
        if section is not None and section.source_url not in seen:
            seen.add(section.source_url)
            found.append(section)
    return ParseResult(found, counts["reserved"], counts["unrecognized"])


def _find_part(root: ET.Element, part: str) -> ET.Element | None:
    for element in root.iter("DIV5"):
        if element.get("TYPE") == "PART" and (element.get("N") or "").strip() == part:
            return element
    return None


def _sections(element: ET.Element, subpart: str) -> Iterator[tuple[ET.Element, str]]:
    for child in element:
        if child.tag in ("DIV8", "DIV9"):
            yield child, subpart
        elif child.tag == "DIV6":  # a subpart: remember its letter for what is inside
            yield from _sections(child, (child.get("N") or "").strip())
        else:  # subject groups and any other wrapper
            yield from _sections(child, subpart)


def _build_section(element: ET.Element, subpart: str, source: EcfrSource, counts: dict[str, int]) -> Section | None:
    is_appendix = element.tag == "DIV9" or (element.get("TYPE") or "").upper() == "APPENDIX"
    heading = _clean(_text(element.find("HEAD"))) if element.find("HEAD") is not None else ""

    body = "\n\n".join(_blocks(element))
    if not body:
        counts["reserved"] += 1
        return None

    attribute = (element.get("N") or "").replace("§", "").strip()
    if is_appendix:
        citation = attribute or heading
    elif _SECTION_NUMBER.fullmatch(attribute):
        citation = attribute
    else:
        match = re.match(r"\s*§+\s*(" + _SECTION_NUMBER.pattern + ")", heading)
        citation = match.group(1) if match else ""
    if not citation:
        counts["unrecognized"] += 1
        return None

    if is_appendix:
        title = f"{source.citation_prefix} Part {source.ecfr_part} — {heading or citation}"
        url = f"{source.url_prefix}appendix-{urllib.parse.quote(citation, safe='')}"
    else:
        name = re.sub(r"^\s*§+\s*" + re.escape(citation) + r"\s*", "", heading).strip(" .—–-")
        title = f"{source.citation_prefix} {citation} — {name}" if name else f"{source.citation_prefix} {citation}"
        url = f"{source.url_prefix}section-{citation}"
    return Section(citation, title[:MAX_TITLE_LENGTH], url, subpart, body, is_appendix)


def _blocks(element: ET.Element) -> Iterator[str]:
    for child in element:
        if child.tag == "HEAD":
            continue
        if child.tag == "GPOTABLE":
            table = _table(child)
            if table:
                yield table
        elif child.tag in _BLOCK_TAGS:
            text = _clean(_text(child))
            if text:
                yield text
        else:  # EXTRACT, NOTE, nested wrappers
            yield from _blocks(child)


def _table(table: ET.Element) -> str:
    lines = ["[Table — see eCFR for formatted layout]"]
    heads = [_clean(_text(h)) for h in table.iter("CHED")]
    if any(heads):
        lines.append(" | ".join(h for h in heads if h))
    for row in table.iter("ROW"):
        cells = [_clean(_text(c)) for c in row.iter("ENT")]
        if any(cells):
            lines.append(" | ".join(c for c in cells if c))
    return "\n".join(lines) if len(lines) > 1 else ""


def _text(element: ET.Element | None) -> str:
    # Inline markup (italics, emphasis) sits inside words' neighbours, so join
    # with no separator: the source already carries the spaces.
    return "" if element is None else "".join(element.itertext())


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace(" ", " ")).strip()
