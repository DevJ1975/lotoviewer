"""PDF -> text extraction: the embedded text layer first, OCR as a fallback.

Isolated from parser.py so the parser stays stdlib-only and unit-testable on
raw text. pdfminer.six is pure-Python (no system libraries) and reads the text
layer that almost every digitally-authored SDS has. Scanned SDSs have no text
layer, so those pages are rendered and read by Tesseract (see ocr.py).
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from .ocr import OcrError, ocr_pdf

# A real SDS runs to thousands of characters. Anything shorter cannot be one —
# typically the stray page-number stamp, fax header or watermark that a
# scanned PDF still carries — whether it came from the text layer or from OCR.
MIN_SDS_TEXT_CHARS = 200


class PdfTextError(RuntimeError):
    """Raised when a PDF can't be read or yields no extractable text."""


@dataclass(frozen=True)
class ExtractedText:
    text: str
    via_ocr: bool
    # OCR only: pages past ocr.MAX_OCR_PAGES that were not read.
    pages_skipped: int = 0


def extract_text_from_pdf(data: bytes) -> ExtractedText:
    """Extract text from PDF bytes, falling back to OCR for scanned documents.

    Raises PdfTextError when the PDF is unreadable, or when it has no usable
    text layer and OCR is unavailable or finds nothing.
    """
    text = _extract_text_layer(data)
    if _visible_char_count(text) >= MIN_SDS_TEXT_CHARS:
        return ExtractedText(text=text, via_ocr=False)

    try:
        ocr = ocr_pdf(data)
    except OcrError as exc:
        raise PdfTextError(
            f"No usable text layer in PDF (likely a scanned SDS) and OCR failed: {exc}"
        ) from exc

    if _visible_char_count(ocr.text) < MIN_SDS_TEXT_CHARS:
        raise PdfTextError(
            "No usable text layer in PDF and OCR found too little text to be an SDS. "
            "The scan may be blank, too faint, or not an SDS."
        )
    return ExtractedText(text=ocr.text, via_ocr=True, pages_skipped=ocr.pages_skipped)


def _extract_text_layer(data: bytes) -> str:
    try:
        from pdfminer.high_level import extract_text  # lazy: keeps import cost off /health
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise PdfTextError("pdfminer.six is not installed") from exc

    try:
        return extract_text(io.BytesIO(data)) or ""
    except Exception as exc:  # pdfminer raises a variety of parse errors
        raise PdfTextError(f"Could not read PDF: {exc}") from exc


def _visible_char_count(text: str) -> int:
    return sum(1 for char in text if not char.isspace())
