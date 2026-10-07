"""Tests for reading environmental documents (app/documents).

Stdlib ``unittest`` and pure text in / fields out, like the SDS parser tests.
The fixtures are synthetic: formats are realistic, identifiers are fake.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from app.documents.classify import classify_document
from app.documents.extract import extract_document
from app.documents.fields import (
    extract_dot_numbers,
    extract_epa_ids,
    extract_labelled_dates,
    extract_labelled_permit_numbers,
    extract_manifest_tracking_numbers,
    extract_npdes_ids,
    extract_waste_codes,
    extract_distinct_identifiers,
)

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def values(fields, key: str) -> list[str]:
    return [f.value for f in fields if f.key == key]


def by_key(result: dict, key: str) -> list[str]:
    return [f["value"] for f in result["fields"] if f["key"] == key]


class ClassifyTests(unittest.TestCase):
    def test_each_fixture_is_recognized(self) -> None:
        for name, expected in (
            ("manifest_sample.txt", "hazardous_waste_manifest"),
            ("tx_msgp_authorization.txt", "stormwater_permit"),
            ("air_permit_sample.txt", "air_permit"),
        ):
            with self.subTest(name):
                self.assertEqual(classify_document(fixture(name)).doc_type, expected)

    def test_a_clear_manifest_is_high_confidence_and_explains_itself(self) -> None:
        c = classify_document(fixture("manifest_sample.txt"))
        self.assertEqual(c.confidence, "high")
        self.assertIn("manifest tracking number", c.signals)

    def test_an_unrelated_document_is_other_and_low(self) -> None:
        c = classify_document(fixture("not_environmental.txt"))
        self.assertEqual((c.doc_type, c.confidence, c.signals), ("other", "low", ()))

    def test_a_single_weak_mention_is_not_enough_to_name_a_type(self) -> None:
        self.assertEqual(classify_document("We use a transporter for deliveries.").doc_type, "other")

    def test_a_swppp_beats_the_permit_it_responds_to(self) -> None:
        text = (
            "STORM WATER POLLUTION PREVENTION PLAN (SWPPP). This plan satisfies the "
            "Multi-Sector General Permit. Pollution prevention team: see section 2."
        )
        self.assertEqual(classify_document(text).doc_type, "swppp")

    def test_empty_text(self) -> None:
        self.assertEqual(classify_document("").doc_type, "other")


class ManifestTrackingTests(unittest.TestCase):
    def test_a_labelled_tracking_number_is_high_confidence(self) -> None:
        (f,) = extract_manifest_tracking_numbers("Manifest Tracking Number: 012345678JJK")
        self.assertEqual((f.value, f.confidence, f.repaired), ("012345678JJK", "high", False))

    def test_an_unlabelled_compact_number_is_medium(self) -> None:
        (f,) = extract_manifest_tracking_numbers("ref 012345678ELC attached")
        self.assertEqual(f.confidence, "medium")

    def test_a_spaced_number_needs_its_label(self) -> None:
        # "123456789 ABC" is two unrelated words far too often to accept alone.
        self.assertEqual(extract_manifest_tracking_numbers("order 123456789 ABC shipped"), [])
        (f,) = extract_manifest_tracking_numbers("Manifest Tracking No. 123456789 ELC")
        self.assertEqual(f.value, "123456789ELC")

    def test_ocr_lookalikes_are_repaired_only_when_labelled_and_marked_low(self) -> None:
        (f,) = extract_manifest_tracking_numbers("Manifest Tracking Number: 0I2345678 JJK")
        self.assertEqual((f.value, f.confidence, f.repaired), ("012345678JJK", "low", True))
        self.assertEqual(extract_manifest_tracking_numbers("ref 0I2345678JJK"), [])  # unlabelled: never repaired

    def test_wrong_shapes_are_ignored(self) -> None:
        for text in ("12345678JJK", "0123456789JJK", "012345678JJ", "012345678jjk"):
            with self.subTest(text):
                self.assertEqual(extract_manifest_tracking_numbers(text), [])

    def test_repeats_are_listed_once(self) -> None:
        text = "Manifest Tracking Number: 012345678JJK ... Tracking No 012345678JJK"
        self.assertEqual(len(extract_manifest_tracking_numbers(text)), 1)


class EpaIdTests(unittest.TestCase):
    def test_valid_ids_are_found_without_guessing_their_role(self) -> None:
        ids = extract_epa_ids(fixture("manifest_sample.txt"))
        self.assertEqual(
            sorted(f.value for f in ids),
            ["CAD000000001", "CAD000000002", "CAD000000004", "TXD000000003"],
        )

    def test_a_non_state_prefix_is_not_an_epa_id(self) -> None:
        self.assertEqual(extract_epa_ids("part ZZD123456789 in stock"), [])

    def test_an_ocr_misread_digit_is_repaired_and_marked_low(self) -> None:
        (f,) = extract_epa_ids("EPA ID Number: CAD00000O001")
        self.assertEqual((f.value, f.confidence, f.repaired), ("CAD000000001", "low", True))

    def test_mostly_letters_is_not_repaired(self) -> None:
        self.assertEqual(extract_epa_ids("CADOOOOOOOO1"), [])

    def test_a_labelled_id_is_high_and_an_unlabelled_one_is_medium(self) -> None:
        (a,) = extract_epa_ids("Generator ID Number: CAD000000001")
        (b,) = extract_epa_ids("see CAD000000001")
        self.assertEqual((a.confidence, b.confidence), ("high", "medium"))


class WasteCodeTests(unittest.TestCase):
    def test_federal_codes_inside_their_ranges_are_read(self) -> None:
        got = values(extract_waste_codes("Waste codes: D001 F003 K181 P205 U411"), "waste_code")
        self.assertEqual(got, ["D001", "F003", "K181", "P205", "U411"])

    def test_codes_past_the_end_of_a_list_are_not_waste_codes(self) -> None:
        self.assertEqual(extract_waste_codes("D044 F040 K182 P206 U412 D000"), [])

    def test_a_longer_token_is_not_a_waste_code(self) -> None:
        self.assertEqual(extract_waste_codes("model D0011 and XD001"), [])

    def test_a_california_state_code_is_deliberately_not_read(self) -> None:
        self.assertEqual(extract_waste_codes("State waste codes: 331"), [])

    def test_dot_numbers(self) -> None:
        got = values(extract_dot_numbers("UN1993, Waste Flammable liquids; NA1993; UN 1263; UN12345"), "dot_number")
        self.assertEqual(got, ["UN1993", "NA1993", "UN1263"])


class IdentifierTests(unittest.TestCase):
    def test_distinctive_texas_and_california_identifiers(self) -> None:
        text = fixture("tx_msgp_authorization.txt") + "\n" + fixture("ca_igp_coverage.txt")
        got = {f.key: f.value for f in extract_distinct_identifiers(text) if f.key != "water_board_order"}
        self.assertEqual(got["tpdes_stormwater_authorization"], "TXR05AB12")
        self.assertEqual(got["tceq_regulated_entity"], "RN100000001")
        self.assertEqual(got["tceq_customer"], "CN600000001")

    def test_the_general_permit_number_is_not_mistaken_for_the_facilitys_authorization(self) -> None:
        text = "Multi-Sector General Permit TXR050000. Authorization Number: TXR050001"
        got = values(extract_distinct_identifiers(text), "tpdes_stormwater_authorization")
        self.assertEqual(got, ["TXR050001"])

    def test_every_water_board_order_in_a_citation_is_listed(self) -> None:
        orders = values(extract_distinct_identifiers(fixture("ca_igp_coverage.txt")), "water_board_order")
        self.assertEqual(orders, ["2014-0057-DWQ", "2015-0122-DWQ", "2018-0028-DWQ"])

    def test_a_tceq_wastewater_permit_number(self) -> None:
        (f,) = extract_distinct_identifiers("Permit WQ0001234-000 issued")
        self.assertEqual(f.value, "WQ0001234-000")

    def test_rn_needs_exactly_nine_digits(self) -> None:
        self.assertEqual(extract_distinct_identifiers("RN12345678 and RN1234567890"), [])

    def test_npdes_ids_need_a_nearby_label(self) -> None:
        self.assertEqual(extract_npdes_ids("customer account TX0012345"), [])
        (f,) = extract_npdes_ids("NPDES Permit No. TX0012345")
        self.assertEqual(f.value, "TX0012345")

    def test_npdes_ids_need_a_real_state_code(self) -> None:
        self.assertEqual(extract_npdes_ids("NPDES permit ZZ0012345"), [])


class LabelledPermitNumberTests(unittest.TestCase):
    def test_a_labelled_number_is_captured_at_medium_confidence(self) -> None:
        got = extract_labelled_permit_numbers(fixture("air_permit_sample.txt"), already=[])
        self.assertEqual(sorted(f.value for f in got), ["123456", "F98765"])
        self.assertTrue(all(f.confidence == "medium" for f in got))

    def test_prose_after_the_word_permit_is_not_a_number(self) -> None:
        self.assertEqual(extract_labelled_permit_numbers("Permit holder: Example Foods. Permit status: active", already=[]), [])

    def test_a_date_after_the_label_is_not_a_number(self) -> None:
        self.assertEqual(extract_labelled_permit_numbers("Permit issued: 04/01/2024", already=[]), [])

    def test_identifiers_found_by_a_stricter_pattern_are_not_repeated(self) -> None:
        got = extract_labelled_permit_numbers("Authorization Number: TXR05AB12", already=["TXR05AB12"])
        self.assertEqual(got, [])

    def test_a_number_needs_at_least_three_digits(self) -> None:
        self.assertEqual(extract_labelled_permit_numbers("Permit No: A12B", already=[]), [])


class DateTests(unittest.TestCase):
    def test_labelled_dates_in_the_layouts_permits_use(self) -> None:
        got = {f.key: f.value for f in extract_labelled_dates(fixture("tx_msgp_authorization.txt"))}
        self.assertEqual(got, {"issue_date": "2026-01-20", "effective_date": "2026-01-20", "expiration_date": "2031-03-04"})

    def test_day_month_year_and_expires_wording(self) -> None:
        got = {f.key: f.value for f in extract_labelled_dates(fixture("ca_igp_coverage.txt"))}
        self.assertEqual(got["issue_date"], "2025-02-15")
        air = {f.key: f.value for f in extract_labelled_dates(fixture("air_permit_sample.txt"))}
        self.assertEqual((air["expiration_date"], air["renewal_due_date"]), ("2027-04-30", "2027-01-30"))

    def test_an_impossible_date_is_rejected_not_guessed(self) -> None:
        self.assertEqual(extract_labelled_dates("Expiration Date: 02/30/2027"), [])

    def test_an_unlabelled_date_is_not_extracted(self) -> None:
        self.assertEqual(extract_labelled_dates("Total due by 03/31/2026"), [])

    def test_a_two_digit_year_is_not_guessed(self) -> None:
        self.assertEqual(extract_labelled_dates("Expiration Date: 03/15/27"), [])


class ExtractDocumentTests(unittest.TestCase):
    def test_a_manifest_yields_its_key_fields_and_is_trusted_as_far_as_its_tracking_number(self) -> None:
        r = extract_document(fixture("manifest_sample.txt"))
        self.assertEqual(r["doc_type"], "hazardous_waste_manifest")
        self.assertEqual(by_key(r, "manifest_tracking_number"), ["012345678JJK"])
        self.assertEqual(by_key(r, "waste_code"), ["D001", "F003", "F005"])
        self.assertEqual(by_key(r, "dot_number"), ["UN1993", "UN1263"])
        self.assertEqual(sorted(by_key(r, "ship_date")), ["2026-03-15"])  # both date layouts, one value
        self.assertEqual(r["overall_confidence"], "high")
        self.assertIn("State waste codes", r["notes"])

    def test_a_permit_yields_identifiers_and_dates_but_no_manifest_fields(self) -> None:
        r = extract_document(fixture("tx_msgp_authorization.txt"))
        self.assertEqual(r["doc_type"], "stormwater_permit")
        self.assertEqual(by_key(r, "tpdes_stormwater_authorization"), ["TXR05AB12"])
        self.assertEqual(by_key(r, "expiration_date"), ["2031-03-04"])
        self.assertEqual(by_key(r, "manifest_tracking_number"), [])
        self.assertEqual(r["overall_confidence"], "high")

    def test_an_air_permit_uses_label_driven_numbers_so_is_only_medium(self) -> None:
        r = extract_document(fixture("air_permit_sample.txt"))
        self.assertEqual(r["doc_type"], "air_permit")
        self.assertIn("F98765", by_key(r, "permit_number"))
        self.assertEqual(r["overall_confidence"], "medium")

    def test_an_unrelated_document_proposes_nothing_worth_filing(self) -> None:
        r = extract_document(fixture("not_environmental.txt"))
        self.assertEqual(r["doc_type"], "other")
        self.assertEqual(r["overall_confidence"], "low")
        # "Order number 884421" is a label-driven capture the reviewer can reject; no IDs or dates invented.
        self.assertEqual([f["key"] for f in r["fields"] if f["key"] != "permit_number"], [])
        self.assertIn("not recognized", r["notes"])

    def test_a_scan_is_always_low_confidence_and_says_why(self) -> None:
        r = extract_document(fixture("manifest_sample.txt"), via_ocr=True, pages_skipped=2)
        self.assertEqual(r["overall_confidence"], "low")
        self.assertTrue(r["via_ocr"])
        self.assertIn("OCR", r["notes"])
        self.assertIn("last 2 page(s) were not read", r["notes"])

    def test_every_field_names_the_text_it_came_from(self) -> None:
        for name in ("manifest_sample.txt", "tx_msgp_authorization.txt", "ca_igp_coverage.txt", "air_permit_sample.txt"):
            for f in extract_document(fixture(name))["fields"]:
                with self.subTest(name=name, key=f["key"]):
                    self.assertTrue(f["evidence"])
                    self.assertLessEqual(len(f["evidence"]), 160)
                    self.assertNotIn("\n", f["evidence"])

    def test_empty_text_is_safe(self) -> None:
        r = extract_document("")
        self.assertEqual((r["doc_type"], r["fields"], r["overall_confidence"]), ("other", [], "low"))

    def test_the_result_is_json_serializable(self) -> None:
        import json
        json.dumps(extract_document(fixture("manifest_sample.txt")))


if __name__ == "__main__":
    unittest.main()
