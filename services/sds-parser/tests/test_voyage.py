"""Tests for the Voyage embeddings client (app/regulations/voyage.py)."""

from __future__ import annotations

import importlib.util
import os
import unittest
from unittest import mock

from app.regulations.voyage import (
    BATCH_SIZE,
    DIMENSIONS,
    MODEL,
    EmbeddingError,
    VoyageEmbedder,
    vector_literal,
)

HTTPX = importlib.util.find_spec("httpx") is not None


def vec(seed: float) -> list[float]:
    return [seed] * DIMENSIONS


@unittest.skipUnless(HTTPX, "needs httpx")
class EmbedTests(unittest.TestCase):
    def embedder(self, handler, sleeps=None):
        import httpx
        client = httpx.Client(transport=httpx.MockTransport(handler))
        return VoyageEmbedder("key-123", client, sleep=(sleeps.append if sleeps is not None else (lambda s: None)))

    def respond(self, request, *, shuffle=False):
        import httpx, json
        body = json.loads(request.content)
        items = [{"index": i, "embedding": vec(float(i))} for i in range(len(body["input"]))]
        return httpx.Response(200, json={"data": list(reversed(items)) if shuffle else items})

    def test_documents_are_embedded_with_the_document_input_type_and_the_shared_model(self) -> None:
        import json
        seen = []

        def handler(request):
            seen.append(request)
            return self.respond(request)

        self.embedder(handler).embed_documents(["a", "b"])
        (request,) = seen
        body = json.loads(request.content)
        self.assertEqual((body["model"], body["input_type"], body["input"]), (MODEL, "document", ["a", "b"]))
        self.assertEqual(request.headers["authorization"], "Bearer key-123")

    def test_vectors_come_back_in_input_order_even_if_the_server_shuffles_them(self) -> None:
        out = self.embedder(lambda r: self.respond(r, shuffle=True)).embed_documents(["a", "b", "c"])
        self.assertEqual([v[0] for v in out], [0.0, 1.0, 2.0])

    def test_large_inputs_are_sent_in_batches_of_the_api_limit(self) -> None:
        import json
        sizes = []

        def handler(request):
            sizes.append(len(json.loads(request.content)["input"]))
            return self.respond(request)

        out = self.embedder(handler).embed_documents([f"t{i}" for i in range(BATCH_SIZE * 2 + 5)])
        self.assertEqual(sizes, [BATCH_SIZE, BATCH_SIZE, 5])
        self.assertEqual(len(out), BATCH_SIZE * 2 + 5)

    def test_nothing_to_embed_makes_no_request(self) -> None:
        def handler(request):
            raise AssertionError("no request expected")

        self.assertEqual(self.embedder(handler).embed_documents([]), [])

    def test_a_rate_limit_is_waited_out_and_retried(self) -> None:
        import httpx
        codes = iter([429, 200])
        sleeps: list[float] = []

        def handler(request):
            return httpx.Response(429, headers={"retry-after": "3"}) if next(codes) == 429 else self.respond(request)

        self.embedder(handler, sleeps).embed_documents(["a"])
        self.assertEqual(sleeps, [3.0])

    def test_bad_credentials_are_not_retried_and_are_not_retryable(self) -> None:
        import httpx
        calls = []

        def handler(request):
            calls.append(1)
            return httpx.Response(401)

        with self.assertRaises(EmbeddingError) as caught:
            self.embedder(handler).embed_documents(["a"])
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(len(calls), 1)

    def test_a_lasting_outage_is_retryable_by_the_job(self) -> None:
        import httpx
        with self.assertRaises(EmbeddingError) as caught:
            self.embedder(lambda r: httpx.Response(503)).embed_documents(["a"])
        self.assertTrue(caught.exception.retryable)

    def test_the_api_key_never_appears_in_an_error(self) -> None:
        import httpx
        with self.assertRaises(EmbeddingError) as caught:
            self.embedder(lambda r: httpx.Response(403)).embed_documents(["a"])
        self.assertNotIn("key-123", str(caught.exception))

    def test_a_wrong_sized_vector_is_rejected_rather_than_stored(self) -> None:
        import httpx
        bad = lambda r: httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.1] * 10}]})
        with self.assertRaisesRegex(EmbeddingError, "wrong size"):
            self.embedder(bad).embed_documents(["a"])

    def test_a_short_answer_is_rejected(self) -> None:
        import httpx
        short = lambda r: httpx.Response(200, json={"data": [{"index": 0, "embedding": vec(0.0)}]})
        with self.assertRaisesRegex(EmbeddingError, "unexpected number"):
            self.embedder(short).embed_documents(["a", "b"])


class KeyTests(unittest.TestCase):
    def test_a_missing_key_is_a_permanent_configuration_error(self) -> None:
        with mock.patch.dict(os.environ, {"VOYAGE_API_KEY": "  "}):
            with self.assertRaises(EmbeddingError) as caught:
                VoyageEmbedder.from_env(client=object())
        self.assertFalse(caught.exception.retryable)

    def test_the_key_is_read_from_the_environment(self) -> None:
        with mock.patch.dict(os.environ, {"VOYAGE_API_KEY": "abc"}):
            self.assertIsInstance(VoyageEmbedder.from_env(client=object()), VoyageEmbedder)


class VectorLiteralTests(unittest.TestCase):
    def test_pgvector_text_form_with_six_decimals(self) -> None:
        self.assertEqual(vector_literal([0.1, -2.0, 3.14159265]), "[0.100000,-2.000000,3.141593]")


if __name__ == "__main__":
    unittest.main()
