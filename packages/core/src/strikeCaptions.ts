// Narration captions for STRIKE motion scenes. The web player hands the .vtt
// file to the browser's <audio> text track; React Native has no text tracks,
// so the tablet parses the cues itself and looks them up by playback position.
// Only the WebVTT subset the learning studio writes is supported: a header,
// optional cue identifiers, `start --> end` timings and one or more text lines.

import type { StrikeMotionSceneBlock, StrikeSceneBeat } from './strikeContent'

export interface StrikeCaptionCue {
  startMs: number
  endMs: number
  text: string
}

const TIMING_RE = /^((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{3})/

/** Cues in start order. Malformed cues are skipped rather than failing the scene. */
export function parseWebVtt(source: string): StrikeCaptionCue[] {
  const blocks = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const cues: StrikeCaptionCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(line => line.trim() !== '')
    const timingIndex = lines.findIndex(line => TIMING_RE.test(line))
    if (timingIndex === -1) continue
    const [, start, end] = lines[timingIndex].match(TIMING_RE)!
    const startMs = vttTimestampMs(start)
    const endMs = vttTimestampMs(end)
    const text = lines.slice(timingIndex + 1).join('\n').trim()
    if (endMs <= startMs || text === '') continue
    cues.push({ startMs, endMs, text })
  }
  return cues.sort((a, b) => a.startMs - b.startMs)
}

/** Silent scenes show every beat at once; narrated scenes reveal each on its cue. */
export function visibleSceneBeats(block: StrikeMotionSceneBlock, positionMs: number): StrikeSceneBeat[] {
  return block.narration ? block.beats.filter(beat => beat.at_ms <= positionMs) : block.beats
}

/** The cue showing at `positionMs`, or null in a gap between cues. */
export function activeCaptionCue(cues: readonly StrikeCaptionCue[], positionMs: number): StrikeCaptionCue | null {
  return cues.find(cue => positionMs >= cue.startMs && positionMs < cue.endMs) ?? null
}

// "mm:ss.ttt" or "hh:mm:ss.ttt".
function vttTimestampMs(stamp: string): number {
  const [clock, millis] = stamp.split('.')
  const seconds = clock.split(':').map(Number).reduce((total, part) => total * 60 + part, 0)
  return seconds * 1000 + Number(millis)
}
