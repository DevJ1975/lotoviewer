"""PDF -> text extraction.

Isolated from parser.py so the parser stays stdlib-only and unit-testable on
raw text. pdfminer.six is pure-Python (no system libraries), which keeps the
container slim and the deploy story simple.
"""

from __future__ import annotations

import io


class PdfTextError(RuntimeError):
    """Raised when a PDF can't be read or yields no extractable text."""


def extract_text_from_pdf(data: bytes) -> str:
    """Extract text from PDF bytes. Raises PdfTextError on unreadable input or
    when extraction yields nothing (e.g. a scanned/image-only SDS with no text
    layer — which a non-OCR parser genuinely cannot read)."""
    try:
        from pdfminer.high_level import extract_text  # lazy: keeps import cost off /health
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise PdfTextError("pdfminer.six is not installed") from exc

    try:
        text = extract_text(io.BytesIO(data)) or ""
    except Exception as exc:  # pdfminer raises a variety of parse errors
        raise PdfTextError(f"Could not read PDF: {exc}") from exc

    if not text.strip():
        raise PdfTextError(
            "No extractable text in PDF (likely a scanned/image-only SDS). "
            "This parser does not OCR images."
        )
    return text
