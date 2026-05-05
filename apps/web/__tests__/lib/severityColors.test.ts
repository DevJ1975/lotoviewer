import { describe, it, expect } from 'vitest'
import {
  SEVERITY_HEX,
  SEVERITY_FG_HEX,
  SEVERITY_TW,
  SEVERITY_TW_BORDER,
  SEVERITY_RANK,
  type SeverityKey,
} from '@soteria/core/severityColors'

// The shared severity-color tokens are consumed by 14 surfaces
// (6 web + 8 mobile). These tests pin the contract so a
// well-meaning refactor of the palette can't silently desync.

const KEYS: SeverityKey[] = ['low', 'moderate', 'high', 'extreme']

describe('SEVERITY_HEX', () => {
  it('has an entry for every band', () => {
    for (const k of KEYS) expect(SEVERITY_HEX[k]).toBeDefined()
  })

  it('uses 6-char hex notation', () => {
    for (const k of KEYS) expect(SEVERITY_HEX[k]).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('matches Tailwind palette values', () => {
    // If these change, every consumer's visual gets the new color
    // automatically — but the test's purpose is to flag the change
    // explicitly so a designer reviews it before merge.
    expect(SEVERITY_HEX.extreme).toBe('#DC2626')   // rose-600
    expect(SEVERITY_HEX.high).toBe('#F97316')      // orange-500
    expect(SEVERITY_HEX.moderate).toBe('#FBBF24')  // amber-400
    expect(SEVERITY_HEX.low).toBe('#10B981')       // emerald-500
  })

  it('does not collide between bands', () => {
    const seen = new Set<string>()
    for (const k of KEYS) {
      expect(seen.has(SEVERITY_HEX[k])).toBe(false)
      seen.add(SEVERITY_HEX[k])
    }
  })
})

describe('SEVERITY_FG_HEX', () => {
  it('has an entry for every band', () => {
    for (const k of KEYS) expect(SEVERITY_FG_HEX[k]).toBeDefined()
  })

  it('uses dark text on amber-400 (WCAG AA contrast)', () => {
    // amber-400 + white fails 4.5:1; we use slate-900 instead.
    expect(SEVERITY_FG_HEX.moderate).toBe('#0F172A')
  })

  it('uses white text on every other band', () => {
    expect(SEVERITY_FG_HEX.extreme).toBe('#FFFFFF')
    expect(SEVERITY_FG_HEX.high).toBe('#FFFFFF')
    expect(SEVERITY_FG_HEX.low).toBe('#FFFFFF')
  })
})

describe('SEVERITY_TW', () => {
  it('has an entry for every band', () => {
    for (const k of KEYS) expect(SEVERITY_TW[k]).toBeDefined()
  })

  it('combines bg and text classes in one string', () => {
    for (const k of KEYS) {
      expect(SEVERITY_TW[k]).toMatch(/\bbg-/)
      expect(SEVERITY_TW[k]).toMatch(/\btext-/)
    }
  })

  it('uses dark text on amber (matching FG_HEX contract)', () => {
    expect(SEVERITY_TW.moderate).toContain('text-slate-900')
    expect(SEVERITY_TW.extreme).toContain('text-white')
  })
})

describe('SEVERITY_TW_BORDER', () => {
  it('has an entry for every band', () => {
    for (const k of KEYS) expect(SEVERITY_TW_BORDER[k]).toBeDefined()
  })

  it('combines border and text classes', () => {
    for (const k of KEYS) {
      expect(SEVERITY_TW_BORDER[k]).toMatch(/\bborder-/)
      expect(SEVERITY_TW_BORDER[k]).toMatch(/\btext-/)
    }
  })
})

describe('SEVERITY_RANK', () => {
  it('places extreme first, low last', () => {
    expect(SEVERITY_RANK.extreme).toBeLessThan(SEVERITY_RANK.high)
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.moderate)
    expect(SEVERITY_RANK.moderate).toBeLessThan(SEVERITY_RANK.low)
  })

  it('produces a stable triage sort when fed compareForTriage-style sort', () => {
    const items: SeverityKey[] = ['low', 'extreme', 'moderate', 'high']
    items.sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])
    expect(items).toEqual(['extreme', 'high', 'moderate', 'low'])
  })

  it('has 0..3 contiguous values (no gaps)', () => {
    const values = KEYS.map(k => SEVERITY_RANK[k]).sort((a, b) => a - b)
    expect(values).toEqual([0, 1, 2, 3])
  })
})
