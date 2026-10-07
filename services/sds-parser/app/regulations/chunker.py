"""Split a regulation section into retrieval chunks.

Same shape as the web app's chunker (apps/web/lib/ai/chunker.ts) so a corpus
loaded here retrieves like the rest of the knowledge base: ~800-token chunks
(4 chars per token) with ~100 tokens of overlap, split on paragraphs, then
sentences.

It differs from that chunker in three deliberate ways, each a defect there:

* A paragraph with no sentence terminator (a long table, a list of CAS numbers)
  is split on words instead of recursing on itself forever.
* The overlap is bounded. The original carries the previous paragraph's last
  sentence whole, however long; with a long sentence the chunk then exceeded the
  character cap and the end of the section was silently cut off. Here nothing is
  ever truncated: a chunk over the cap is an error.
* A chunk's section anchor comes from its own first paragraph, not from the
  overlap it inherited, so a citation points where the text actually starts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

APPROX_CHARS_PER_TOKEN = 4
TARGET_TOKENS = 800
OVERLAP_TOKENS = 100
# knowledge_chunks.text allows 8000; this leaves room and is far above what the
# target plus overlap can reach.
HARD_CHAR_CAP = 6000

_TARGET_CHARS = TARGET_TOKENS * APPROX_CHARS_PER_TOKEN
_OVERLAP_CHARS = OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN

_SENTENCE_BREAK = re.compile(r"(?<=[.!?])[ \n]+")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
# "(c)(4)(ii)" at the start of a paragraph: the regulatory paragraph label.
_ANCHOR = re.compile(r"^\s*((?:\([0-9A-Za-z]{1,4}\)){1,6})")


@dataclass(frozen=True)
class Chunk:
    index: int
    text: str
    token_estimate: int
    # Paragraph label of the chunk's own first paragraph, e.g. "(c)(4)"; "" if none.
    anchor: str


def approx_tokens(text: str) -> int:
    return -(-len(text) // APPROX_CHARS_PER_TOKEN)


def chunk_text(text: str) -> list[Chunk]:
    paragraphs = [p.strip() for p in _PARAGRAPH_BREAK.split(text) if p.strip()]
    pieces = [piece for paragraph in paragraphs for piece in _fit(paragraph)]

    chunks: list[Chunk] = []
    buffer: list[str] = []      # the overlap seed (if any), then whole pieces
    own_first: str | None = None  # the first piece that is not the seed
    buffer_tokens = 0

    def flush() -> str:
        """Emit the buffer as a chunk; return the overlap to start the next one."""
        nonlocal buffer, own_first, buffer_tokens
        tail = ""
        if buffer and own_first is not None:
            joined = "\n\n".join(buffer).strip()
            if len(joined) > HARD_CHAR_CAP:
                raise ValueError(f"chunk of {len(joined)} characters exceeds the {HARD_CHAR_CAP} cap")
            match = _ANCHOR.match(own_first)
            chunks.append(Chunk(len(chunks), joined, approx_tokens(joined), match.group(1) if match else ""))
            tail = _overlap_tail(buffer[-1])
        buffer, own_first, buffer_tokens = [], None, 0
        return tail

    for piece in pieces:
        piece_tokens = approx_tokens(piece)
        if own_first is not None and buffer_tokens + piece_tokens > TARGET_TOKENS:
            seed = flush()
            if seed:
                buffer, buffer_tokens = [seed], approx_tokens(seed)
        if own_first is None:
            own_first = piece
        buffer.append(piece)
        buffer_tokens += piece_tokens
    flush()
    return chunks


def _fit(text: str) -> list[str]:
    """Split text into pieces that each fit the target, preferring sentence breaks."""
    if approx_tokens(text) <= TARGET_TOKENS:
        return [text]
    sentences = [s for s in _SENTENCE_BREAK.split(text) if s]
    if len(sentences) > 1:
        return [piece for sentence in sentences for piece in _fit(sentence)]
    return _split_words(text)


def _split_words(text: str) -> list[str]:
    pieces: list[str] = []
    current = ""
    for word in text.split():
        while len(word) > _TARGET_CHARS:  # an unbroken run longer than a chunk
            if current:
                pieces.append(current)
                current = ""
            pieces.append(word[:_TARGET_CHARS])
            word = word[_TARGET_CHARS:]
        if current and len(current) + 1 + len(word) > _TARGET_CHARS:
            pieces.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        pieces.append(current)
    return pieces


def _overlap_tail(last_piece: str) -> str:
    """The end of the previous chunk, carried into the next for context.

    Whole trailing sentences while they fit the overlap budget; if even the last
    sentence is longer than the budget, its last words instead, so the carried
    text is always bounded.
    """
    seed: list[str] = []
    used = 0
    for sentence in reversed([s for s in _SENTENCE_BREAK.split(last_piece) if s]):
        cost = approx_tokens(sentence)
        if used + cost > OVERLAP_TOKENS:
            break
        seed.insert(0, sentence)
        used += cost
    if seed:
        return " ".join(seed)
    tail = last_piece[-_OVERLAP_CHARS:]
    cut = tail.find(" ")
    return tail[cut + 1:] if 0 <= cut < len(tail) - 1 else tail
