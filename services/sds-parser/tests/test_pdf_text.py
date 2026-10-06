"""Tests for PDF text extraction, including the OCR fallback for scanned SDSs.

These need the service's PDF/OCR dependencies (pdfminer.six, pypdfium2,
pytesseract, Pillow) and the ``tesseract`` binary, so they skip cleanly on a
bare interpreter — the stdlib-only parser tests still run everywhere.
"""

from __future__ import annotations

import importlib.util
import shutil
import unittest
from pathlib import Path
from unittest import mock

from app.ocr import OcrError, ocr_pdf
from app.parser import parse_sds_text
from app.pdf_text import PdfTextError, extract_text_from_pdf
from pdf_builders import scanned_pdf, text_layer_pdf

OCR_MODULES = ("pdfminer", "pypdfium2", "pytesseract", "PIL")
OCR_AVAILABLE = shutil.which("tesseract") is not None and all(
    importlib.util.find_spec(name) for name in OCR_MODULES
)

FIXTURE_LINES = (
    (Path(__file__).parent / "fixtures" / "acetone_sds.txt").read_text(encoding="utf-8").splitlines()
)


@unittest.skipUnless(OCR_AVAILABLE, "needs tesseract + PDF/OCR Python packages")
class ExtractTextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.extracted = extract_text_from_pdf(scanned_pdf(FIXTURE_LINES))
        cls.parsed = parse_sds_text(cls.extracted.text)

    def test_text_layer_pdf_is_read_without_ocr(self) -> None:
        extracted = extract_text_from_pdf(text_layer_pdf(FIXTURE_LINES))
        self.assertFalse(extracted.via_ocr)
        self.assertIn("67-64-1", extracted.text)

    def test_scanned_pdf_falls_back_to_ocr(self) -> None:
        self.assertTrue(self.extracted.via_ocr)
        self.assertEqual(self.extracted.pages_skipped, 0)

    def test_ocr_text_parses_the_safety_critical_fields(self) -> None:
        self.assertEqual(self.parsed["product_name"], "Acetone")
        self.assertEqual(self.parsed["cas_numbers"], ["67-64-1"])
        self.assertEqual(self.parsed["flash_point_c"], -20.0)
        self.assertEqual(self.parsed["dot_un_number"], "UN1090")
        self.assertEqual([h["code"] for h in self.parsed["hazard_statements"]], ["H225", "H319", "H336"])

    def test_a_page_stamp_alone_is_rejected_as_not_an_sds(self) -> None:
        # Too little text layer, so OCR runs — and reads back only the same
        # stamp, which is still far too short to be an SDS.
        with self.assertRaisesRegex(PdfTextError, "too little text to be an SDS"):
            extract_text_from_pdf(text_layer_pdf(["Page 1 of 1"]))

    def test_unreadable_bytes_raise_pdf_text_error(self) -> None:
        with self.assertRaises(PdfTextError):
            extract_text_from_pdf(b"this is not a pdf")


@unittest.skipUnless(OCR_AVAILABLE, "needs tesseract + PDF/OCR Python packages")
class OcrPdfTests(unittest.TestCase):
    def test_page_cap_reports_skipped_pages(self) -> None:
        two_pages = scanned_pdf(["Page one"] * 3 + ["Page two"] * 3, lines_per_page=3)
        result = ocr_pdf(two_pages, max_pages=1)
        self.assertEqual((result.pages_read, result.total_pages, result.pages_skipped), (1, 2, 1))
        self.assertIn("Page one", result.text)
        self.assertNotIn("Page two", result.text)

    def test_missing_tesseract_binary_is_an_ocr_error(self) -> None:
        import pytesseract  # optional dependency; the skip guard ensures it exists

        with mock.patch.object(pytesseract.pytesseract, "tesseract_cmd", "/nonexistent/tesseract"):
            with self.assertRaisesRegex(OcrError, "not installed"):
                ocr_pdf(scanned_pdf(["Acetone"]))

    def test_non_pdf_bytes_are_an_ocr_error(self) -> None:
        with self.assertRaises(OcrError):
            ocr_pdf(b"this is not a pdf")


if __name__ == "__main__":
    unittest.main()
