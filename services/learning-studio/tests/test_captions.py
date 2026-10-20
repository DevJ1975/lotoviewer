from itertools import pairwise

from studio.captions import (
    MAX_LINE_CHARS,
    format_timestamp,
    group_cues,
    vtt_from_alignment,
    vtt_from_script,
    words_from_alignment,
    words_from_script,
    wrap,
)


def alignment_for(text: str, seconds_per_char: float = 0.05):
    chars = list(text)
    starts = [i * seconds_per_char for i in range(len(chars))]
    ends = [(i + 1) * seconds_per_char for i in range(len(chars))]
    return chars, starts, ends


def test_words_from_alignment_uses_first_and_last_character_times():
    words = words_from_alignment(*alignment_for("Lock it."))
    assert [w.text for w in words] == ["Lock", "it."]
    assert words[0].start == 0.0
    assert round(words[0].end, 3) == 0.2
    assert round(words[1].start, 3) == 0.25


def test_mismatched_alignment_arrays_are_rejected():
    import pytest

    with pytest.raises(ValueError):
        words_from_alignment(["a", "b"], [0.0], [0.1, 0.2])


def test_script_timing_is_proportional_and_fills_the_duration():
    words = words_from_script("a bbb", 1000)
    assert round(words[0].end - words[0].start, 3) == round(1 * 2 / 6, 3)
    assert round(words[-1].end, 6) == 1.0
    assert words_from_script("", 1000) == []
    assert words_from_script("text", 0) == []


def test_wrap_never_exceeds_line_width_except_for_a_single_long_token():
    lines = wrap("Move every energy-isolating device to the safe position and open the disconnect")
    assert all(len(line) <= MAX_LINE_CHARS for line in lines)
    assert wrap("x" * 60) == ["x" * 60]


def test_cues_break_at_sentence_ends_and_never_exceed_two_lines():
    script = ("Step one: prepare. Read the machine's lockout placard so you know every energy "
              "source and where its isolation point is, then notify the affected employees "
              "that you are shutting the machine down and locking it out.")
    cues = group_cues(words_from_script(script, 20_000))
    assert cues[0].lines == ("Step one: prepare.",)
    assert all(len(c.lines) <= 2 for c in cues)
    assert all(len(line) <= MAX_LINE_CHARS for c in cues for line in c.lines)
    assert all(a.end <= b.start + 1e-9 for a, b in pairwise(cues))


def test_vtt_output_is_well_formed():
    vtt = vtt_from_alignment(*alignment_for("Verify zero energy. Then work."))
    lines = vtt.splitlines()
    assert lines[0] == "WEBVTT"
    assert lines[2] == "1"
    assert lines[3] == "00:00:00.000 --> 00:00:00.950"
    assert lines[4] == "Verify zero energy."
    assert "2" in lines


def test_vtt_from_script_covers_the_full_duration():
    vtt = vtt_from_script("One person, one lock, one key.", 3000)
    assert vtt.rstrip().splitlines()[-2].endswith("--> 00:00:03.000")


def test_timestamp_formatting_rolls_over_hours():
    assert format_timestamp(3725.5) == "01:02:05.500"
    assert format_timestamp(-1) == "00:00:00.000"
