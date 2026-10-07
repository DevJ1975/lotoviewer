"""Reading and writing the knowledge base through PostgREST.

Every write goes through a database function (migration 297) so a section is
replaced atomically; the table reads here only decide what needs reloading.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from .catalog import EcfrSource
from .chunker import Chunk
from .ecfr import Section
from .voyage import vector_literal

PAGE_SIZE = 1000  # PostgREST's default row cap


@dataclass(frozen=True)
class StoredSection:
    content_sha256: str
    title: str


@dataclass(frozen=True)
class EmbeddedChunk:
    chunk: Chunk
    embedding: list[float] = field(repr=False)


class KnowledgeStore(Protocol):
    def existing(self, source: EcfrSource) -> dict[str, StoredSection]:
        """The global documents already stored under the part, by source_url."""
        ...

    def replace(self, source: EcfrSource, section: Section, chunks: list[EmbeddedChunk]) -> None: ...
    def prune(self, source: EcfrSource, keep_urls: list[str]) -> int: ...
    def record_snapshot(self, source: EcfrSource, snapshot: str) -> None: ...


class SupabaseKnowledgeStore:
    def __init__(self, client: Any) -> None:
        self._client = client

    def existing(self, source: EcfrSource) -> dict[str, StoredSection]:
        found: dict[str, StoredSection] = {}
        start = 0
        while True:
            rows = (
                self._client.table("knowledge_documents")
                .select("source_url,content_sha256,title")
                .is_("tenant_id", "null")
                .like("source_url", f"{source.url_prefix}%")
                .order("source_url")
                .range(start, start + PAGE_SIZE - 1)
                .execute()
            ).data or []
            for row in rows:
                found[row["source_url"]] = StoredSection(row["content_sha256"], row["title"])
            if len(rows) < PAGE_SIZE:
                return found
            start += PAGE_SIZE

    def replace(self, source: EcfrSource, section: Section, chunks: list[EmbeddedChunk]) -> None:
        payload = [
            {
                "chunk_index": item.chunk.index,
                "text": item.chunk.text,
                "embedding": vector_literal(item.embedding),
                "token_count": item.chunk.token_estimate,
                "metadata": chunk_metadata(source, section, item.chunk),
            }
            for item in chunks
        ]
        self._client.rpc("replace_regulation_document", {
            "p_source_type": source.source_type,
            "p_title": section.title,
            "p_jurisdiction": source.jurisdiction,
            "p_source_url": section.source_url,
            "p_content_sha256": section.content_sha256,
            "p_chunks": payload,
        }).execute()

    def prune(self, source: EcfrSource, keep_urls: list[str]) -> int:
        res = self._client.rpc("prune_regulation_documents", {
            "p_url_prefix": source.url_prefix, "p_keep_urls": keep_urls,
        }).execute()
        return int(res.data or 0)

    def record_snapshot(self, source: EcfrSource, snapshot: str) -> None:
        self._client.rpc("record_regulation_snapshot", {
            "p_source": source.key, "p_title": source.label,
            "p_ecfr_title": source.ecfr_title, "p_ecfr_part": source.ecfr_part,
            "p_snapshot": snapshot,
        }).execute()


def chunk_metadata(source: EcfrSource, section: Section, chunk: Chunk) -> dict[str, str]:
    """What the assistant cites: `[title § 262.10(a)]` reads the ``section`` key."""
    return {
        "section": section.citation + (chunk.anchor if not section.is_appendix else ""),
        "subpart": section.subpart,
        "citation": section.citation,
        "source_path": f"ecfr:title-{source.ecfr_title}/part-{source.ecfr_part}/{section.citation}",
    }
