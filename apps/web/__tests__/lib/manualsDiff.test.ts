import { describe, it, expect } from 'vitest'
import { diffWords, tokenize } from '@/lib/manuals/diff'

function reconstruct(diff: ReturnType<typeof diffWords>): { before: string; after: string } {
  return {
    before: diff.filter(d => d.op !== 'insert').map(d => d.text).join(''),
    after:  diff.filter(d => d.op !== 'delete').map(d => d.text).join(''),
  }
}

describe('tokenize', () => {
  it('preserves whitespace + punctuation as separate tokens', () => {
    const t = tokenize('Hello, world!')
    expect(t.join('')).toBe('Hello, world!')
    expect(t.length).toBe(5)
  })
})

describe('diffWords', () => {
  it('returns a single equal segment when inputs match', () => {
    const d = diffWords('abc def', 'abc def')
    expect(d).toEqual([{ op: 'equal', text: 'abc def' }])
  })

  it('reports a pure insert', () => {
    const d = diffWords('abc', 'abc def')
    expect(d.map(s => s.op)).toEqual(['equal', 'insert'])
    expect(reconstruct(d).before).toBe('abc')
    expect(reconstruct(d).after).toBe('abc def')
  })

  it('reports a pure delete', () => {
    const d = diffWords('abc def', 'abc')
    expect(d.map(s => s.op)).toEqual(['equal', 'delete'])
    expect(reconstruct(d).before).toBe('abc def')
    expect(reconstruct(d).after).toBe('abc')
  })

  it('handles a word replacement (delete + insert) with shared prefix/suffix', () => {
    const d = diffWords('the quick brown fox', 'the quick green fox')
    expect(reconstruct(d).before).toBe('the quick brown fox')
    expect(reconstruct(d).after).toBe('the quick green fox')
    // The middle word is changed; the surrounding words stay equal.
    const ops = d.map(s => s.op)
    expect(ops).toContain('delete')
    expect(ops).toContain('insert')
    expect(ops.filter(o => o === 'equal').length).toBeGreaterThan(0)
  })

  it('reconstructs faithfully on multi-line edits', () => {
    const before = 'Step 1\nStep 2\nStep 3\n'
    const after  = 'Step 1\nStep two — updated\nStep 3\n'
    const d = diffWords(before, after)
    expect(reconstruct(d).before).toBe(before)
    expect(reconstruct(d).after).toBe(after)
  })
})
