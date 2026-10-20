import { describe, expect, it } from 'vitest'
import { activeCaptionCue, parseWebVtt, visibleSceneBeats } from '../strikeCaptions'
import type { StrikeMotionSceneBlock } from '../strikeContent'

// Shape copied from services/learning-studio/seed/loto-101/s1-why.es.vtt.
const STUDIO_VTT = `WEBVTT

1
00:00:00.000 --> 00:00:02.821
Cada máquina de esta planta almacena
energía.

2
00:00:03.100 --> 00:00:07.024
Cuando alguien mete las manos en una
máquina que arranca de forma inesperada,
`

describe('parseWebVtt', () => {
  it('reads the learning studio output, keeping multi-line cue text', () => {
    expect(parseWebVtt(STUDIO_VTT)).toEqual([
      { startMs: 0, endMs: 2821, text: 'Cada máquina de esta planta almacena\nenergía.' },
      { startMs: 3100, endMs: 7024, text: 'Cuando alguien mete las manos en una\nmáquina que arranca de forma inesperada,' },
    ])
  })

  it('accepts hour timestamps, CRLF line endings, a BOM and cues without identifiers', () => {
    const cues = parseWebVtt('﻿WEBVTT\r\n\r\n01:00:01.500 --> 01:00:02.000\r\nLate line\r\n')
    expect(cues).toEqual([{ startMs: 3_601_500, endMs: 3_602_000, text: 'Late line' }])
  })

  it('skips malformed, empty and backwards cues instead of failing the scene', () => {
    const cues = parseWebVtt('WEBVTT\n\n00:00:05.000 --> 00:00:04.000\nBackwards\n\n00:00:06.000 --> 00:00:07.000\n\nnot a cue\n\n00:00:08.000 --> 00:00:09.000\nKept')
    expect(cues.map(c => c.text)).toEqual(['Kept'])
  })

  it('returns cues in start order', () => {
    const cues = parseWebVtt('WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nB\n\n00:00:01.000 --> 00:00:02.000\nA')
    expect(cues.map(c => c.text)).toEqual(['A', 'B'])
  })
})

describe('activeCaptionCue', () => {
  const cues = parseWebVtt(STUDIO_VTT)

  it('finds the cue on screen, with an inclusive start and exclusive end', () => {
    expect(activeCaptionCue(cues, 0)?.startMs).toBe(0)
    expect(activeCaptionCue(cues, 2820)?.startMs).toBe(0)
    expect(activeCaptionCue(cues, 3100)?.startMs).toBe(3100)
  })

  it('shows nothing in the gap between cues or after the last one', () => {
    expect(activeCaptionCue(cues, 2900)).toBeNull()
    expect(activeCaptionCue(cues, 9000)).toBeNull()
  })
})

describe('visibleSceneBeats', () => {
  const beats = [{ at_ms: 0, text: 'one' }, { at_ms: 4000, text: 'two' }]
  const block = (narrated: boolean) => ({ kind: 'motion_scene', beats, narration: narrated ? {} : null }) as unknown as StrikeMotionSceneBlock

  it('reveals narrated beats on their cue', () => {
    expect(visibleSceneBeats(block(true), 3999).map(b => b.text)).toEqual(['one'])
    expect(visibleSceneBeats(block(true), 4000).map(b => b.text)).toEqual(['one', 'two'])
  })

  it('shows every beat of a silent scene at once', () => {
    expect(visibleSceneBeats(block(false), 0)).toHaveLength(2)
  })
})
