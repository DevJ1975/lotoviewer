"""Tests for loading a part of the CFR (app/regulations: loader, store, job).

Everything external is faked: eCFR returns the synthetic fixture, the embedder
returns vectors that ENCODE the chunk they belong to (so a vector attached to the
wrong chunk is caught), and the store is in memory. This code was written without
access to the live eCFR or Voyage APIs, so dry-run and the refusal paths get as
much attention as the happy path.
"""

from __future__ import annotations

import importlib.util
import os
import re
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
from unittest import mock

from app.regulations import job as regulation_job
from app.regulations import loader
from app.regulations.catalog import CATALOG
from app.regulations.chunker import chunk_text
from app.regulations.ecfr import EcfrError, parse_sections
from app.regulations.http import HttpFailure
from app.regulations.job import REGULATION_INGEST_KIND, run_regulation_ingest, validate_payload
from app.regulations.loader import Heartbeat, LoadError, load_source
from app.regulations.store import (
    EmbeddedChunk,
    StoredSection,
    SupabaseKnowledgeStore,
    chunk_metadata,
)
from app.regulations.voyage import DIMENSIONS, EmbeddingError
from app.service_jobs import InvalidJobPayload, JobContext, LeaseLostError, PermanentJobError, ServiceJob

SOURCE = CATALOG["epa-40-cfr-262"]
SAMPLE = (Path(__file__).parent / "fixtures" / "ecfr_part_sample.xml").read_bytes()
SNAPSHOT = "2026-05-07"
PARSED = parse_sections(SAMPLE, SOURCE)


class FakeEmbedder:
    """A vector whose first number is the length of the text it embeds."""

    def __init__(self, fail_on_call: Optional[int] = None) -> None:
        self.calls: list[list[str]] = []
        self.fail_on_call = fail_on_call

    def embed_documents(self, texts):
        self.calls.append(list(texts))
        if self.fail_on_call == len(self.calls):
            raise EmbeddingError("Voyage request failed: down", retryable=True)
        return [[float(len(t))] + [0.0] * (DIMENSIONS - 1) for t in texts]


class FakeStore:
    def __init__(self, existing: Optional[dict[str, StoredSection]] = None) -> None:
        self.existing_rows = dict(existing or {})
        self.replaced: list[tuple] = []
        self.pruned: list[list[str]] = []
        self.snapshots: list[str] = []

    def existing(self, source):
        return dict(self.existing_rows)

    def replace(self, source, section, chunks):
        self.replaced.append((section, chunks))
        self.existing_rows[section.source_url] = StoredSection(section.content_sha256, section.title)

    def prune(self, source, keep_urls):
        self.pruned.append(list(keep_urls))
        gone = [u for u in self.existing_rows if u not in keep_urls]
        for url in gone:
            del self.existing_rows[url]
        return len(gone)

    def record_snapshot(self, source, snapshot):
        self.snapshots.append(snapshot)

    @property
    def writes(self) -> int:
        return len(self.replaced) + len(self.pruned) + len(self.snapshots)


def run(store=None, embedder=None, dry_run=False, beat=None, xml=SAMPLE):
    store = store or FakeStore()
    embedder = embedder or FakeEmbedder()
    made = []

    def make_embedder():
        made.append(1)
        return embedder

    with mock.patch.object(loader, "fetch_part_xml", return_value=xml):
        report = load_source(
            SOURCE, SNAPSHOT, http_client=object(), store=store, make_embedder=make_embedder,
            dry_run=dry_run, **({"beat": beat} if beat else {}),
        )
    return report, store, embedder, made


class FirstLoadTests(unittest.TestCase):
    def test_every_section_is_chunked_embedded_and_written(self) -> None:
        report, store, embedder, _ = run()
        self.assertEqual((report.sections, report.loaded, report.unchanged, report.reserved), (4, 4, 0, 1))
        self.assertEqual([s.citation for s, _ in store.replaced], ["262.10", "262.11", "262.32", "Appendix to Part 262"])

    def test_each_chunk_carries_the_vector_of_its_own_text(self) -> None:
        _, store, _, _ = run()
        for _section, chunks in store.replaced:
            for item in chunks:
                self.assertEqual(item.embedding[0], float(len(item.chunk.text)))

    def test_small_sections_share_one_embedding_request(self) -> None:
        _, _, embedder, _ = run()
        self.assertEqual(len(embedder.calls), 1)
        self.assertEqual(len(embedder.calls[0]), 4)

    def test_removed_sections_are_pruned_against_the_full_current_list_then_the_snapshot_is_recorded(self) -> None:
        _, store, _, _ = run()
        self.assertEqual(store.pruned, [[s.source_url for s in PARSED.sections]])
        self.assertEqual(store.snapshots, [SNAPSHOT])

    def test_the_report_counts_chunks_and_tokens_it_embedded(self) -> None:
        report, store, _, _ = run()
        self.assertEqual(report.chunks, sum(len(c) for _, c in store.replaced))
        self.assertEqual(report.estimated_tokens, sum(i.chunk.token_estimate for _, c in store.replaced for i in c))
        self.assertGreater(report.estimated_tokens, 0)

    def test_the_report_is_plain_data_for_the_job_result(self) -> None:
        import json
        json.dumps(run()[0].as_dict())


