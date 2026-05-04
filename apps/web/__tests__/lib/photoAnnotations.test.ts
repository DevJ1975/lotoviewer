import { describe, it, expect } from 'vitest'
import { parseAnnotations, clampUnit } from '@/lib/photoAnnotations'

describe('parseAnnotations', () => {
  it('returns an empty array for non-array input — defensive against schema drift', () => {
    expect(parseAnnotations(null)).toEqual([])
    expect(parseAnnotations(undefined)).toEqual([])
    expect(parseAnnotations({})).toEqual([])
    expect(parseAnnotations('[]')).toEqual([])
  })

  it('keeps valid arrow shapes', () => {
    const raw = [{ type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, label: 'Disconnect' }]
    expect(parseAnnotations(raw)).toEqual(raw)
  })

  it('keeps valid label shapes', () => {
    const raw = [{ type: 'label', x: 0.5, y: 0.5, text: 'V-202' }]
    expect(parseAnnotations(raw)).toEqual(raw)
  })

  it('drops arrows with out-of-range coordinates — dirty data must not crash render', () => {
    const raw = [{ type: 'arrow', x1: 1.5, y1: 0.2, x2: 0.5, y2: 0.6 }]
    expect(parseAnnotations(raw)).toEqual([])
  })

  it('drops labels with empty text — they would render as a dangling point', () => {
    expect(parseAnnotations([{ type: 'label', x: 0.5, y: 0.5, text: '' }])).toEqual([])
    expect(parseAnnotations([{ type: 'label', x: 0.5, y: 0.5, text: '   ' }])).toEqual([])
  })

  it('drops unknown shape types instead of crashing the renderer', () => {
    expect(parseAnnotations([{ type: 'spaceship', x: 0.5, y: 0.5 }])).toEqual([])
  })

  it('preserves the order of valid shapes and skips invalid ones in-place', () => {
    const raw = [
      { type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 },
      { type: 'arrow', x1: 5,   y1: 0.2, x2: 0.5, y2: 0.6 },  // x1 out of range
      { type: 'label', x: 0.7, y: 0.8, text: 'Ground' },
    ]
    const out = parseAnnotations(raw)
    expect(out).toHaveLength(2)
    expect(out[0].type).toBe('arrow')
    expect(out[1].type).toBe('label')
  })

  it('drops items that are null or non-objects without throwing', () => {
    expect(parseAnnotations([null, 0, 'string', true])).toEqual([])
  })
})

describe('clampUnit', () => {
  it('passes through values inside [0, 1]', () => {
    expect(clampUnit(0)).toBe(0)
    expect(clampUnit(0.5)).toBe(0.5)
    expect(clampUnit(1)).toBe(1)
  })

  it('clamps below 0 and above 1', () => {
    expect(clampUnit(-0.2)).toBe(0)
    expect(clampUnit(1.7)).toBe(1)
  })

  it('returns 0 for NaN — fail-closed if a touch event produces garbage', () => {
    expect(clampUnit(Number.NaN)).toBe(0)
  })
})
