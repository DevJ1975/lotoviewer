import { describe, it, expect } from 'vitest'
import {
  lookupRq,
  quantityInPounds,
  checkSpillRq,
  COMMON_RQ_LIST,
} from '@soteria/core/epaReportableQuantities'

describe('lookupRq', () => {
  it('finds by canonical name (case-insensitive)', () => {
    expect(lookupRq('ammonia')?.cas).toBe('7664-41-7')
    expect(lookupRq('AMMONIA')?.cas).toBe('7664-41-7')
  })

  it('finds by CAS number', () => {
    expect(lookupRq('7664-41-7')?.name).toBe('Ammonia')
  })

  it('finds by synonym', () => {
    expect(lookupRq('caustic soda')?.name).toBe('Sodium hydroxide')
    expect(lookupRq('lye')?.name).toBe('Sodium hydroxide')
  })

  it('falls back to substring match for canonical names', () => {
    expect(lookupRq('Anhydrous Ammonia (refrigerant)')?.name).toBe('Ammonia')
    expect(lookupRq('hydraulic fluid (5 gal drum)')?.name).toBe('Hydraulic oil')
  })

  it('returns null for unknown substances', () => {
    expect(lookupRq('aqua regia')).toBeNull()
    expect(lookupRq('  ')).toBeNull()
  })

  it('exposes a non-trivial catalog', () => {
    expect(COMMON_RQ_LIST.length).toBeGreaterThan(10)
  })
})

describe('quantityInPounds', () => {
  it('passes pounds through unchanged', () => {
    expect(quantityInPounds(50, 'lb')).toBe(50)
  })

  it('converts kg to lb', () => {
    expect(quantityInPounds(1, 'kg')).toBeCloseTo(2.2046)
    expect(quantityInPounds(10, 'kg')).toBeCloseTo(22.046)
  })

  it('converts gallons via water density (conservative)', () => {
    expect(quantityInPounds(1, 'gal')).toBeCloseTo(8.345)
  })

  it('converts litres', () => {
    expect(quantityInPounds(1, 'L')).toBeCloseTo(2.205)
  })

  it('converts cubic metres', () => {
    expect(quantityInPounds(1, 'm3')).toBeCloseTo(2204.6)
  })

  it('returns null for negative or non-finite quantities', () => {
    expect(quantityInPounds(-1, 'lb')).toBeNull()
    expect(quantityInPounds(NaN, 'lb')).toBeNull()
    expect(quantityInPounds(Infinity, 'lb')).toBeNull()
  })
})

describe('checkSpillRq', () => {
  it('returns unknown_substance when no substance entered', () => {
    const out = checkSpillRq({ substance: null, quantity: 10, quantity_unit: 'lb' })
    expect(out.kind).toBe('unknown_substance')
  })

  it('returns unknown_substance when substance not in catalog', () => {
    const out = checkSpillRq({ substance: 'aqua regia', quantity: 10, quantity_unit: 'lb' })
    expect(out.kind).toBe('unknown_substance')
  })

  it('returns unknown_quantity when substance is known but no quantity', () => {
    const out = checkSpillRq({ substance: 'Ammonia', quantity: null, quantity_unit: 'lb' })
    expect(out.kind).toBe('unknown_quantity')
    if (out.kind === 'unknown_quantity') {
      expect(out.entry.name).toBe('Ammonia')
    }
  })

  it('flags meets_rq for chlorine 20 lb (RQ 10)', () => {
    const out = checkSpillRq({ substance: 'Chlorine', quantity: 20, quantity_unit: 'lb' })
    expect(out.kind).toBe('meets_rq')
    if (out.kind === 'meets_rq') {
      expect(out.rq_lb).toBe(10)
      expect(out.quantity_lb).toBe(20)
      expect(out.message).toMatch(/National Response Center/i)
    }
  })

  it('flags below_rq for chlorine 5 lb', () => {
    const out = checkSpillRq({ substance: 'Chlorine', quantity: 5, quantity_unit: 'lb' })
    expect(out.kind).toBe('below_rq')
    if (out.kind === 'below_rq') {
      expect(out.rq_lb).toBe(10)
      expect(out.quantity_lb).toBe(5)
    }
  })

  it('handles unit conversion (50 kg ammonia ≈ 110 lb > RQ 100)', () => {
    const out = checkSpillRq({ substance: 'Ammonia', quantity: 50, quantity_unit: 'kg' })
    expect(out.kind).toBe('meets_rq')
  })

  it('flags non_cercla_petroleum for diesel sheen', () => {
    const out = checkSpillRq({ substance: 'Diesel', quantity: 1, quantity_unit: 'gal' })
    expect(out.kind).toBe('non_cercla_petroleum')
    if (out.kind === 'non_cercla_petroleum') {
      expect(out.message).toMatch(/SPCC|state/i)
    }
  })

  it('petroleum below sentinel returns below_rq (no RQ trigger)', () => {
    // 0.1 gal of hydraulic oil ≈ 0.83 lb, below the 2 lb sentinel.
    const out = checkSpillRq({ substance: 'Hydraulic oil', quantity: 0.1, quantity_unit: 'gal' })
    expect(out.kind).toBe('below_rq')
  })

  it('case-insensitive substance match', () => {
    const out = checkSpillRq({ substance: 'CHLORINE', quantity: 20, quantity_unit: 'lb' })
    expect(out.kind).toBe('meets_rq')
  })
})
