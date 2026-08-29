#!/usr/bin/env python3
"""Tests for scripts/osha_1910_ingest.py.

Runs offline against an inlined eCFR-shaped fixture — no network, no Voyage, no
DB. Pytest-compatible (`pytest scripts/test_osha_1910_ingest.py`) and also runs
standalone (`python scripts/test_osha_1910_ingest.py`). Requires lxml
(scripts/requirements.txt).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import osha_1910_ingest as t  # noqa: E402

FIXTURE = """<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
  <DIV5 TYPE="PART" N="1910">
    <HEAD>PART 1910—OCCUPATIONAL SAFETY AND HEALTH STANDARDS</HEAD>
    <DIV6 TYPE="SUBPART" N="A">
      <HEAD>Subpart A—General</HEAD>
      <DIV8 TYPE="SECTION" N="1910.1">
        <HEAD>§ 1910.1 Purpose and scope.</HEAD>
        <P>(a) Section 6 of the Act provides that standards may be issued.</P>
        <P>(b) It bears emphasis that the standards apply to employers.</P>
      </DIV8>
      <DIV8 TYPE="SECTION" N="1910.5">
        <HEAD>§ 1910.5 [Reserved]</HEAD>
      </DIV8>
    </DIV6>
    <DIV6 TYPE="SUBPART" N="J">
      <HEAD>Subpart J—General Environmental Controls</HEAD>
      <DIV8 TYPE="SECTION" N="1910.147">
        <HEAD>§ 1910.147 The control of hazardous energy (lockout/tagout).</HEAD>
        <P>(a) Scope, application, and purpose. (1) Scope. This standard covers servicing and maintenance.</P>
        <P>(c)(4)(ii) The procedures shall clearly outline the scope, purpose, authorization, and enforcement, including verification of isolation.</P>
        <GPOTABLE>
          <BOXHD><CHED>Item</CHED><CHED>Requirement</CHED></BOXHD>
          <ROW><ENT>Lock</ENT><ENT>Durable and standardized</ENT></ROW>
        </GPOTABLE>
      </DIV8>
      <DIV9 TYPE="APPENDIX" N="Appendix A to Subpart J">
        <HEAD>Appendix A to Subpart J—Typical Minimal Lockout Procedures</HEAD>
        <P>A lockout procedure should describe the steps for shutting down equipment.</P>
      </DIV9>
    </DIV6>
  </DIV5>
</ECFR>
"""


def _docs():
    return t.parse_part(FIXTURE.encode("utf-8"))


def test_parses_sections_and_skips_reserved():
    citations = {d.citation for d in _docs()}
    assert "1910.1" in citations
    assert "1910.147" in citations
    assert "1910.5" not in citations  # [Reserved] has no body


def test_appendix_captured():
    assert any(d.is_appendix for d in _docs())


def test_titles_and_deep_links():
    by_cite = {d.citation: d for d in _docs()}
    lockout = by_cite["1910.147"]
    assert lockout.title == "29 CFR 1910.147 — The control of hazardous energy (lockout/tagout)"
    assert lockout.subpart == "J"
    assert lockout.source_url.endswith("/part-1910/subpart-J/section-1910.147")


def test_table_rendered_into_body():
    lockout = {d.citation: d for d in _docs()}["1910.147"]
    assert "[Table — see eCFR for formatted layout]" in lockout.text
    assert "Item | Requirement" in lockout.text
    assert "Lock | Durable and standardized" in lockout.text


def test_chunking_sets_pinpoint_anchor_and_sha():
    docs = t.chunk_documents(_docs())
    lockout = {d.citation: d for d in docs}["1910.147"]
    assert lockout.content_sha256 and len(lockout.content_sha256) == 64
    assert lockout.chunks, "expected at least one chunk"
    assert lockout.chunks[0].section_anchor.startswith("1910.147(")


def _embedded_docs():
    docs = t.chunk_documents(_docs())
    for d in docs:
        d.embeddings = [[0.0] * t.EMBEDDING_DIMS for _ in d.chunks]
    return docs


def test_emit_sql_shape(tmp_path=None):
    import tempfile
    from pathlib import Path

    out = Path(tmp_path) if tmp_path else Path(tempfile.mkdtemp())
    written = t.emit_sql(_embedded_docs(), out, batch_chunks=2, snapshot_date="2026-05-07")
    names = {p.name for p in written}
    assert "batch-000.sql" in names
    assert "prune.sql" in names
    assert "record-snapshot.sql" in names

    batch = (out / "batch-000.sql").read_text()
    assert batch.startswith("-- Federal OSHA") and batch.strip().endswith("commit;")
    assert "delete from public.knowledge_documents where tenant_id is null and source_url =" in batch
    assert "::vector(1024)" in batch and "::jsonb" in batch
    assert '"section":' in batch  # metadata carries the pinpoint anchor


def test_prune_targets_part_prefix_and_excludes_current():
    from pathlib import Path
    import tempfile

    out = Path(tempfile.mkdtemp())
    t.emit_sql(_embedded_docs(), out, batch_chunks=50, snapshot_date="2026-05-07")
    prune = (out / "prune.sql").read_text()
    assert "source_url like 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/%'" in prune
    assert "source_url not in (" in prune
    assert "/part-1910/subpart-J/section-1910.147" in prune  # current section is excluded from deletion


def test_record_snapshot_stamps_date():
    from pathlib import Path
    import tempfile

    out = Path(tempfile.mkdtemp())
    t.emit_sql(_embedded_docs(), out, batch_chunks=50, snapshot_date="2026-05-07")
    rec = (out / "record-snapshot.sql").read_text()
    assert "ingested_snapshot = '2026-05-07'::date" in rec
    assert "where source = 'osha-29-cfr-1910'" in rec


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except AssertionError as e:
                failures += 1
                print(f"  FAIL {name}: {e}")
    print(f"\n{'PASSED' if failures == 0 else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)
