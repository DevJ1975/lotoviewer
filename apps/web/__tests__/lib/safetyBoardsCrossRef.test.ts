import { describe, it, expect } from 'vitest'
import { findCrossRefs, hrefForCrossRef } from '@/lib/safetyBoards/crossRef'

describe('findCrossRefs', () => {
  it('returns empty for plain text', () => {
    expect(findCrossRefs('the conveyor stopped working')).toEqual([])
  })

  it('captures a single tag with prefix + id', () => {
    const r = findCrossRefs('see #INC-0042 for context')
    expect(r).toHaveLength(1)
    expect(r[0].prefix).toBe('INC')
    expect(r[0].id).toBe('0042')
  })

  it('captures multiple tags + uppercases the prefix', () => {
    const r = findCrossRefs('linked #eq-A12 and #inc-123')
    expect(r.map(m => m.prefix)).toEqual(['EQ', 'INC'])
  })

  it('does not consume trailing punctuation', () => {
    const r = findCrossRefs('look at #INC-9.')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('9')
    expect(r[0].start).toBe(8)
    expect(r[0].end).toBe(14)  // '#INC-9' is positions 8-13, end exclusive
  })

  it('skips obvious non-tags', () => {
    expect(findCrossRefs('email me at user#example.com')).toEqual([])
    expect(findCrossRefs('#TOOLONG-12 has 7-char prefix')).toEqual([])
  })
})

describe('hrefForCrossRef', () => {
  it('routes known prefixes to their detail pages', () => {
    expect(hrefForCrossRef({ prefix: 'INC',  id: '42', start: 0, end: 0 })).toBe('/incidents/42')
    expect(hrefForCrossRef({ prefix: 'EQ',   id: 'M1', start: 0, end: 0 })).toBe('/equipment/M1')
    expect(hrefForCrossRef({ prefix: 'NM',   id: 'X',  start: 0, end: 0 })).toBe('/near-miss/X')
    expect(hrefForCrossRef({ prefix: 'HW',   id: 'p1', start: 0, end: 0 })).toBe('/hot-work/p1')
    expect(hrefForCrossRef({ prefix: 'CS',   id: 's1', start: 0, end: 0 })).toBe('/confined-spaces/s1')
    expect(hrefForCrossRef({ prefix: 'JHA',  id: 'j1', start: 0, end: 0 })).toBe('/jha/j1')
    expect(hrefForCrossRef({ prefix: 'TBT',  id: 't1', start: 0, end: 0 })).toBe('/toolbox-talks/t1')
  })

  it('returns null for prefixes that have no detail page (CAPA inline)', () => {
    expect(hrefForCrossRef({ prefix: 'ACT',  id: '7',  start: 0, end: 0 })).toBeNull()
    expect(hrefForCrossRef({ prefix: 'CAPA', id: '7',  start: 0, end: 0 })).toBeNull()
  })

  it('returns null for unknown prefixes', () => {
    expect(hrefForCrossRef({ prefix: 'FOO',  id: 'x',  start: 0, end: 0 })).toBeNull()
  })
})
