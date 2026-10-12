"""OCR for scanned (image-only) SDS PDFs.

Many manufacturer SDSs arrive as scans: every page is a picture, so the PDF has
no text layer for pdfminer to read. This module rasterizes each page with
PDFium (pypdfium2 ships its own binary, so there is no poppler system package
to install) and reads the pixels with Tesseract. Tesseract itself IS a system
binary — the Dockerfile installs ``tesseract-ocr``.

Kept separate from ``pdf_text.py`` so the text-layer path never pays the
import or runtime cost of OCR, and so a host without Tesseract still serves
every text-layer PDF.
"""

from __future__ import annotations

from dataclasses import dataclass

# Tesseract's accuracy on 8-10 pt SDS body text falls off sharply below
# ~300 DPI; rendering higher mostly costs time and memory.
RENDER_DPI = 300
PDF_POINTS_PER_INCH = 72

# A real SDS runs 6-20 pages. The cap bounds CPU time (~1-3 s per page) and
# memory on a malicious or mis-uploaded 500-page PDF; the first pages hold the
# sections that matter most (identification, hazards, composition).
MAX_OCR_PAGES = 30

# One stuck page must not hold a worker forever.
PAGE_TIMEOUT_SECONDS = 60


class OcrError(RuntimeError):
    """Raised when OCR is unavailable (Tesseract missing) or the PDF can't be rendered."""


@dataclass(frozen=True)
class OcrResult:
    text: str
    pages_read: int
    total_pages: int

    @property
    def pages_skipped(self) -> int:
        return self.total_pages - self.pages_read


def ocr_pdf(data: bytes, max_pages: int = MAX_OCR_PAGES) -> OcrResult:
    """Render up to ``max_pages`` pages of a PDF and OCR them in order."""
    try:
        import pypdfium2 as pdfium  # lazy: OCR deps are only needed for scans
        import pytesseract
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise OcrError("OCR dependencies are not installed (pypdfium2, pytesseract)") from exc

    try:
        document = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        raise OcrError(f"Could not render PDF for OCR: {exc}") from exc

    try:
        total_pages = len(document)
        pages_to_read = min(total_pages, max_pages)
        page_texts = [
            _ocr_page(document[index], pytesseract) for index in range(pages_to_read)
        ]
    finally:
        document.close()

    return OcrResult(text="\n".join(page_texts), pages_read=pages_to_read, total_pages=total_pages)


def _ocr_page(page, pytesseract) -> str:
    try:
        image = page.render(scale=RENDER_DPI / PDF_POINTS_PER_INCH, grayscale=True).to_pil()
        return pytesseract.image_to_string(image, lang="eng", timeout=PAGE_TIMEOUT_SECONDS)
    except pytesseract.TesseractNotFoundError as exc:
        raise OcrError("Tesseract is not installed on this host (apt-get install tesseract-ocr)") from exc
    except RuntimeError as exc:  # pytesseract signals a per-page timeout this way
        raise OcrError(f"OCR failed: {exc}") from exc
    finally:
        page.close()
