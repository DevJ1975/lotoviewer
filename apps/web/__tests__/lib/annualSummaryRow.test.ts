import { describe, expect, it } from 'vitest'
import {
  asCount,
  validateAnnualRow,
  annualSummaryUpsertRow,
  MAX_BACKFILL_YEARS,
} from '@/lib/insights/annualSummaryRow'

// The shared per-row validator + upsert-row builder used by BOTH historical
// import confirm routes (PDF single + CSV batch). These tests pin the
// boundary rules so a 300A imported either way is validated identically.

const THIS_YEAR = 2026

function fullRow(overrides: Record<string, unknown> = {}) {
  return {
    year: 2021,
    total_deaths: 0,
    total_days_away: 2,
    total_restricted: 1,
    total_other_recordable: 3,
    total_days_away_count: 40,
    total_days_restricted_count: 5,
    total_hours_worked: 100_000,
    annual_avg_employees: 50,
    ...overrides,
  }
}

describe('asCount', () => {
  it('accepts non-negative integers', () => {
    expect(asCount(0)).toBe(0)
    expect(asCount(42)).toBe(42)
    expect(asCount('7')).toBe(7)
  })

  it('rejects negatives, floats, NaN, and junk', () => {
    expect(asCount(-1)).toBeNull()
    expect(asCount(1.5)).toBeNull()
    expect(asCount('abc')).toBeNull()
    expect(asCount(NaN)).toBeNull()
    expect(asCount(undefined)).toBeNull()
  })
})

describe('validateAnnualRow', () => {
  it('accepts a complete, in-range row and builds the totals', () => {
    const result = validateAnnualRow(fullRow(), THIS_YEAR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.totals.year).toBe(2021)
      expect(result.totals.total_days_away).toBe(2)
      // Unmapped injury breakdown defaults every type to 0.
      expect(result.totals.by_injury_type.injury).toBe(0)
    }
  })

  it('rejects a year before the backfill window, naming the field', () => {
    const result = validateAnnualRow(fullRow({ year: THIS_YEAR - MAX_BACKFILL_YEARS - 1 }), THIS_YEAR)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('year must be between')
  })

  it('rejects a future year', () => {
    const result = validateAnnualRow(fullRow({ year: THIS_YEAR + 1 }), THIS_YEAR)
    expect(result.ok).toBe(false)
  })

  it('rejects a non-integer scalar and names it', () => {
    const result = validateAnnualRow(fullRow({ total_deaths: 1.5 }), THIS_YEAR)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('total_deaths')
  })

  it('prefixes the message with a label so a batch can name the year', () => {
    const result = validateAnnualRow(fullRow({ total_hours_worked: -1 }), THIS_YEAR, 'row 3')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message.startsWith('row 3:')).toBe(true)
  })

  it('defaults a missing by_injury_type breakdown to all zeros', () => {
    // The CSV flow makes the breakdown optional; an omitted by_injury_type
    // must NOT reject the row.
    const result = validateAnnualRow(fullRow(), THIS_YEAR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const v of Object.values(result.totals.by_injury_type)) expect(v).toBe(0)
    }
  })

  it('rejects a PRESENT but malformed by_injury_type entry', () => {
    const result = validateAnnualRow(
      fullRow({ by_injury_type: { injury: -2 } }),
      THIS_YEAR,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('by_injury_type.injury')
  })

  it('validates and carries a provided by_injury_type breakdown', () => {
    const result = validateAnnualRow(
      fullRow({ by_injury_type: { injury: 5, skin_disorder: 1 } }),
      THIS_YEAR,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.totals.by_injury_type.injury).toBe(5)
      expect(result.totals.by_injury_type.skin_disorder).toBe(1)
      expect(result.totals.by_injury_type.respiratory).toBe(0)
    }
  })
})

describe('annualSummaryUpsertRow', () => {
  it('maps a validated summary onto the DB column shape', () => {
    const result = validateAnnualRow(fullRow(), THIS_YEAR)
    if (!result.ok) throw new Error('fixture should validate')
    const row = annualSummaryUpsertRow({
      tenantId: 'tenant-1',
      establishmentId: 'est-1',
      totals: result.totals,
    })
    expect(row).toMatchObject({
      tenant_id: 'tenant-1',
      establishment_id: 'est-1',
      year: 2021,
      total_hours_worked: 100_000,
      annual_avg_employees: 50,
    })
    expect(row.totals_json).toBe(result.totals)
  })
})
