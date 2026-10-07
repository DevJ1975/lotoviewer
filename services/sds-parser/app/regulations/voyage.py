"""Embed regulation chunks with Voyage, the model the assistant searches with.

Must match the web app (apps/web/lib/ai/embeddings.ts): ``voyage-3-large``,
``input_type: "document"`` for corpus text (queries use ``"query"``; mixing the
two degrades recall), 1024 dimensions. Unlike the web app's client this one
retries rate limits and outages, because loading a part is thousands of requests
and one 429 should not throw away the run.
"""

from __future__ import annotations

import os
from typing import Any, Callable, Sequence

from .http import HttpFailure, request_with_retry

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
MODEL = "voyage-3-large"
DIMENSIONS = 1024
BATCH_SIZE = 128
REQUEST_TIMEOUT_SECONDS = 60.0


class EmbeddingError(RuntimeError):
    """Embedding failed. ``retryable`` says whether the whole job may try again later."""

    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class VoyageEmbedder:
    def __init__(self, api_key: str, client: Any, sleep: Callable[[float], None] | None = None) -> None:
        self._api_key = api_key
        self._client = client
        self._sleep = sleep

    @classmethod
    def from_env(cls, client: Any) -> "VoyageEmbedder":
        api_key = os.environ.get("VOYAGE_API_KEY", "").strip()
        if not api_key:
            raise EmbeddingError("VOYAGE_API_KEY is not set on the service", retryable=False)
        return cls(api_key, client)

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            vectors.extend(self._embed_batch(list(texts[start:start + BATCH_SIZE])))
        return vectors

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        extra = {"sleep": self._sleep} if self._sleep else {}
        try:
            response = request_with_retry(
                self._client, "POST", VOYAGE_URL,
                headers={"authorization": f"Bearer {self._api_key}", "content-type": "application/json"},
                json={"model": MODEL, "input": batch, "input_type": "document"},
                timeout=REQUEST_TIMEOUT_SECONDS, **extra,
            )
        except HttpFailure as exc:
            # 401/403/400 will not improve on a retry; a lasting 429/5xx might.
            raise EmbeddingError(f"Voyage request failed: {exc}", retryable=exc.retryable) from exc

        data = response.json().get("data")
        if not isinstance(data, list) or len(data) != len(batch):
            raise EmbeddingError("Voyage returned an unexpected number of embeddings", retryable=False)
        vectors = [item.get("embedding") for item in sorted(data, key=lambda item: item.get("index", 0))]
        for vector in vectors:
            if not isinstance(vector, list) or len(vector) != DIMENSIONS:
                raise EmbeddingError(
                    f"Voyage returned a vector of the wrong size (expected {DIMENSIONS})", retryable=False,
                )
        return vectors


def vector_literal(vector: Sequence[float]) -> str:
    """pgvector's text form. Six decimals matches the corpus already loaded."""
    return "[" + ",".join(f"{x:.6f}" for x in vector) + "]"
