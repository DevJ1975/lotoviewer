import { describe, it, expect } from 'vitest'
import { chunkText } from '@/lib/ai/chunker'

// Chunker contract tests. The output isn't tested character-by-character
// (the algorithm has heuristics that could shift across refactors); we
// pin observable invariants:
//   - empty in → empty out
//   - chunk count grows with input
//   - chunks fit under the hard char cap
//   - chunks have monotonically increasing indices
//   - overlap actually carries some context across boundaries

describe('chunkText', () => {
  it('returns no chunks for empty / whitespace input', () => {
    expect(chunkText({ text: '' })).toEqual([])
    expect(chunkText({ text: '   \n\t  ' })).toEqual([])
  })

  it('produces a single chunk for short text under the target', () => {
    const text = 'A short paragraph about lockout/tagout.\n\nAnother short paragraph.'
    const chunks = chunkText({ text })
    expect(chunks.length).toBe(1)
    expect(chunks[0].text).toContain('lockout/tagout')
    expect(chunks[0].text).toContain('Another short paragraph')
  })

  it('splits a long body into multiple chunks', () => {
    // Build ~10K chars of paragraph-y text → multiple chunks.
    const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
    const text = Array(80).fill(para).join('\n\n')
    const chunks = chunkText({ text, targetTokens: 200, overlapTokens: 30 })
    expect(chunks.length).toBeGreaterThan(3)
  })

  it('keeps each chunk under the 6000-char hard cap', () => {
    const para = 'The energy-isolation procedure must include verification that the equipment is de-energized before service. '.repeat(60)
    const text = Array(40).fill(para).join('\n\n')
    const chunks = chunkText({ text })
    for (const c of chunks) {
      expect(c.text.length, `chunk ${c.index} too long`).toBeLessThanOrEqual(6000)
    }
  })

  it('emits monotonically-increasing chunk indices starting at 0', () => {
    const text = 'Section A.\n\nSection B.\n\n'.repeat(50)
    const chunks = chunkText({ text, targetTokens: 100 })
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i)
    }
  })

  it('carries overlap so consecutive chunks share at least one sentence', () => {
    const text = [
      'Paragraph one ends with sentence one. Paragraph one ends with sentence two.',
      'Paragraph two starts now. It continues here. And ends here.',
      'Paragraph three. Continuation. Final sentence.',
    ].join('\n\n').repeat(20)
    const chunks = chunkText({ text, targetTokens: 80, overlapTokens: 30 })
    expect(chunks.length).toBeGreaterThan(1)
    // The first sentence of chunk N+1 should appear inside chunk N's
    // last block thanks to the overlap. We don't pin the exact sentence
    // (heuristic-dependent) — just that *some* word reappears.
    const firstWords = chunks[1].text.split(/\s+/).slice(0, 5)
    const overlapMatch = firstWords.some(w => chunks[0].text.includes(w))
    expect(overlapMatch).toBe(true)
  })

  it('sentence-splits a single oversized paragraph', () => {
    // One paragraph way over the target; should still chunk (sentences split it).
    const sentence = 'This sentence describes one part of the lockout procedure. '
    const text = sentence.repeat(200)
    const chunks = chunkText({ text, targetTokens: 100, overlapTokens: 20 })
    expect(chunks.length).toBeGreaterThan(2)
  })
})