class DryRunTests(unittest.TestCase):
    def test_a_dry_run_writes_nothing_and_never_asks_for_an_embedding_key(self) -> None:
        report, store, embedder, made = run(dry_run=True)
        self.assertEqual((store.writes, embedder.calls, made), (0, [], []))
        self.assertTrue(report.dry_run)
        self.assertEqual(report.loaded, 0)

    def test_it_still_reports_what_a_real_run_would_do(self) -> None:
        dry, *_ = run(dry_run=True)
        real, *_ = run()
        for key in ("sections", "to_load", "chunks", "estimated_tokens", "reserved", "unrecognized"):
            self.assertEqual(getattr(dry, key), getattr(real, key), key)

    def test_it_shows_titles_so_a_person_can_check_the_parse(self) -> None:
        report, *_ = run(dry_run=True)
        self.assertEqual(report.sample[0], "40 CFR 262.10 — Purpose, scope, and applicability")

    def test_the_safety_checks_apply_to_a_dry_run_too(self) -> None:
        stored = {f"{SOURCE.url_prefix}section-262.{n}": StoredSection("x", "t") for n in range(50)}
        with self.assertRaises(LoadError):
            run(store=FakeStore(stored), dry_run=True)


class ReloadTests(unittest.TestCase):
    def loaded_store(self) -> FakeStore:
        store = FakeStore()
        run(store=store)
        store.replaced.clear(); store.pruned.clear(); store.snapshots.clear()
        return store

    def test_nothing_changed_means_nothing_embedded_and_no_key_needed(self) -> None:
        store = self.loaded_store()
        report, _, embedder, made = run(store=store)
        self.assertEqual((report.unchanged, report.to_load, report.loaded), (4, 0, 0))
        self.assertEqual((embedder.calls, made, store.replaced), ([], [], []))
        self.assertEqual(store.snapshots, [SNAPSHOT])  # the snapshot still advances

    def test_only_the_changed_section_is_re_embedded(self) -> None:
        store = self.loaded_store()
        changed = SAMPLE.replace(b"Marking.", b"Marking and labeling.").replace(b"mark each container", b"mark and label each container")
        report, _, embedder, _ = run(store=store, xml=changed)
        self.assertEqual((report.unchanged, report.loaded), (3, 1))
        self.assertEqual([s.citation for s, _ in store.replaced], ["262.32"])
        self.assertEqual(len(embedder.calls[0]), 1)

    def test_a_repealed_section_is_pruned(self) -> None:
        store = self.loaded_store()
        store.existing_rows[f"{SOURCE.url_prefix}section-262.99"] = StoredSection("old", "40 CFR 262.99")
        report, *_ = run(store=store)
        self.assertEqual(report.removed, 1)
        self.assertNotIn(f"{SOURCE.url_prefix}section-262.99", store.existing_rows)

    def test_an_interrupted_run_keeps_what_it_wrote_and_a_retry_finishes_only_the_rest(self) -> None:
        # Two embedding groups; the second request fails after the first was written.
        with mock.patch.object(loader, "BATCH_SIZE", 2):
            store = FakeStore()
            with self.assertRaises(EmbeddingError):
                run(store=store, embedder=FakeEmbedder(fail_on_call=2))
            written = len(store.replaced)
            self.assertGreater(written, 0)
            self.assertLess(written, 4)
            self.assertEqual((store.pruned, store.snapshots), ([], []))  # not marked complete

            report, *_ = run(store=store)
        self.assertEqual(report.unchanged, written)
        self.assertEqual(report.loaded, 4 - written)
        self.assertEqual(store.snapshots, [SNAPSHOT])


