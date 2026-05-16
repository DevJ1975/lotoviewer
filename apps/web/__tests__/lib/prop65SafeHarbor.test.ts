import { describe, it, expect } from 'vitest'
import {
  PROP65_SAFE_HARBOR,
  findByCasNumber,
  findMatchingSafeHarbor,
  normalizeCasNumber,
} from '@soteria/core/prop65SafeHarbor'

describe('PROP65_SAFE_HARBOR seed', () => {
  it('contains the 20 entries the spec calls for', () => {
    expect(PROP65_SAFE_HARBOR.length).toBe(20)
  })

  it('has no duplicate CAS numbers', () => {
    const cases = new Set<string>()
    for (const e of PROP65_SAFE_HARBOR) cases.add(e.cas_number)
    expect(cases.size).toBe(PROP65_SAFE_HARBOR.length)
  })

  it('every cancer-only entry has nsrl populated', () => {
    for (const e of PROP65_SAFE_HARBOR) {
      if (e.harm_endpoint === 'cancer' && e.chemical_name !== 'Asbestos') {
        expect(e.nsrl_mg_day).not.toBeNull()
      }
    }
  })

  it('every reproductive-only entry has madl populated', () => {
    for (const e of PROP65_SAFE_HARBOR) {
      if (e.harm_endpoint === 'reproductive') {
        expect(e.madl_mg_day).not.toBeNull()
      }
    }
  })
})

describe('normalizeCasNumber', () => {
  it('returns the input unchanged when already canonical', () => {
    expect(normalizeCasNumber('7439-92-1')).toBe('7439-92-1')
  })

  it('reformats dashless input', () => {
    expect(normalizeCasNumber('7439921')).toBe('7439-92-1')
  })

  it('strips leading zeros in the head group', () => {
    expect(normalizeCasNumber('07439-92-1')).toBe('7439-92-1')
    expect(normalizeCasNumber('0050-00-0')).toBe('50-00-0')
  })

  it('tolerates leading/trailing whitespace', () => {
    expect(normalizeCasNumber('  71-43-2  ')).toBe('71-43-2')
  })

  it('rejects gibberish', () => {
    expect(normalizeCasNumber('not-a-cas')).toBe(null)
    expect(normalizeCasNumber('')).toBe(null)
    expect(normalizeCasNumber(null)).toBe(null)
    expect(normalizeCasNumber(undefined)).toBe(null)
  })

  it('rejects CAS with too-short head group', () => {
    // After stripping the trailing 3 digits (check + mid), head must be ≥ 2.
    expect(normalizeCasNumber('5-00-0')).toBe(null)
  })
})

describe('findByCasNumber', () => {
  it('finds lead by canonical CAS', () => {
    const hit = findByCasNumber('7439-92-1')
    expect(hit?.chemical_name).toBe('Lead')
  })

  it('finds lead by dashless variant', () => {
    expect(findByCasNumber('7439921')?.chemical_name).toBe('Lead')
  })

  it('returns null for an unseeded CAS', () => {
    expect(findByCasNumber('999-99-9')).toBe(null)
  })

  it('returns null on bogus input', () => {
    expect(findByCasNumber('abc')).toBe(null)
  })

  it('handles the parenthesized chemical name without confusion', () => {
    // DEHP CAS — verifies our seed for the parens-heavy entry resolves.
    expect(findByCasNumber('117-81-7')?.chemical_name)
      .toBe('Di(2-ethylhexyl)phthalate (DEHP)')
  })
})

describe('findMatchingSafeHarbor', () => {
  it('returns every match for a multi-CAS product', () => {
    const matches = findMatchingSafeHarbor(['71-43-2', '100-42-5', 'no-such-thing'])
    expect(matches.map(m => m.chemical_name).sort())
      .toEqual(['Benzene', 'Styrene'])
  })

  it('deduplicates when the same CAS appears twice', () => {
    const matches = findMatchingSafeHarbor(['71-43-2', '71-43-2'])
    expect(matches.length).toBe(1)
  })

  it('returns an empty array when nothing matches', () => {
    expect(findMatchingSafeHarbor(['999-99-9', null, undefined])).toEqual([])
  })
})
