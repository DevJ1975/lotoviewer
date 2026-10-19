"""WebVTT captions for narration. Pure: no I/O, no Django.

Captions are mandatory for every narrated scene (Section 508), so they are
built from the TTS character alignment when we have it, and from the script
plus total duration when we only know how long the audio runs.
"""
from dataclasses import dataclass

MAX_LINE_CHARS = 42
MAX_LINES = 2
SENTENCE_END = (".", "!", "?")
CLAUSE_END = (",", ";", ":", "—")


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    lines: tuple[str, ...]


def words_from_alignment(characters: list[str], starts: list[float], ends: list[float]) -> list[Word]:
    """Collapse per-character timings into words (split on whitespace)."""
    if not (len(characters) == len(starts) == len(ends)):
        raise ValueError("Alignment arrays must be the same length")
    words: list[Word] = []
    buffer, word_start, word_end = "", 0.0, 0.0
    for char, start, end in zip(characters, starts, ends, strict=True):
        if char.isspace():
            if buffer:
                words.append(Word(buffer, word_start, word_end))
                buffer = ""
            continue
        if not buffer:
            word_start = start
        buffer += char
        word_end = end
    if buffer:
        words.append(Word(buffer, word_start, word_end))
    return words


def words_from_script(script: str, duration_ms: int) -> list[Word]:
    """Synthesize word timings proportional to character count (plus a space)."""
    tokens = script.split()
    if not tokens or duration_ms <= 0:
        return []
    weights = [len(token) + 1 for token in tokens]
    per_unit = (duration_ms / 1000) / sum(weights)
    words, clock = [], 0.0
    for token, weight in zip(tokens, weights, strict=True):
        span = weight * per_unit
        words.append(Word(token, clock, clock + span))
        clock += span
    return words


def wrap(text: str, width: int = MAX_LINE_CHARS) -> list[str]:
    lines: list[str] = []
    current = ""
    for token in text.split():
        candidate = f"{current} {token}".strip()
        if len(candidate) <= width or not current:
            current = candidate
        else:
            lines.append(current)
            current = token
    if current:
        lines.append(current)
    return lines


def group_cues(words: list[Word]) -> list[Cue]:
    """Greedy cue building: a cue ends at a sentence end, at a clause end once
    it already fills a line, or when another word would overflow two lines."""
    cues: list[Cue] = []
    current: list[Word] = []

    def flush() -> None:
        if current:
            text = " ".join(w.text for w in current)
            cues.append(Cue(current[0].start, current[-1].end, tuple(wrap(text))))
            current.clear()

    for word in words:
        if current:
            candidate = " ".join(w.text for w in [*current, word])
            if len(wrap(candidate)) > MAX_LINES:
                flush()
        current.append(word)
        text_len = len(" ".join(w.text for w in current))
        if word.text.endswith(SENTENCE_END) or (word.text.endswith(CLAUSE_END)
                                                and text_len >= MAX_LINE_CHARS):
            flush()
    flush()
    return cues


def format_timestamp(seconds: float) -> str:
    millis = max(0, round(seconds * 1000))
    hours, rem = divmod(millis, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def render_vtt(cues: list[Cue]) -> str:
    blocks = ["WEBVTT", ""]
    for index, cue in enumerate(cues, start=1):
        blocks.append(str(index))
        blocks.append(f"{format_timestamp(cue.start)} --> {format_timestamp(cue.end)}")
        blocks.extend(cue.lines)
        blocks.append("")
    return "\n".join(blocks)


def vtt_from_alignment(characters: list[str], starts: list[float], ends: list[float]) -> str:
    return render_vtt(group_cues(words_from_alignment(characters, starts, ends)))


def vtt_from_script(script: str, duration_ms: int) -> str:
    return render_vtt(group_cues(words_from_script(script, duration_ms)))