class RefusalTests(unittest.TestCase):
    def test_no_sections_is_an_error_and_changes_nothing(self) -> None:
        store = FakeStore()
        with self.assertRaisesRegex(LoadError, "no sections"):
            run(store=store, xml=b'<ECFR><DIV5 N="262" TYPE="PART"/></ECFR>')
        self.assertEqual(store.writes, 0)

    def test_a_result_far_smaller_than_whats_stored_is_treated_as_a_parse_problem(self) -> None:
        stored = {f"{SOURCE.url_prefix}section-262.{n}": StoredSection("x", "t") for n in range(1, 21)}
        store = FakeStore(stored)
        with self.assertRaisesRegex(LoadError, "parsing problem"):
            run(store=store)
        self.assertEqual((store.writes, len(store.existing_rows)), (0, 20))

    def test_a_modest_shrink_is_allowed(self) -> None:
        stored = {f"{SOURCE.url_prefix}section-262.{n}": StoredSection("x", "t") for n in range(1, 7)}
        report, *_ = run(store=FakeStore(stored))  # 4 parsed vs 6 stored: 67%
        self.assertEqual(report.sections, 4)

    def test_a_runaway_embedding_bill_is_refused_before_anything_is_spent(self) -> None:
        store = FakeStore()
        with mock.patch.object(loader, "MAX_CHUNKS_PER_RUN", 2):
            with self.assertRaisesRegex(LoadError, "over the 2 limit"):
                run(store=store)
        self.assertEqual(store.writes, 0)

    def test_malformed_xml_is_an_error_a_retry_can_cure(self) -> None:
        with self.assertRaises(EcfrError):
            run(xml=SAMPLE[:200])

    def test_a_lease_lost_mid_run_stops_before_the_next_write(self) -> None:
        def beat(progress):
            if progress.get("stage") == "embedding":
                raise LeaseLostError("lost")

        store = FakeStore()
        with self.assertRaises(LeaseLostError):
            run(store=store, beat=beat)
        self.assertEqual(store.writes, 0)


class GroupingTests(unittest.TestCase):
    def test_sections_are_batched_up_to_the_request_limit_and_never_split(self) -> None:
        section = PARSED.sections[0]
        sized = [(replace(section, citation=str(i)), chunk_text("x. " * n)[:1] * n) for i, n in enumerate([60, 60, 60, 10, 200])]
        groups = loader._groups(sized)
        self.assertEqual([[s.citation for s, _ in g] for g in groups], [["0", "1"], ["2", "3"], ["4"]])
        self.assertTrue(all(sum(len(c) for _, c in g) <= 128 or len(g) == 1 for g in groups))


class HeartbeatTests(unittest.TestCase):
    def test_reports_are_throttled_but_a_stage_change_always_goes_through(self) -> None:
        now = [0.0]
        sent = []
        beat = Heartbeat(sent.append, clock=lambda: now[0])
        beat({"n": 1}); beat({"n": 2}); now[0] = 5; beat({"n": 3})
        self.assertEqual(sent, [{"n": 1}])
        beat({"n": 4}, force=True)
        now[0] = 100; beat({"n": 5})
        self.assertEqual([m["n"] for m in sent], [1, 4, 5])


