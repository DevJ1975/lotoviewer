"""PDF bytes -> ParsedSdsPayload: the one path every entry point shares.

The HTTP endpoints and the background job worker both parse through here, so a
scanned SDS is OCR'd and flagged identically however it arrives.
"""

from __future__ import annotations

from .parser import apply_ocr_caveats, parse_sds_text
from .pdf_text import extract_text_from_pdf


def parse_sds_pdf(data: bytes) -> dict:
    """Extract text (OCR for scans) and parse it. Raises PdfTextError if unreadable."""
    extracted = extract_text_from_pdf(data)
    parsed = parse_sds_text(extracted.text)
    if extracted.via_ocr:
        return apply_ocr_caveats(parsed, extracted.pages_skipped)
    return parsed
