"""Tests for the eCFR fetch + parse (app/regulations/ecfr.py, http.py).

Written without access to the live API, so the parser's tolerance of the two
plausible section-number forms is tested rather than assumed. HTTP is faked with
httpx's mock transport; nothing here touches a network.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from app.regulations.catalog import CATALOG
from app.regulations.ecfr import (
    MAX_RESPONSE_BYTES,
    USER_AGENT,
    EcfrError,
    fetch_part_xml,
    parse_sections,
)
from app.regulations.http import MAX_ATTEMPTS, HttpFailure, request_with_retry

HTTPX = importlib.util.find_spec("httpx") is not None
SOURCE = CATALOG["epa-40-cfr-262"]
SAMPLE = (Path(__file__).parent / "fixtures" / "ecfr_part_sample.xml").read_bytes()


def parse(xml: bytes | str):
    return parse_sections(xml if isinstance(xml, bytes) else xml.encode("utf-8"), SOURCE)


class ParseTests(unittest.TestCase):
    def test_sections_and_the_appendix_are_found_in_order(self) -> None:
        result = parse(SAMPLE)
        self.assertEqual([s.citation for s in result.sections], ["262.10", "262.11", "262.32", "Appendix to Part 262"])
        self.assertEqual((result.reserved, result.unrecognized), (1, 0))

    def test_titles_urls_and_subparts(self) -> None:
        by = {s.citation: s for s in parse(SAMPLE).sections}
        self.assertEqual(by["262.10"].title, "40 CFR 262.10 — Purpose, scope, and applicability")
        self.assertEqual(by["262.10"].source_url, "https://www.ecfr.gov/current/title-40/part-262/section-262.10")
        self.assertEqual((by["262.10"].subpart, by["262.32"].subpart, by["Appendix to Part 262"].subpart), ("A", "C", ""))
        self.assertTrue(by["Appendix to Part 262"].is_appendix)
        self.assertEqual(by["Appendix to Part 262"].source_url,
                         "https://www.ecfr.gov/current/title-40/part-262/appendix-Appendix%20to%20Part%20262")

    def test_every_url_sits_under_the_parts_prune_prefix(self) -> None:
        self.assertTrue(all(s.source_url.startswith(SOURCE.url_prefix) for s in parse(SAMPLE).sections))

    def test_a_section_under_a_subject_group_keeps_its_subpart(self) -> None:
        self.assertEqual({s.citation: s.subpart for s in parse(SAMPLE).sections}["262.32"], "C")

    def test_inline_markup_keeps_the_sources_own_spacing(self) -> None:
        body = parse(SAMPLE).sections[0].body
        self.assertIn("(a) Purpose. This part establishes", body)

    def test_nested_extracts_and_amendment_notes_are_kept_as_blocks(self) -> None:
        by = {s.citation: s for s in parse(SAMPLE).sections}
        self.assertIn("(1) Sample extract paragraph with a reference.", by["262.11"].body)
        self.assertIn("[81 FR 85732, Nov. 28, 2016]", by["262.10"].body)

    def test_a_table_is_rendered_row_by_row_with_a_marker(self) -> None:
        body = {s.citation: s for s in parse(SAMPLE).sections}["262.32"].body
        self.assertIn("[Table — see eCFR for formatted layout]\nItem | Limit\nLabel | Required\nDate | Required", body)

    def test_a_reserved_section_is_skipped_and_counted(self) -> None:
        result = parse(SAMPLE)
        self.assertNotIn("262.12", [s.citation for s in result.sections])
        self.assertEqual(result.reserved, 1)

    def test_blocks_are_separated_by_blank_lines_for_the_chunker(self) -> None:
        self.assertEqual(parse(SAMPLE).sections[0].body.count("\n\n"), 2)


class SectionNumberFormTests(unittest.TestCase):
    """The live attribute form was not observable when this was written."""

    def test_the_bare_and_the_symbol_forms_give_the_same_section(self) -> None:
        bare = parse(SAMPLE.replace(b'N="\xc2\xa7 262.', b'N="262.'))
        symbol = parse(SAMPLE)
        self.assertEqual([s.citation for s in bare.sections], [s.citation for s in symbol.sections])
        self.assertEqual([s.source_url for s in bare.sections], [s.source_url for s in symbol.sections])

    def test_the_number_is_read_from_the_heading_when_the_attribute_is_missing(self) -> None:
        xml = '<DIV5 N="262" TYPE="PART"><DIV8 TYPE="SECTION"><HEAD>§ 262.15 Satellite accumulation.</HEAD><P>(a) Text.</P></DIV8></DIV5>'
        (section,) = parse(xml).sections
        self.assertEqual((section.citation, section.title), ("262.15", "40 CFR 262.15 — Satellite accumulation"))

    def test_a_section_whose_number_cannot_be_found_is_counted_not_guessed(self) -> None:
        xml = '<DIV5 N="262" TYPE="PART"><DIV8 N="weird" TYPE="SECTION"><HEAD>Untitled</HEAD><P>Text.</P></DIV8></DIV5>'
        result = parse(xml)
        self.assertEqual((result.sections, result.unrecognized), ([], 1))

    def test_a_section_without_a_heading_still_loads(self) -> None:
        (section,) = parse('<DIV5 N="262" TYPE="PART"><DIV8 N="262.99" TYPE="SECTION"><P>(a) Text.</P></DIV8></DIV5>').sections
        self.assertEqual(section.title, "40 CFR 262.99")

    def test_letter_suffixed_and_deep_section_numbers_are_accepted(self) -> None:
        xml = ('<DIV5 N="262" TYPE="PART">'
               '<DIV8 N="§ 262.17a" TYPE="SECTION"><HEAD>§ 262.17a X</HEAD><P>t</P></DIV8>'
               '<DIV8 N="§ 262.250-1" TYPE="SECTION"><HEAD>§ 262.250-1 Y</HEAD><P>t</P></DIV8></DIV5>')
        self.assertEqual([s.citation for s in parse(xml).sections], ["262.17a", "262.250-1"])


class ScopeAndRobustnessTests(unittest.TestCase):
    def test_only_the_requested_part_is_read_when_the_response_holds_several(self) -> None:
        xml = ('<ECFR><DIV5 N="261" TYPE="PART"><DIV8 N="§ 261.1" TYPE="SECTION"><HEAD>§ 261.1 A</HEAD><P>t</P></DIV8></DIV5>'
               '<DIV5 N="262" TYPE="PART"><DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 B</HEAD><P>t</P></DIV8></DIV5></ECFR>')
        self.assertEqual([s.citation for s in parse(xml).sections], ["262.1"])

    def test_a_response_with_no_part_wrapper_is_still_read(self) -> None:
        self.assertEqual(len(parse('<ECFR><DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 B</HEAD><P>t</P></DIV8></ECFR>').sections), 1)

    def test_no_sections_is_an_empty_result_not_an_error(self) -> None:
        result = parse('<ECFR><DIV5 N="262" TYPE="PART"><HEAD>PART 262</HEAD></DIV5></ECFR>')
        self.assertEqual((result.sections, result.reserved, result.unrecognized), ([], 0, 0))

    def test_malformed_xml_is_an_error_a_retry_can_cure(self) -> None:
        with self.assertRaises(EcfrError):
            parse(SAMPLE[: len(SAMPLE) // 2])

    def test_the_same_section_twice_is_kept_once(self) -> None:
        section = '<DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 B</HEAD><P>t</P></DIV8>'
        self.assertEqual(len(parse(f'<DIV5 N="262" TYPE="PART">{section}{section}</DIV5>').sections), 1)

    def test_the_hash_changes_with_the_text_and_with_the_title_only(self) -> None:
        a, = parse('<DIV5 N="262" TYPE="PART"><DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 B</HEAD><P>one</P></DIV8></DIV5>').sections
        same, = parse('<DIV5 N="262" TYPE="PART"><DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 B</HEAD><P>one</P></DIV8></DIV5>').sections
        text, = parse('<DIV5 N="262" TYPE="PART"><DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 B</HEAD><P>two</P></DIV8></DIV5>').sections
        title, = parse('<DIV5 N="262" TYPE="PART"><DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 C</HEAD><P>one</P></DIV8></DIV5>').sections
        self.assertEqual(a.content_sha256, same.content_sha256)
        self.assertNotEqual(a.content_sha256, text.content_sha256)
        self.assertNotEqual(a.content_sha256, title.content_sha256)

    def test_a_very_long_title_is_cut_to_the_database_limit(self) -> None:
        xml = f'<DIV5 N="262" TYPE="PART"><DIV8 N="§ 262.1" TYPE="SECTION"><HEAD>§ 262.1 {"x" * 500}</HEAD><P>t</P></DIV8></DIV5>'
        self.assertEqual(len(parse(xml).sections[0].title), 300)


@unittest.skipUnless(HTTPX, "needs httpx")
class HttpTests(unittest.TestCase):
    def client(self, handler):
        import httpx
        return httpx.Client(transport=httpx.MockTransport(handler))

    def test_the_request_names_the_date_title_and_part_and_identifies_itself(self) -> None:
        import httpx
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, content=SAMPLE)

        self.assertEqual(fetch_part_xml(SOURCE, "2026-05-07", self.client(handler)), SAMPLE)
        (request,) = seen
        self.assertEqual(request.url.path, "/api/versioner/v1/full/2026-05-07/title-40.xml")
        self.assertEqual(request.url.params["part"], "262")
        self.assertEqual(request.headers["user-agent"], USER_AGENT)

    def test_a_server_error_is_retried_then_succeeds(self) -> None:
        import httpx
        statuses = iter([503, 429, 200])
        waits: list[float] = []

        def handler(request):
            code = next(statuses)
            return httpx.Response(code, headers={"retry-after": "7"} if code == 429 else {}, content=SAMPLE)

        response = request_with_retry(self.client(handler), "GET", "https://x.test/a", sleep=waits.append)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(waits, [2.0, 7.0])  # exponential first, then what the server asked

    def test_a_server_that_never_recovers_is_a_retryable_failure_after_the_attempt_limit(self) -> None:
        import httpx
        calls = []

        def handler(request):
            calls.append(1)
            return httpx.Response(503)

        with self.assertRaises(HttpFailure) as caught:
            request_with_retry(self.client(handler), "GET", "https://x.test/a", sleep=lambda s: None)
        self.assertTrue(caught.exception.retryable)
        self.assertEqual(len(calls), MAX_ATTEMPTS)

    def test_a_client_error_fails_at_once_and_is_not_retryable(self) -> None:
        import httpx
        calls = []

        def handler(request):
            calls.append(1)
            return httpx.Response(404)

        with self.assertRaises(HttpFailure) as caught:
            request_with_retry(self.client(handler), "GET", "https://x.test/a", sleep=lambda s: None)
        self.assertFalse(caught.exception.retryable)
        self.assertEqual((caught.exception.status, len(calls)), (404, 1))

    def test_a_network_fault_is_retried(self) -> None:
        import httpx
        outcomes = iter([httpx.ConnectTimeout("slow"), httpx.Response(200, content=b"ok")])

        def handler(request):
            outcome = next(outcomes)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        response = request_with_retry(self.client(handler), "GET", "https://x.test/a", sleep=lambda s: None)
        self.assertEqual(response.content, b"ok")

    def test_the_failure_message_never_carries_the_query_string(self) -> None:
        import httpx
        with self.assertRaises(HttpFailure) as caught:
            request_with_retry(self.client(lambda r: httpx.Response(401)), "GET", "https://x.test/a?key=SECRET", sleep=lambda s: None)
        self.assertNotIn("SECRET", str(caught.exception))

    def test_an_oversized_response_is_refused(self) -> None:
        import httpx
        big = httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1))
        with self.assertRaises(HttpFailure):
            fetch_part_xml(SOURCE, "2026-05-07", self.client(lambda r: big))


if __name__ == "__main__":
    unittest.main()
