"""Tests for the regulation chunker (app/regulations/chunker.py).

The web app's chunker had three defects this one was written to avoid: infinite
recursion on a paragraph without sentence terminators, silent truncation of a
chunk over the character cap, and citing the overlap's paragraph instead of the
chunk's own. Each has a test here.
"""

from __future__ import annotations

import random
import unittest

from app.regulations.chunker import (
    HARD_CHAR_CAP,
    OVERLAP_TOKENS,
    TARGET_TOKENS,
    approx_tokens,
    chunk_text,
)


def words_of(text: str) -> set[str]:
    return set(text.split())


class ChunkContractTests(unittest.TestCase):
    def test_empty_text_has_no_chunks(self) -> None:
        for blank in ("", "   ", "\n\n \n"):
            self.assertEqual(chunk_text(blank), [])

    def test_a_short_section_is_one_chunk(self) -> None:
        (chunk,) = chunk_text("(a) General. A generator must make a hazardous waste determination.")
        self.assertEqual((chunk.index, chunk.anchor), (0, "(a)"))
        self.assertEqual(chunk.token_estimate, approx_tokens(chunk.text))

    def test_chunks_are_numbered_in_order(self) -> None:
        text = "\n\n".join(f"({chr(97 + i % 26)}) " + "Sentence one. " * 120 for i in range(12))
        chunks = chunk_text(text)
        self.assertGreater(len(chunks), 1)
        self.assertEqual([c.index for c in chunks], list(range(len(chunks))))

    def test_chunks_stay_near_the_target_and_far_under_the_cap(self) -> None:
        text = "\n\n".join("A sentence about hazardous waste storage. " * 40 for _ in range(30))
        for chunk in chunk_text(text):
            self.assertLessEqual(chunk.token_estimate, TARGET_TOKENS + OVERLAP_TOKENS + 5)
            self.assertLess(len(chunk.text), HARD_CHAR_CAP)

    def test_adjacent_chunks_overlap_so_a_split_sentence_keeps_its_context(self) -> None:
        paragraphs = [f"Paragraph {i} " + "waste " * 300 + f"ends here {i}." for i in range(6)]
        chunks = chunk_text("\n\n".join(paragraphs))
        self.assertGreater(len(chunks), 2)
        for before, after in zip(chunks, chunks[1:]):
            tail = before.text.split()[-3:]
            self.assertIn(" ".join(tail), after.text)


class AdversarialInputTests(unittest.TestCase):
    """The shapes that made the original recurse forever or lose text."""

    def test_a_long_table_without_sentence_terminators_terminates(self) -> None:
        table = "\n".join(f"row {i} | CAS 67-64-1 | 500 lb" for i in range(800))
        chunks = chunk_text(table)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(c.text) < HARD_CHAR_CAP for c in chunks))

    def test_words_with_no_punctuation_at_all_terminate(self) -> None:
        chunks = chunk_text("word " * 6000)
        self.assertTrue(all(len(c.text) < HARD_CHAR_CAP for c in chunks))

    def test_a_single_unbroken_run_longer_than_a_chunk_is_sliced(self) -> None:
        chunks = chunk_text("x" * 50_000)
        self.assertTrue(all(len(c.text) < HARD_CHAR_CAP for c in chunks))
        self.assertEqual(sum(len(c.text) for c in chunks) >= 50_000, True)

    def test_one_enormous_sentence_does_not_break_the_cap(self) -> None:
        # A real shape: a single legal sentence of thousands of words. The original
        # carried it whole into the next chunk as "overlap" and then truncated.
        sentence = ", ".join(f"clause {i} of the requirement" for i in range(1500)) + "."
        text = sentence + "\n\n" + sentence + "\n\n(b) The end of the section."
        chunks = chunk_text(text)
        self.assertTrue(all(len(c.text) < HARD_CHAR_CAP for c in chunks))
        self.assertIn("The end of the section.", chunks[-1].text)

    def test_nothing_is_truncated(self) -> None:
        # Every word of the input reaches some chunk, including the very end.
        rng = random.Random(7)
        vocabulary = [f"w{n}" for n in range(400)]
        for trial in range(25):
            paragraphs = []
            for _ in range(rng.randint(1, 8)):
                sentences = [
                    " ".join(rng.choices(vocabulary, k=rng.randint(1, 400))) + rng.choice([".", "", "?", ";"])
                    for _ in range(rng.randint(1, 12))
                ]
                paragraphs.append(" ".join(sentences))
            text = "\n\n".join(paragraphs)
            chunks = chunk_text(text)
            self.assertTrue(words_of(text) <= words_of(" ".join(c.text for c in chunks)), f"trial {trial}")
            self.assertTrue(all(len(c.text) < HARD_CHAR_CAP for c in chunks), f"trial {trial}")


class AnchorTests(unittest.TestCase):
    def test_the_anchor_is_the_chunks_own_first_paragraph_label(self) -> None:
        text = "(c)(4)(ii) " + "First sentence. " * 5 + "\n\n(d) Second paragraph."
        self.assertEqual(chunk_text(text)[0].anchor, "(c)(4)(ii)")

    def test_a_chunk_does_not_inherit_the_anchor_of_its_overlap(self) -> None:
        # The short "(a)" paragraph ends chunk 0, so it is carried into chunk 1 as
        # overlap. Chunk 1 starts at "(b)": citing "(a)" would point at text that
        # is only there for context.
        long_filler = "Alpha sentence. " * 190
        text = "\n\n".join((long_filler, "(a) Short last sentence.", "(b) " + "Beta sentence. " * 100))
        chunks = chunk_text(text)
        self.assertEqual(len(chunks), 2)
        self.assertTrue(chunks[1].text.startswith("(a) Short last sentence."), "overlap was carried in")
        self.assertEqual(chunks[1].anchor, "(b)")

    def test_no_label_means_no_anchor(self) -> None:
        (chunk,) = chunk_text("This paragraph has no paragraph label at all.")
        self.assertEqual(chunk.anchor, "")

    def test_a_label_must_be_at_the_start(self) -> None:
        (chunk,) = chunk_text("See paragraph (a) of this section for details.")
        self.assertEqual(chunk.anchor, "")


if __name__ == "__main__":
    unittest.main()
