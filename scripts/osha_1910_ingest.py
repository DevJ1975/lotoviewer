#!/usr/bin/env python3
"""Ingest Federal OSHA 29 CFR Part 1910 (General Industry) into the assistant RAG corpus.

The Soteria assistant (apps/web/app/api/assistant/chat) is not fine-tuned — it
answers via retrieval over `knowledge_documents` / `knowledge_chunks`. "Training"
it on the General Industry standard therefore means loading every section of
29 CFR Part 1910 as GLOBAL (`tenant_id = NULL`) `regulation` documents. RLS
(`knowledge_documents_global_read`) then exposes them to every tenant — that is
the multi-tenant delivery, with no per-tenant work.

Why Python (and not the existing scripts/ingest-osha-1910.mjs): that script
regex-parses the multi-MB eCFR XML into ONE mega-document whose chunks carry no
section metadata, so the assistant can only cite "[29 CFR Part 1910]" — never the
pinpoint "[29 CFR 1910.147 § 1910.147(c)(4)]" its system prompt promises. This
tool uses lxml to parse the structured XML into ONE document PER section/appendix,
tagging each chunk with `metadata.section` (the deepest paragraph anchor) so
`buildCiteTag` (apps/web/lib/ai/rag.ts) emits real pinpoint citations.

It deliberately mirrors the repo's existing contract:
  - chunking params match apps/web/lib/ai/chunker.ts (800/100/6000)
  - embeddings match apps/web/lib/ai/embeddings.ts (voyage-3-large, 1024 dims,
    input_type='document', batches of 128)
  - rows match migration 105_knowledge_base.sql exactly

Pipeline stages (each reads/writes the work dir, so a re-run is cheap and the
network steps are decoupled from the DB write):

    fetch    GET the eCFR Part 1910 XML  -> <workdir>/part-1910.xml
    parse    XML -> per-section records  -> <workdir>/sections.json
    chunk    sections -> chunked docs    -> <workdir>/documents.json
    embed    Voyage embeddings           -> <workdir>/embedded.json   (needs VOYAGE_API_KEY)
    emit-sql idempotent SQL batches      -> <workdir>/sql/batch-*.sql
    all      fetch -> parse -> chunk -> embed -> emit-sql
    verify   diff parsed sections against the source-map checklist

The SQL batches are applied to Supabase by the operator (Supabase SQL editor /
psql) or via the Supabase MCP `execute_sql` tool. Each batch is self-contained
and idempotent: it deletes the prior global row for a section (by its stable eCFR
deep-link `source_url`, cascading its chunks) before re-inserting, so re-running
after an annual eCFR update rewrites only what changed.

Usage:
    python scripts/osha_1910_ingest.py all --date 2026-05-07
    # offline / staged:
    python scripts/osha_1910_ingest.py parse --xml /path/to/part-1910.xml
    python scripts/osha_1910_ingest.py chunk
    VOYAGE_API_KEY=... python scripts/osha_1910_ingest.py embed
    python scripts/osha_1910_ingest.py emit-sql --batch-chunks 100
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
from dataclasses import dataclass, field, asdict
from pathlib import Path

try:
    from lxml import etree
except ImportError:  # pragma: no cover - dependency hint
    sys.exit("lxml is required. Install with: pip install -r scripts/requirements.txt")

# ── constants (kept in lock-step with the TypeScript pipeline) ───────────────

DEFAULT_DATE = "2026-05-07"  # the snapshot the source-map pins; override with --date
ECFR_URL = "https://www.ecfr.gov/api/versioner/v1/full/{date}/title-29.xml?part=1910"
ECFR_BASE = "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910"

# Mirror apps/web/lib/ai/chunker.ts so this corpus chunks identically to the rest.
APPROX_CHARS_PER_TOKEN = 4
TARGET_TOKENS = 800
OVERLAP_TOKENS = 100
HARD_CHAR_CAP = 6000

# Mirror apps/web/lib/ai/embeddings.ts.
VOYAGE_MODEL = "voyage-3-large"
EMBEDDING_DIMS = 1024
VOYAGE_BATCH_SIZE = 128

SOURCE_TYPE = "regulation"
JURISDICTION = "federal"

DEFAULT_WORKDIR = Path(__file__).resolve().parent / ".osha-build"


# ── data model ───────────────────────────────────────────────────────────────


@dataclass
class Chunk:
    index: int
    text: str
    token_est: int
    section_anchor: str  # e.g. "1910.147(c)(4)" — drives metadata.section -> citations


@dataclass
class Document:
    """One eCFR section or appendix -> one knowledge_documents row."""

    citation: str          # "1910.147" or appendix id
    subpart: str           # "J"
    subpart_title: str     # "General Environmental Controls"
    title: str             # "29 CFR 1910.147 — The control of hazardous energy ..."
    source_url: str        # stable eCFR deep-link; the idempotency key
    is_appendix: bool
    text: str
    content_sha256: str = ""
    chunks: list[Chunk] = field(default_factory=list)
    embeddings: list[list[float]] = field(default_factory=list)


# ── stage 1: fetch ───────────────────────────────────────────────────────────


def fetch_part_xml(date: str) -> bytes:
    import requests  # local import so parse/chunk work without the dep installed

    url = ECFR_URL.format(date=date)
    sys.stderr.write(f"→ fetching {url}\n")
    resp = requests.get(
        url,
        timeout=120,
        headers={"user-agent": "SoteriaField-RAG/1.0 (+https://soteriafield.app)"},
    )
    resp.raise_for_status()
    data = resp.content
    sys.stderr.write(f"  ✓ {len(data) / 1024 / 1024:.1f} MB\n")
    return data


# ── stage 2: parse ───────────────────────────────────────────────────────────

_WS = re.compile(r"[ \t]+")
_MULTINL = re.compile(r"\n{3,}")
# A run of paragraph designators at the very start of a chunk, e.g. "(c)(4)(ii)".
_LEADING_DESIGNATORS = re.compile(r"^\s*((?:\([0-9A-Za-z]{1,4}\)){1,6})")


def _clean(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = _WS.sub(" ", text)
    text = _MULTINL.sub("\n\n", text)
    return text.strip()


def _node_text(el: etree._Element) -> str:
    """All text inside an element, whitespace-normalised on a single line."""
    return _clean(" ".join(el.itertext()))


def _render_table(table: etree._Element) -> str:
    """Render a GPOTABLE as pipe-joined rows. RAG indexes the words; exact column
    layout matters less than coverage, so we keep it simple and readable."""
    lines: list[str] = []
    # Column heads live in BOXHD/CHED; body cells in ROW/ENT.
    heads = [_node_text(c) for c in table.iter("CHED") if _node_text(c)]
    if heads:
        lines.append(" | ".join(heads))
    for row in table.iter("ROW"):
        cells = [_node_text(c) for c in row.iter("ENT")]
        cells = [c for c in cells if c]
        if cells:
            lines.append(" | ".join(cells))
    body = "\n".join(lines).strip()
    return f"[Table — see eCFR for formatted layout]\n{body}" if body else ""


# Leaf text blocks we keep as separate paragraphs (so the chunker can split on
# them). AUTH/SOURCE/CITA (authority + amendment history) are kept per the
# source-map's request. Containers (EXTRACT, NOTE, nested DIVs) are recursed into
# so their inner paragraphs surface individually rather than as one blob.
_PARA_TAGS = {"P", "FP", "HD1", "HD2", "HD3", "CITA", "AUTH", "SOURCE", "EDNOTE", "FTNT"}


def _section_body(div: etree._Element) -> str:
    """Flatten a section/appendix body into paragraph-separated text in document
    order, rendering tables and recursing through wrappers."""
    blocks: list[str] = []

    def walk(parent: etree._Element) -> None:
        for el in parent:
            if not isinstance(el.tag, str):  # comments / processing instructions
                continue
            tag = etree.QName(el).localname
            if tag == "HEAD":
                continue
            if tag == "GPOTABLE":
                rendered = _render_table(el)
                if rendered:
                    blocks.append(rendered)
                continue
            if tag in _PARA_TAGS:
                t = _node_text(el)
                if t:
                    blocks.append(t)
                continue
            walk(el)  # container — descend for nested paragraphs

    walk(div)
    return "\n\n".join(blocks).strip()


def _section_name(head: str, citation: str) -> str:
    """Strip the leading "§ 1910.147" from a HEAD to get the bare section name."""
    name = re.sub(r"^§+\s*\d+(?:\.\d+)*\s*", "", head).strip(" .—-")
    return name


def _deep_link(subpart: str, citation: str, is_appendix: bool) -> str:
    if is_appendix:
        frag = urllib.parse.quote(citation)
        seg = f"appendix-{frag}"
    else:
        seg = f"section-{citation}"
    if subpart:
        return f"{ECFR_BASE}/subpart-{subpart}/{seg}"
    return f"{ECFR_BASE}/{seg}"


def parse_part(xml_bytes: bytes) -> list[Document]:
    """Walk DIV5(PART) → DIV6(SUBPART) → DIV8(SECTION) / DIV9(APPENDIX).

    Reserved sections (HEAD contains "[Reserved]" with no body) are skipped — they
    carry no retrievable text. Returns one Document per substantive section/appendix.
    """
    parser = etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False)
    root = etree.fromstring(xml_bytes, parser=parser)

    part = root.find(".//DIV5[@TYPE='PART']")
    scope = part if part is not None else root

    docs: list[Document] = []
    subparts = scope.findall(".//DIV6[@TYPE='SUBPART']")
    # Older XML may omit DIV6 grouping; fall back to the whole part.
    grouping = subparts if subparts else [scope]

    for sp in grouping:
        letter = sp.get("N", "") if sp is not scope else ""
        sp_head_el = sp.find("HEAD")
        subpart_title = ""
        if sp_head_el is not None:
            subpart_title = re.sub(r"^Subpart\s+\S+\s*[—-]\s*", "", _node_text(sp_head_el)).strip()

        for div in sp.iter("DIV8", "DIV9"):
            kind = etree.QName(div).localname
            is_appendix = kind == "DIV9" or (div.get("TYPE", "").upper() == "APPENDIX")
            citation = (div.get("N") or "").strip()
            if not citation:
                continue
            head_el = div.find("HEAD")
            head = _node_text(head_el) if head_el is not None else ""
            body = _section_body(div)
            if not body:  # [Reserved] sections carry no retrievable text
                continue

            if is_appendix:
                title = f"29 CFR Part 1910 — {head}" if head else f"29 CFR Part 1910 — {citation}"
            else:
                name = _section_name(head, citation)
                title = f"29 CFR {citation} — {name}" if name else f"29 CFR {citation}"

            docs.append(
                Document(
                    citation=citation,
                    subpart=letter,
                    subpart_title=subpart_title,
                    title=title[:300],
                    source_url=_deep_link(letter, citation, is_appendix),
                    is_appendix=is_appendix,
                    text=body,
                )
            )
    return docs


# ── stage 3: chunk (ported from apps/web/lib/ai/chunker.ts) ──────────────────


def approx_tokens(s: str) -> int:
    return -(-len(s) // APPROX_CHARS_PER_TOKEN)  # ceil division


def split_sentences(s: str) -> list[str]:
    out: list[str] = []
    buf = ""
    for i, ch in enumerate(s):
        buf += ch
        nxt = s[i + 1] if i + 1 < len(s) else None
        if ch in ".!?" and (nxt in (" ", "\n", None)):
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return [p for p in out if p]


def chunk_text(text: str) -> list[Chunk]:
    if not text.strip():
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[Chunk] = []
    buffer: list[str] = []
    buffer_tokens = 0

    def flush() -> list[str]:
        nonlocal buffer, buffer_tokens
        if not buffer:
            return []
        joined = "\n\n".join(buffer).strip()
        if not joined:
            buffer, buffer_tokens = [], 0
            return []
        chunks.append(
            Chunk(index=len(chunks), text=joined[:HARD_CHAR_CAP], token_est=approx_tokens(joined), section_anchor="")
        )
        sentences = split_sentences(buffer[-1])
        seed: list[str] = []
        seed_tokens = 0
        for s in reversed(sentences):
            t = approx_tokens(s)
            if seed_tokens + t > OVERLAP_TOKENS and seed:
                break
            seed.insert(0, s)
            seed_tokens += t
        buffer, buffer_tokens = [], 0
        return seed

    def add(p: str) -> None:
        nonlocal buffer, buffer_tokens
        p_tokens = approx_tokens(p)
        if p_tokens > TARGET_TOKENS:
            for s in split_sentences(p):
                add(s)
            return
        if buffer_tokens + p_tokens > TARGET_TOKENS and buffer:
            seed = flush()
            if seed:
                buffer.append(" ".join(seed))
                buffer_tokens = approx_tokens(buffer[0])
        buffer.append(p)
        buffer_tokens += p_tokens

    for p in paragraphs:
        add(p)
    flush()
    return chunks


def paragraph_anchor(citation: str, chunk_body: str) -> str:
    """Best-effort pinpoint cite: append the leading paragraph designators of the
    chunk to the section number, e.g. "1910.147" + "(c)(4)" -> "1910.147(c)(4)"."""
    m = _LEADING_DESIGNATORS.match(chunk_body)
    return f"{citation}{m.group(1)}" if m else citation


def chunk_documents(docs: list[Document]) -> list[Document]:
    for doc in docs:
        doc.content_sha256 = hashlib.sha256(doc.text.encode("utf-8")).hexdigest()
        doc.chunks = chunk_text(doc.text)
        for c in doc.chunks:
            c.section_anchor = paragraph_anchor(doc.citation, c.text)
    return [d for d in docs if d.chunks]


# ── stage 4: embed (mirrors apps/web/lib/ai/embeddings.ts) ───────────────────


def embed_texts(texts: list[str], api_key: str) -> tuple[list[list[float]], int]:
    import requests

    all_vecs: list[list[float]] = []
    total_tokens = 0
    for i in range(0, len(texts), VOYAGE_BATCH_SIZE):
        batch = texts[i : i + VOYAGE_BATCH_SIZE]
        resp = requests.post(
            "https://api.voyageai.com/v1/embeddings",
            timeout=60,
            headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
            json={"model": VOYAGE_MODEL, "input": batch, "input_type": "document"},
        )
        if not resp.ok:
            raise RuntimeError(f"Voyage error {resp.status_code}: {resp.text[:300]}")
        payload = resp.json()
        items = sorted(payload.get("data", []), key=lambda d: d["index"])
        for item in items:
            vec = item.get("embedding")
            if not isinstance(vec, list) or len(vec) != EMBEDDING_DIMS:
                raise RuntimeError(f"Voyage returned wrong-dim embedding: {len(vec) if vec else None}")
            all_vecs.append(vec)
        total_tokens += payload.get("usage", {}).get("total_tokens", 0)
        sys.stderr.write(f"  embedded {min(i + VOYAGE_BATCH_SIZE, len(texts))}/{len(texts)}\n")
    return all_vecs, total_tokens


# ── stage 5: emit-sql ────────────────────────────────────────────────────────


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def vector_literal(vec: list[float], ndigits: int = 6) -> str:
    # Round to 6 dp: cosine recall is unaffected and it ~halves the SQL payload.
    return "[" + ",".join(f"{x:.{ndigits}f}" for x in vec) + "]"


def _document_sql(doc: Document) -> str:
    if len(doc.embeddings) != len(doc.chunks):
        raise ValueError(f"{doc.citation}: {len(doc.embeddings)} embeddings vs {len(doc.chunks)} chunks")
    values_rows = []
    for c, vec in zip(doc.chunks, doc.embeddings):
        metadata = {
            "section": c.section_anchor,
            "subpart": doc.subpart,
            "citation": doc.citation,
            "source_path": f"ecfr:title-29/part-1910/{doc.citation}",
        }
        values_rows.append(
            "    ("
            f"{c.index}, "
            f"{sql_str(c.text)}, "
            f"{sql_str(vector_literal(vec))}, "
            f"{c.token_est}, "
            f"{sql_str(json.dumps(metadata, ensure_ascii=False))}"
            ")"
        )
    values_block = ",\n".join(values_rows)
    return (
        f"-- {doc.title}\n"
        f"delete from public.knowledge_documents where tenant_id is null and source_url = {sql_str(doc.source_url)};\n"
        "with d as (\n"
        "  insert into public.knowledge_documents\n"
        "    (tenant_id, source_type, title, jurisdiction, effective_date, source_url, uploaded_by, content_sha256, chunk_count)\n"
        "  values (null, "
        f"{sql_str(SOURCE_TYPE)}, {sql_str(doc.title)}, {sql_str(JURISDICTION)}, null, "
        f"{sql_str(doc.source_url)}, null, {sql_str(doc.content_sha256)}, {len(doc.chunks)})\n"
        "  returning id\n"
        ")\n"
        "insert into public.knowledge_chunks (document_id, chunk_index, text, embedding, token_count, metadata)\n"
        "select d.id, v.chunk_index, v.text, v.embedding::vector(1024), v.token_count, v.metadata::jsonb\n"
        "from d, (values\n"
        f"{values_block}\n"
        ") as v(chunk_index, text, embedding, token_count, metadata);\n"
    )


def _record_snapshot_sql(snapshot_date: str) -> str:
    # Closes the loop with /api/cron/check-regulation-updates: after the corpus is
    # applied, mark the snapshot it reflects so the freshness cron compares eCFR's
    # latest amendment against THIS date. No-op (0 rows) if migration 217 hasn't run.
    d = sql_str(snapshot_date)
    return (
        "-- Record the eCFR snapshot this corpus reflects (apply LAST, after the batches).\n"
        "begin;\n"
        "update public.regulation_update_checks\n"
        f"   set ingested_snapshot = {d}::date,\n"
        "       ingested_at       = now(),\n"
        f"       latest_amendment  = greatest(coalesce(latest_amendment, date '1900-01-01'), {d}::date),\n"
        "       needs_update      = false,\n"
        "       last_checked_at   = now(),\n"
        "       updated_at        = now()\n"
        " where source = 'osha-29-cfr-1910';\n"
        "commit;\n"
    )


def emit_sql(docs: list[Document], out_dir: Path, batch_chunks: int, snapshot_date: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("batch-*.sql"):
        stale.unlink()
    (out_dir / "record-snapshot.sql").unlink(missing_ok=True)

    written: list[Path] = []
    batch: list[str] = []
    batch_count = 0
    idx = 0

    def flush_batch() -> None:
        nonlocal batch, batch_count, idx
        if not batch:
            return
        path = out_dir / f"batch-{idx:03d}.sql"
        header = (
            "-- Federal OSHA 29 CFR Part 1910 — RAG ingest batch.\n"
            "-- Generated by scripts/osha_1910_ingest.py. Idempotent: each section is\n"
            "-- deleted (by source_url, cascading chunks) then re-inserted.\n"
            "begin;\n"
        )
        path.write_text(header + "\n".join(batch) + "\ncommit;\n", encoding="utf-8")
        written.append(path)
        batch, batch_count = [], 0
        idx += 1

    for doc in docs:
        batch.append(_document_sql(doc))
        batch_count += len(doc.chunks)
        if batch_count >= batch_chunks:
            flush_batch()
    flush_batch()

    record = out_dir / "record-snapshot.sql"
    record.write_text(_record_snapshot_sql(snapshot_date), encoding="utf-8")
    written.append(record)
    return written


# ── persistence helpers ──────────────────────────────────────────────────────


def _docs_to_json(docs: list[Document]) -> str:
    return json.dumps([asdict(d) for d in docs], ensure_ascii=False)


def _docs_from_json(text: str) -> list[Document]:
    raw = json.loads(text)
    docs: list[Document] = []
    for d in raw:
        chunks = [Chunk(**c) for c in d.pop("chunks", [])]
        embeddings = d.pop("embeddings", [])
        docs.append(Document(chunks=chunks, embeddings=embeddings, **d))
    return docs


# ── CLI ──────────────────────────────────────────────────────────────────────


def _checklist_citations(source_map: Path) -> set[str]:
    text = source_map.read_text(encoding="utf-8")
    return set(re.findall(r"1910\.\d+", text))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Ingest 29 CFR Part 1910 into the RAG corpus.")
    ap.add_argument("stage", choices=["fetch", "parse", "chunk", "embed", "emit-sql", "all", "verify"])
    ap.add_argument("--date", default=DEFAULT_DATE, help=f"eCFR snapshot date (default {DEFAULT_DATE})")
    ap.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    ap.add_argument("--xml", type=Path, help="parse a local XML file instead of the fetched one")
    ap.add_argument("--batch-chunks", type=int, default=100, help="chunks per SQL batch file")
    ap.add_argument("--limit", type=int, default=0, help="process only the first N sections (testing)")
    ap.add_argument(
        "--source-map",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "apps/web/seed/federal-osha-29-cfr-1910-source-map.md",
    )
    args = ap.parse_args(argv)
    wd = args.workdir
    wd.mkdir(parents=True, exist_ok=True)
    xml_path = wd / "part-1910.xml"
    sections_path = wd / "sections.json"
    documents_path = wd / "documents.json"
    embedded_path = wd / "embedded.json"
    sql_dir = wd / "sql"

    def do_fetch() -> None:
        xml_path.write_bytes(fetch_part_xml(args.date))
        sys.stderr.write(f"→ wrote {xml_path}\n")

    def do_parse() -> list[Document]:
        src = args.xml if args.xml else xml_path
        docs = parse_part(src.read_bytes())
        if args.limit:
            docs = docs[: args.limit]
        sections_path.write_text(_docs_to_json(docs), encoding="utf-8")
        n_app = sum(1 for d in docs if d.is_appendix)
        subparts = sorted({d.subpart for d in docs if d.subpart})
        sys.stderr.write(
            f"→ parsed {len(docs)} docs ({len(docs) - n_app} sections, {n_app} appendices) "
            f"across {len(subparts)} subparts: {','.join(subparts)}\n"
        )
        return docs

    def do_chunk() -> list[Document]:
        docs = _docs_from_json(sections_path.read_text(encoding="utf-8"))
        docs = chunk_documents(docs)
        documents_path.write_text(_docs_to_json(docs), encoding="utf-8")
        total = sum(len(d.chunks) for d in docs)
        sys.stderr.write(f"→ chunked {len(docs)} docs into {total} chunks\n")
        return docs

    def do_embed() -> list[Document]:
        api_key = os.environ.get("VOYAGE_API_KEY", "")
        if not api_key:
            sys.exit("VOYAGE_API_KEY is not set — required for the embed stage.")
        docs = _docs_from_json(documents_path.read_text(encoding="utf-8"))
        flat = [c.text for d in docs for c in d.chunks]
        vecs, tokens = embed_texts(flat, api_key)
        if len(vecs) != len(flat):
            sys.exit(f"embedding count mismatch: {len(vecs)} vs {len(flat)}")
        cursor = 0
        for d in docs:
            n = len(d.chunks)
            d.embeddings = vecs[cursor : cursor + n]
            cursor += n
        embedded_path.write_text(_docs_to_json(docs), encoding="utf-8")
        sys.stderr.write(f"→ embedded {len(flat)} chunks · {tokens} voyage tokens\n")
        return docs

    def do_emit() -> None:
        docs = _docs_from_json(embedded_path.read_text(encoding="utf-8"))
        written = emit_sql(docs, sql_dir, args.batch_chunks, args.date)
        total = sum(len(d.chunks) for d in docs)
        sys.stderr.write(f"→ wrote {len(written)} file(s) covering {len(docs)} docs / {total} chunks to {sql_dir}\n")

    def do_verify() -> None:
        docs = _docs_from_json(sections_path.read_text(encoding="utf-8")) if sections_path.exists() else do_parse()
        parsed = {d.citation for d in docs if not d.is_appendix}
        expected = _checklist_citations(args.source_map)
        missing = sorted(expected - parsed, key=lambda c: [int(x) for x in c.split(".")])
        if missing:
            sys.stderr.write(f"⚠ {len(missing)} checklist citations not found (some are [Reserved]):\n  {', '.join(missing)}\n")
        else:
            sys.stderr.write("✓ every active checklist citation is present\n")

    if args.stage == "fetch":
        do_fetch()
    elif args.stage == "parse":
        do_parse()
    elif args.stage == "chunk":
        do_chunk()
    elif args.stage == "embed":
        do_embed()
    elif args.stage == "emit-sql":
        do_emit()
    elif args.stage == "verify":
        do_verify()
    elif args.stage == "all":
        do_fetch()
        do_parse()
        do_chunk()
        do_embed()
        do_emit()
        do_verify()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
