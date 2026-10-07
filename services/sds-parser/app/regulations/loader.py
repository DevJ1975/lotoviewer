"""Load one part of the CFR into the knowledge base.

fetch -> split into sections -> chunk -> embed -> replace each section -> prune
what was removed -> record the snapshot.

Written without access to the live eCFR API, so it assumes its own parser can be
wrong and is built to fail safe:

* ``dry_run`` fetches and parses but writes nothing and spends no embedding
  credits, and reports what a real run would do. Run one first.
* A result far smaller than what is already stored is refused, so a parse that
  silently found little cannot prune a good corpus.
* A run that would embed an unreasonable number of chunks is refused.
* A section whose hash is unchanged is skipped, so a retry, or a re-run after one
  new amendment, re-embeds only what changed.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .catalog import EcfrSource
from .chunker import Chunk, chunk_text
from .ecfr import Section, fetch_part_xml, parse_sections
from .store import EmbeddedChunk, KnowledgeStore
from .voyage import BATCH_SIZE

# A real part is a few hundred sections; below this share of what is stored, the
# parse (not the regulation) is the likelier explanation.
MIN_SHARE_OF_STORED = 0.5
# ~16 chunks per section is already generous for one part; this stops a runaway.
MAX_CHUNKS_PER_RUN = 20_000
HEARTBEAT_EVERY_SECONDS = 20.0


class LoadError(RuntimeError):
    """The load must not proceed, and retrying it will not change that."""


@dataclass
class LoadReport:
    source: str
    snapshot: str
    dry_run: bool
    sections: int = 0                 # in the part, as parsed
    unchanged: int = 0                # already stored with the same text
    to_load: int = 0                  # new or changed
    chunks: int = 0                   # to embed
    estimated_tokens: int = 0         # of those chunks (about 4 characters each)
    reserved: int = 0                 # skipped: no text
    unrecognized: int = 0             # skipped: section number not understood
    loaded: int = 0
    removed: int = 0
    sample: list[str] = field(default_factory=list)  # titles, so a human can eyeball a dry run

    def as_dict(self) -> dict:
        return dict(self.__dict__)


class Heartbeat:
    """Reports progress at most every few seconds; ``force`` always reports."""

    def __init__(self, beat: Callable[[dict], None], clock: Callable[[], float] = time.monotonic) -> None:
        self._beat = beat
        self._clock = clock
        self._last = float("-inf")

    def __call__(self, progress: dict, *, force: bool = False) -> None:
        now = self._clock()
        if force or now - self._last >= HEARTBEAT_EVERY_SECONDS:
            self._last = now
            self._beat(progress)


def load_source(
    source: EcfrSource,
    snapshot: str,
    *,
    http_client: Any,
    store: KnowledgeStore,
    make_embedder: Callable[[], Any],
    beat: Callable[[dict], None] = lambda progress: None,
    dry_run: bool = False,
) -> LoadReport:
    heartbeat = Heartbeat(beat)
    heartbeat({"stage": "fetching"}, force=True)
    parsed = parse_sections(fetch_part_xml(source, snapshot, http_client), source)
    report = LoadReport(
        source=source.key, snapshot=snapshot, dry_run=dry_run,
        sections=len(parsed.sections), reserved=parsed.reserved, unrecognized=parsed.unrecognized,
        sample=[s.title for s in parsed.sections[:5]],
    )
    if not parsed.sections:
        raise LoadError(
            f"eCFR returned no sections for {source.citation_prefix} Part {source.ecfr_part} "
            f"as of {snapshot}. Nothing was changed."
        )

    heartbeat({"stage": "comparing"}, force=True)
    existing = store.existing(source)
    if existing and len(parsed.sections) < len(existing) * MIN_SHARE_OF_STORED:
        raise LoadError(
            f"Parsed {len(parsed.sections)} sections but {len(existing)} are stored for "
            f"{source.label}. That looks like a parsing problem, not a repeal of most of the "
            f"part, so nothing was changed."
        )

    pending: list[tuple[Section, list[Chunk]]] = []
    for section in parsed.sections:
        stored = existing.get(section.source_url)
        if stored and stored.content_sha256 == section.content_sha256:
            report.unchanged += 1
            continue
        chunks = chunk_text(section.body)
        if chunks:
            pending.append((section, chunks))
    report.to_load = len(pending)
    report.chunks = sum(len(chunks) for _, chunks in pending)
    report.estimated_tokens = sum(c.token_estimate for _, chunks in pending for c in chunks)

    if report.chunks > MAX_CHUNKS_PER_RUN:
        raise LoadError(
            f"{report.chunks} chunks would be embedded, over the {MAX_CHUNKS_PER_RUN} limit. "
            f"Check with a dry run before raising it."
        )
    if dry_run:
        return report

    if pending:
        embedder = make_embedder()
        for group in _groups(pending):
            heartbeat({"stage": "embedding", "loaded": report.loaded, "total": report.to_load}, force=True)
            vectors = embedder.embed_documents([c.text for _, chunks in group for c in chunks])
            offset = 0
            for section, chunks in group:
                embedded = [EmbeddedChunk(c, vectors[offset + i]) for i, c in enumerate(chunks)]
                offset += len(chunks)
                store.replace(source, section, embedded)
                report.loaded += 1
                heartbeat({"stage": "writing", "loaded": report.loaded, "total": report.to_load})

    heartbeat({"stage": "finishing"}, force=True)
    report.removed = store.prune(source, [s.source_url for s in parsed.sections])
    store.record_snapshot(source, snapshot)
    return report


def _groups(pending: list[tuple[Section, list[Chunk]]]) -> list[list[tuple[Section, list[Chunk]]]]:
    """Batch whole sections so each embedding request is close to the API's limit
    instead of one small request per section."""
    groups: list[list[tuple[Section, list[Chunk]]]] = []
    current: list[tuple[Section, list[Chunk]]] = []
    size = 0
    for item in pending:
        if current and size + len(item[1]) > BATCH_SIZE:
            groups.append(current)
            current, size = [], 0
        current.append(item)
        size += len(item[1])
    if current:
        groups.append(current)
    return groups
