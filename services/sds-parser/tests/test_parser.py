"""Unit tests for the deterministic SDS parser.

Stdlib `unittest` only (no pytest, no network, no PDF reader) so they run with
just `python -m unittest` from the service directory. They exercise the pure
text -> ParsedSdsPayload path against a synthetic 16-section SDS fixture plus a
few targeted edge cases.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from app.parser import (
    is_valid_cas,
    normalize_date,
    parse_sds_text,
    split_sections,
    PARSER_MODEL,
)

FIXTURE = (Path(__file__).parent / "fixtures" / "acetone_sds.txt").read_text(encoding="utf-8")


class SectionSplitTests(unittest.TestCase):
    def test_detects_all_present_sections(self) -> None:
        sections = split_sections(FIXTURE)
        for n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 16):
            self.assertIn(n, sections, f"section {n} should be detected")
        # Sections genuinely absent from the fixture stay absent.
        for n in (11, 12, 13, 15):
            self.assertNotIn(n, sections)

    def test_section_body_excludes_other_sections(self) -> None:
        sections = split_sections(FIXTURE)
        self.assertIn("67-64-1", sections[3])
        self.assertNotIn("Flash point", sections[3])


class CasTests(unittest.TestCase):
    def test_valid_cas_passes_check_digit(self) -> None:
        self.assertTrue(is_valid_cas("67-64-1"))   # acetone
        self.assertTrue(is_valid_cas("7732-18-5"))  # water

    def test_invalid_cas_rejected(self) -> None:
        self.assertFalse(is_valid_cas("67-64-2"))   # wrong check digit
        self.assertFalse(is_valid_cas("12-34-5"))


class DateTests(unittest.TestCase):
    def test_iso_passthrough(self) -> None:
        self.assertEqual(normalize_date("Revision date: 2024-03-15"), "2024-03-15")

    def test_us_and_long_formats(self) -> None:
        self.assertEqual(normalize_date("03/15/2024"), "2024-03-15")
        self.assertEqual(normalize_date("March 15, 2024"), "2024-03-15")

    def test_no_date_returns_none(self) -> None:
        self.assertIsNone(normalize_date("not stated"))
        self.assertIsNone(normalize_date(None))


class FullParseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.p = parse_sds_text(FIXTURE)

    # ── Section 1 ──
    def test_identification(self) -> None:
        self.assertEqual(self.p["product_name"], "Acetone")
        self.assertEqual(self.p["manufacturer"], "Example Chemical Co.")
        self.assertEqual(self.p["product_code"], "AC-100")
        self.assertIn("Solvent", self.p["recommended_use"])
        self.assertIn("1-800-424-9300", self.p["emergency_phone"])

    # ── Section 3 ──
    def test_cas_and_synonyms(self) -> None:
        self.assertEqual(self.p["cas_numbers"], ["67-64-1"])
        self.assertIn("2-Propanone", self.p["synonyms"])
        self.assertIn("Dimethyl ketone", self.p["synonyms"])

    # ── Section 2 ──
    def test_hazards(self) -> None:
        self.assertEqual(self.p["ghs_signal_word"], "danger")
        self.assertEqual(self.p["ghs_pictograms"], ["GHS02", "GHS07"])
        codes = [h["code"] for h in self.p["hazard_statements"]]
        self.assertEqual(codes, ["H225", "H319", "H336"])
        self.assertIn("flammable", self.p["hazard_statements"][0]["text"].lower())
        pcodes = [pp["code"] for pp in self.p["precautionary_statements"]]
        self.assertIn("P210", pcodes)
        self.assertIn("P233", pcodes)

    # ── Section 9 ──
    def test_physical(self) -> None:
        self.assertEqual(self.p["physical_state"], "liquid")
        self.assertIn("Colorless", self.p["appearance"])
        self.assertEqual(self.p["flash_point_c"], -20.0)
        self.assertEqual(self.p["boiling_point_c"], 56.0)
        # 184 mmHg -> 24.531 kPa
        self.assertAlmostEqual(self.p["vapor_pressure_kpa"], 24.531, places=2)

    def test_fahrenheit_conversion(self) -> None:
        p = parse_sds_text("SECTION 9: Physical and chemical properties\nFlash point: 32 °F\n")
        self.assertEqual(p["flash_point_c"], 0.0)

    # ── Section 8 ──
    def test_exposure(self) -> None:
        self.assertEqual(self.p["pel_twa_ppm"], 250.0)
        self.assertEqual(self.p["stel_ppm"], 750.0)
        self.assertIsNone(self.p["idlh_ppm"])
        self.assertIn("safety glasses", self.p["ppe_required"])
        self.assertIn("gloves", self.p["ppe_required"])

    # ── Section 4 / 5 / 6 ──
    def test_first_aid(self) -> None:
        self.assertIn("fresh air", self.p["first_aid"]["inhalation"])
        self.assertIn("soap and water", self.p["first_aid"]["skin"])

    def test_firefighting(self) -> None:
        self.assertIn("carbon dioxide", self.p["firefighting"]["suitable_extinguishers"])
        self.assertEqual(len(self.p["firefighting"]["suitable_extinguishers"]), 3)

    def test_spill_cleanup(self) -> None:
        self.assertIn("Evacuate", self.p["spill_cleanup"]["personal_precautions"])
        self.assertIn("Absorb", self.p["spill_cleanup"]["cleanup_methods"])

    # ── Section 10 / 14 ──
    def test_incompatibilities(self) -> None:
        self.assertIn("Strong oxidizing agents", self.p["incompatibilities"])

    def test_transport(self) -> None:
        self.assertEqual(self.p["dot_un_number"], "UN1090")
        self.assertEqual(self.p["dot_hazard_class"], "3")
        self.assertEqual(self.p["dot_packing_group"], "II")

    # ── NFPA / metadata ──
    def test_nfpa(self) -> None:
        self.assertEqual(self.p["nfpa_health"], 1)
        self.assertEqual(self.p["nfpa_flammability"], 3)
        self.assertEqual(self.p["nfpa_instability"], 0)

    def test_revision_date(self) -> None:
        self.assertEqual(self.p["sds_revision_date"], "2024-03-15")

    # ── Confidence & shape ──
    def test_confidence_capped_at_medium(self) -> None:
        # Even a richly-populated parse never claims "high" overall — a human
        # must review before any field is applied.
        self.assertEqual(self.p["confidence"]["overall"], "medium")
        self.assertEqual(self.p["confidence"]["identification"], "high")

    def test_payload_has_every_required_key(self) -> None:
        required = {
            "product_name", "manufacturer", "product_code", "recommended_use", "emergency_phone",
            "cas_numbers", "synonyms", "physical_state", "appearance",
            "flash_point_c", "boiling_point_c", "vapor_pressure_kpa",
            "ghs_signal_word", "ghs_pictograms", "hazard_statements", "precautionary_statements",
            "nfpa_health", "nfpa_flammability", "nfpa_instability", "nfpa_special",
            "pel_twa_ppm", "stel_ppm", "idlh_ppm", "ppe_required",
            "first_aid", "firefighting", "spill_cleanup",
            "storage_class", "incompatibilities",
            "dot_un_number", "dot_hazard_class", "dot_packing_group",
            "sds_revision_date", "sds_language", "confidence", "parser_notes",
        }
        self.assertEqual(set(self.p.keys()), required)


class EmptyInputTests(unittest.TestCase):
    def test_garbage_input_is_safe(self) -> None:
        p = parse_sds_text("this is not an SDS at all")
        self.assertIsNone(p["product_name"])
        self.assertEqual(p["cas_numbers"], [])
        self.assertEqual(p["ghs_pictograms"], [])
        self.assertEqual(p["confidence"]["overall"], "low")
        self.assertEqual(p["sds_language"], "en")


if __name__ == "__main__":
    unittest.main()