class RecordingQuery:
    def __init__(self, client, rows, calls=None):
        self.client, self.rows, self.calls = client, rows, list(calls or [])

    def __getattr__(self, name):
        def record(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self
        return record

    def execute(self):
        self.client.executed.append(self.calls)
        return SimpleNamespace(data=self.rows.pop(0) if self.rows else None)


class RecordingClient:
    def __init__(self, *results):
        self.results = list(results)
        self.executed: list[list] = []

    def table(self, name):
        return RecordingQuery(self, self.results)

    def rpc(self, name, params):
        return RecordingQuery(self, self.results, calls=[("rpc", (name, params), {})])


class StoreTests(unittest.TestCase):
    def test_existing_reads_only_global_documents_under_the_part_and_pages_through_them(self) -> None:
        page = [{"source_url": f"{SOURCE.url_prefix}section-262.{n}", "content_sha256": f"s{n}", "title": f"t{n}"} for n in range(3)]
        client = RecordingClient(page[:2], page[2:])
        with mock.patch("app.regulations.store.PAGE_SIZE", 2):
            found = SupabaseKnowledgeStore(client).existing(SOURCE)
        self.assertEqual(len(found), 3)
        self.assertEqual(found[page[0]["source_url"]], StoredSection("s0", "t0"))
        first = dict((c[0], c[1]) for c in client.executed[0])
        self.assertEqual(first["is_"], ("tenant_id", "null"))
        self.assertEqual(first["like"], ("source_url", SOURCE.url_prefix + "%"))
        self.assertEqual(first["range"], (0, 1))

    def test_replace_sends_one_atomic_call_with_vector_literals_and_citation_metadata(self) -> None:
        client = RecordingClient(None)
        section = PARSED.sections[0]
        chunks = [EmbeddedChunk(c, [0.5] * DIMENSIONS) for c in chunk_text(section.body)]
        SupabaseKnowledgeStore(client).replace(SOURCE, section, chunks)
        (call,) = client.executed
        name, params = call[0][1]
        self.assertEqual(name, "replace_regulation_document")
        self.assertEqual(
            (params["p_source_type"], params["p_jurisdiction"], params["p_source_url"], params["p_content_sha256"]),
            ("rcra", "federal", section.source_url, section.content_sha256),
        )
        sent = params["p_chunks"][0]
        self.assertTrue(sent["embedding"].startswith("[0.500000,") and sent["embedding"].endswith("]"))
        self.assertEqual(sent["metadata"]["citation"], "262.10")

    def test_prune_and_snapshot_name_the_part(self) -> None:
        client = RecordingClient(3, None)
        store = SupabaseKnowledgeStore(client)
        self.assertEqual(store.prune(SOURCE, ["u1"]), 3)
        store.record_snapshot(SOURCE, SNAPSHOT)
        self.assertEqual(client.executed[0][0][1], ("prune_regulation_documents", {"p_url_prefix": SOURCE.url_prefix, "p_keep_urls": ["u1"]}))
        self.assertEqual(client.executed[1][0][1][1], {
            "p_source": "epa-40-cfr-262", "p_title": SOURCE.label, "p_ecfr_title": "40", "p_ecfr_part": "262", "p_snapshot": SNAPSHOT,
        })

    def test_the_citation_metadata_names_the_paragraph_for_sections_but_not_appendices(self) -> None:
        section, appendix = PARSED.sections[0], PARSED.sections[-1]
        chunk = chunk_text("(c)(4) text")[0]
        self.assertEqual(chunk_metadata(SOURCE, section, chunk)["section"], "262.10(c)(4)")
        self.assertEqual(chunk_metadata(SOURCE, appendix, chunk)["section"], "Appendix to Part 262")
        self.assertEqual(chunk_metadata(SOURCE, section, chunk)["source_path"], "ecfr:title-40/part-262/262.10")


class PayloadTests(unittest.TestCase):
    def test_a_valid_payload_is_normalized(self) -> None:
        self.assertEqual(
            validate_payload({"source": "epa-40-cfr-262", "date": "2026-05-07", "extra": 1}),
            {"source": "epa-40-cfr-262", "date": "2026-05-07", "dry_run": False},
        )

    def test_bad_payloads_are_rejected_before_any_work_is_queued(self) -> None:
        for bad in (
            {}, {"source": "nope", "date": "2026-05-07"},
            {"source": "epa-40-cfr-262"}, {"source": "epa-40-cfr-262", "date": "2026-5-7"},
            {"source": "epa-40-cfr-262", "date": "2026-02-30"}, {"source": "epa-40-cfr-262", "date": "2999-01-01"},
            {"source": "epa-40-cfr-262", "date": "2026-05-07", "dry_run": "yes"},
        ):
            with self.subTest(bad):
                with self.assertRaises(InvalidJobPayload):
                    validate_payload(bad)

    def test_the_kind_is_platform_level_with_a_single_retry(self) -> None:
        self.assertFalse(REGULATION_INGEST_KIND.tenant_scoped)
        self.assertEqual(REGULATION_INGEST_KIND.max_attempts, 2)


def make_job(**payload) -> ServiceJob:
    body = {"source": "epa-40-cfr-262", "date": SNAPSHOT, "dry_run": False, **payload}
    return ServiceJob(id="job-1", tenant_id=None, kind="regulation_ingest", payload=body, attempts=1, max_attempts=2)


class RecordingContext(JobContext):
    def __init__(self, job):
        self.job, self.beats = job, []

    def heartbeat(self, progress=None):
        self.beats.append(progress)


class JobTests(unittest.TestCase):
    def execute(self, job=None, store=None, error=None):
        job = job or make_job()
        patch = mock.patch.object(loader, "fetch_part_xml", side_effect=error) if error else mock.patch.object(loader, "fetch_part_xml", return_value=SAMPLE)
        with patch, mock.patch.dict(os.environ, {"VOYAGE_API_KEY": "k"}), \
                mock.patch.object(regulation_job.VoyageEmbedder, "from_env", return_value=FakeEmbedder()):
            return run_regulation_ingest(job, RecordingContext(job), http_client=object(), store=store or FakeStore())

    def test_the_result_is_the_report(self) -> None:
        result = self.execute()
        self.assertEqual((result["source"], result["loaded"], result["dry_run"]), ("epa-40-cfr-262", 4, False))

    def test_a_dry_run_result_says_so_and_writes_nothing(self) -> None:
        store = FakeStore()
        result = self.execute(make_job(dry_run=True), store)
        self.assertEqual((result["dry_run"], store.writes), (True, 0))

    def test_a_refusal_fails_the_job_for_good_with_the_reason(self) -> None:
        job = make_job()
        empty = b'<ECFR><DIV5 N="262" TYPE="PART"/></ECFR>'
        with mock.patch.object(loader, "fetch_part_xml", return_value=empty):
            with self.assertRaisesRegex(PermanentJobError, "no sections"):
                run_regulation_ingest(job, RecordingContext(job), http_client=object(), store=FakeStore())

    def test_bad_credentials_fail_for_good_but_an_outage_is_retried(self) -> None:
        with self.assertRaises(PermanentJobError):
            self.execute(error=HttpFailure("GET https://x answered 404", status=404, retryable=False))
        with self.assertRaises(HttpFailure):
            self.execute(error=HttpFailure("GET https://x answered 503 (after 4 attempts)", retryable=True))

    def test_a_missing_embedding_key_fails_for_good(self) -> None:
        job = make_job()
        with mock.patch.object(loader, "fetch_part_xml", return_value=SAMPLE), mock.patch.dict(os.environ, {"VOYAGE_API_KEY": ""}):
            with self.assertRaisesRegex(PermanentJobError, "VOYAGE_API_KEY"):
                run_regulation_ingest(job, RecordingContext(job), http_client=object(), store=FakeStore())

    def test_the_heartbeat_reports_progress_to_the_queue(self) -> None:
        job = make_job()
        ctx = RecordingContext(job)
        with mock.patch.object(loader, "fetch_part_xml", return_value=SAMPLE), \
                mock.patch.object(regulation_job.VoyageEmbedder, "from_env", return_value=FakeEmbedder()):
            run_regulation_ingest(job, ctx, http_client=object(), store=FakeStore())
        self.assertEqual(ctx.beats[0], {"stage": "fetching"})
        self.assertIn("finishing", [b["stage"] for b in ctx.beats])


class AgreementWithMigrationTests(unittest.TestCase):
    MIGRATION = Path(__file__).resolve().parents[3] / "apps" / "web" / "migrations" / "297_regulation_loading.sql"

    @unittest.skipUnless(MIGRATION.exists(), "the web app's migrations are not alongside the service")
    def test_every_source_type_the_catalog_uses_is_accepted_by_the_replace_function(self) -> None:
        sql = re.sub(r"--[^\n]*", "", self.MIGRATION.read_text(encoding="utf-8"))
        match = re.search(r"if p_source_type not in \((.*?)\) then", sql, re.DOTALL)
        self.assertIsNotNone(match)
        allowed = set(re.findall(r"'([a-z_]+)'", match.group(1)))
        self.assertTrue({s.source_type for s in CATALOG.values()} <= allowed)

    WEB_SOURCES = Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "regulationSources.ts"

    @unittest.skipUnless(WEB_SOURCES.exists(), "the web app's shared sources are not alongside the service")
    def test_the_web_apps_list_of_loadable_parts_matches_the_catalog(self) -> None:
        # The superadmin panel offers exactly these; a part the service does not
        # know would be rejected, and one the panel omits could never be loaded.
        text = self.WEB_SOURCES.read_text(encoding="utf-8")
        listed = {
            key: (label, title, part)
            for key, label, title, part in re.findall(
                r"key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*ecfrTitle:\s*'(\d+)',\s*ecfrPart:\s*'(\d+)'", text)
        }
        expected = {s.key: (s.label, s.ecfr_title, s.ecfr_part) for s in CATALOG.values()}
        self.assertEqual(listed, expected)

    def test_every_part_has_a_unique_key_and_a_url_prefix_no_other_part_shares(self) -> None:
        prefixes = [s.url_prefix for s in CATALOG.values()]
        self.assertEqual(len(set(prefixes)), len(prefixes))
        self.assertEqual(len(CATALOG), len({s.key for s in CATALOG.values()}))
        # Part 12 must not prune part 122: the trailing slash is what separates them.
        self.assertTrue(all(p.endswith("/") for p in prefixes))


if __name__ == "__main__":
    unittest.main()
