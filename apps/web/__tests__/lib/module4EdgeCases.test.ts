// Phase-D edge-case tests for Module 4 (Prop 65) helpers. Targets the
// boundary inputs the happy-path suite doesn't exercise.

import { describe, it, expect } from 'vitest'
import { classifyExposure, type Prop65Chemical } from '@soteria/core/prop65'
import { buildLongFormWarning, buildShortFormWarning } from '@soteria/core/prop65WarningText'
import { normalizeCasNumber } from '@soteria/core/prop65SafeHarbor'

const lead: Pick<Prop65Chemical, 'nsrl_mg_day' | 'madl_mg_day'> = {
  nsrl_mg_day: 0.015,
  madl_mg_day: 0.0005,
}

describe('classifyExposure — degenerate values', () => {
  it('Infinity daily_mg classifies as unknown (defensive — not a real exposure)', () => {
    expect(classifyExposure(Number.POSITIVE_INFINITY, lead, 'cancer')).toBe('unknown')
    expect(classifyExposure(Number.POSITIVE_INFINITY, lead, 'reproductive')).toBe('unknown')
    expect(classifyExposure(Number.POSITIVE_INFINITY, lead, 'both')).toBe('unknown')
  })

  it('daily_mg of exactly 0 clears any positive safe-harbor value', () => {
    // Zero is documented absence — should clear without ambiguity.
    expect(classifyExposure(0, lead, 'cancer')).toBe('below_safe_harbor')
    expect(classifyExposure(0, lead, 'both')).toBe('below_safe_harbor')
  })

  it('nsrl_mg_day of 0 is a degenerate "no safe harbor exists" — any positive exposure warns', () => {
    // Reading: OEHHA published 0 as the safe daily exposure → effectively no defense.
    const zeroNsrl = { nsrl_mg_day: 0, madl_mg_day: 0.001 }
    expect(classifyExposure(0.00001, zeroNsrl, 'cancer')).toBe('requires_warning')
    // 0 < 0 is false → requires warning. Documents the strict-less-than rule.
    expect(classifyExposure(0, zeroNsrl, 'cancer')).toBe('requires_warning')
  })

  it('both endpoint requires BOTH NSRL and MADL present, even if one clears', () => {
    // Fail-safe: a missing repro number can't be masked by a clearing cancer number.
    const onlyNsrl = { nsrl_mg_day: 0.5, madl_mg_day: null }
    const onlyMadl = { nsrl_mg_day: null, madl_mg_day: 0.5 }
    expect(classifyExposure(0.001, onlyNsrl, 'both')).toBe('unknown')
    expect(classifyExposure(0.001, onlyMadl, 'both')).toBe('unknown')
  })

  it('endpoint mismatch with missing value returns unknown, not requires_warning', () => {
    // Caller asks for cancer endpoint but chemical only has MADL on file —
    // we cannot decide; return unknown so the UI surfaces the ambiguity.
    const onlyMadl = { nsrl_mg_day: null, madl_mg_day: 0.0005 }
    expect(classifyExposure(0.0001, onlyMadl, 'cancer')).toBe('unknown')
  })
})

describe('buildLongFormWarning — edge inputs', () => {
  it('throws on empty chemicals array', () => {
    expect(() => buildLongFormWarning({ chemicals: [], language: 'en' })).toThrow()
  })

  it('drops whitespace-only chemical names; throws if nothing remains', () => {
    // The bucketize step filters blanks; if every name was blank we
    // end up with zero usable clauses → throw.
    expect(() => buildLongFormWarning({
      chemicals: [{ name: '   ', endpoint: 'cancer' }],
      language:  'en',
    })).toThrow()
  })

  it('a single "both"-endpoint chemical renders ONE combined clause, not two', () => {
    const text = buildLongFormWarning({
      chemicals: [{ name: 'Lead', endpoint: 'both' }],
      language:  'en',
    })
    // Must not contain a separate "cancer" line plus a separate "reproductive" line.
    expect(text).toContain('cause cancer and birth defects')
    expect(text.match(/cause cancer/g)?.length).toBe(1)
  })

  it('preserves unicode + parentheses in chemical names verbatim', () => {
    // DEHP is the canonical name with parens; Cr(VI) is a Roman-numeral
    // valence notation. Both have historically broken PDF/sign renderers
    // that strip "special" characters.
    const text = buildLongFormWarning({
      chemicals: [
        { name: 'Di(2-ethylhexyl)phthalate (DEHP)', endpoint: 'reproductive' },
        { name: 'Chromium (hexavalent compounds, Cr(VI))',  endpoint: 'cancer' },
      ],
      language: 'en',
    })
    expect(text).toContain('Di(2-ethylhexyl)phthalate (DEHP)')
    expect(text).toContain('Chromium (hexavalent compounds, Cr(VI))')
  })

  it('always includes the canonical reference URL (Cal. Code Regs §25602(a)(4))', () => {
    const en = buildLongFormWarning({ chemicals: [{ name: 'Lead', endpoint: 'cancer' }], language: 'en' })
    const es = buildLongFormWarning({ chemicals: [{ name: 'Plomo', endpoint: 'cancer' }], language: 'es' })
    expect(en).toContain('www.P65Warnings.ca.gov')
    expect(es).toContain('www.P65Warnings.ca.gov')
  })
})

describe('buildShortFormWarning — heading aggregation', () => {
  it('mixed cancer + reproductive chemicals get the combined "both" heading', () => {
    const text = buildShortFormWarning({
      chemicals: [
        { name: 'Lead',     endpoint: 'cancer' },
        { name: 'Toluene',  endpoint: 'reproductive' },
      ],
      language: 'en',
    })
    expect(text).toContain('Cancer and Reproductive Harm')
  })

  it('reproductive-only chemical list uses the reproductive-only short heading', () => {
    const text = buildShortFormWarning({
      chemicals: [{ name: 'Toluene', endpoint: 'reproductive' }],
      language: 'en',
    })
    expect(text).toContain('Reproductive Harm')
    expect(text).not.toContain('Cancer')
  })
})

describe('normalizeCasNumber — boundary input', () => {
  it('returns null for empty / whitespace input', () => {
    expect(normalizeCasNumber('')).toBeNull()
    expect(normalizeCasNumber('   ')).toBeNull()
  })

  it('preserves the canonical hyphenation; collapses internal whitespace', () => {
    // OEHHA exports vary in whitespace; we canonicalize on input.
    expect(normalizeCasNumber('  7439-92-1  ')).toBe('7439-92-1')
    expect(normalizeCasNumber('7439 - 92 - 1')).toBe('7439-92-1')
  })
})
