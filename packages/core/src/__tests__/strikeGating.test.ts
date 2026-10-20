import { describe, expect, it } from 'vitest'
import { isStrikeBlockLocked, strikeBlockGate } from '../strikeGating'
import type { StrikeBlock, StrikeContent } from '../strikeContent'

const scene = (key: string, narrated = true): StrikeBlock => ({
  kind: 'motion_scene',
  key,
  eyebrow: null,
  title: key,
  script: '',
  beats: [],
  animation: 'static',
  image: null,
  narration: narrated
    ? { audio_path: `${key}.mp3`, captions_path: `${key}.vtt`, transcript: '', duration_ms: 1000, voice: null, approval: 'approved' } as never
    : null,
})

const callout = (key: string): StrikeBlock => ({ kind: 'callout', key, tone: 'danger', title: key, body: '' })

const content: StrikeContent = { blocks: [scene('s1'), callout('c1'), scene('s2', false)] }

describe('strikeBlockGate', () => {
  it('opens the first block and locks everything after it on a fresh attempt', () => {
    const gate = strikeBlockGate(content, [])
    expect(gate.missing).toEqual(['s1', 'c1', 's2'])
    expect(gate.firstOpen?.key).toBe('s1')
    expect([0, 1, 2].map(i => isStrikeBlockLocked(gate, i))).toEqual([false, true, true])
  })

  it('a narrated scene needs "completed"; merely seeing it does not unlock the next block', () => {
    const gate = strikeBlockGate(content, [{ block_key: 's1', event: 'seen' }])
    expect(gate.firstOpen?.key).toBe('s1')
    expect(isStrikeBlockLocked(gate, 1)).toBe(true)
  })

  it('moves the lock forward as blocks are finished', () => {
    const gate = strikeBlockGate(content, [
      { block_key: 's1', event: 'completed' },
      { block_key: 'c1', event: 'seen' },
    ])
    expect(gate.firstOpen?.key).toBe('s2')
    expect([0, 1, 2].map(i => isStrikeBlockLocked(gate, i))).toEqual([false, false, false])
  })

  it('stays locked behind an unfinished earlier block even if later ones were reached', () => {
    const gate = strikeBlockGate(content, [{ block_key: 's2', event: 'seen' }])
    expect(gate.missing).toEqual(['s1', 'c1'])
    expect(isStrikeBlockLocked(gate, 2)).toBe(true)
  })

  it('locks nothing once every block is done', () => {
    const gate = strikeBlockGate(content, [
      { block_key: 's1', event: 'completed' },
      { block_key: 'c1', event: 'seen' },
      { block_key: 's2', event: 'seen' },
    ])
    expect(gate).toMatchObject({ missing: [], firstOpen: null, firstOpenIndex: -1 })
    expect(isStrikeBlockLocked(gate, 2)).toBe(false)
  })
})
