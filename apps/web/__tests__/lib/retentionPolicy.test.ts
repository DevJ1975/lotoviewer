import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RETENTION_POLICY,
  daysUntilEligibleForPurge,
  shouldRetain,
  type RetentionPolicy,
  type RetentionRecord,
} from '@soteria/core/retentionPolicy'

// All tests anchor on a fixed "now" so they are deterministic across
// runs. The defaults match the migration: 5y incident, 3y permit /
// training, 7y LOTO artifact.

const NOW = new Date('2026-05-15T00:00:00Z')

function daysAgoIso(days: number, base: Date = NOW): string {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('shouldRetain', () => {
  it('retains a fresh incident', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(30),
    }
    expect(shouldRetain(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(true)
  })

  it('purges an incident past its 5-year window with no hold', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(1826),                    // 1 day past 5y
    }
    expect(shouldRetain(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(false)
  })

  it('retains a record under active legal hold regardless of age', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(10000),                   // ancient
      legal_hold_id: '00000000-0000-0000-0000-000000000000',
    }
    expect(shouldRetain(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(true)
  })

  it('purges once the legal hold is released (legal_hold_id null)', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(1826),
      legal_hold_id: null,
    }
    expect(shouldRetain(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(false)
  })

  it('retains LOTO artifact within 7 years (uses years × 365 conversion)', () => {
    const rec: RetentionRecord = {
      type:       'loto_artifact',
      // 6 years, 364 days — still inside the 7-year window
      created_at: daysAgoIso(6 * 365 + 364),
    }
    expect(shouldRetain(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(true)
  })

  it('purges LOTO artifact past 7 years', () => {
    const rec: RetentionRecord = {
      type:       'loto_artifact',
      created_at: daysAgoIso(7 * 365 + 1),
    }
    expect(shouldRetain(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(false)
  })

  it('retains on unparseable created_at (fail-safe)', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: 'not-a-date',
    }
    expect(shouldRetain(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(true)
  })

  it('respects a custom permit policy override', () => {
    const tightPolicy: RetentionPolicy = {
      ...DEFAULT_RETENTION_POLICY,
      permit_retention_days: 365,                      // 1 year
    }
    const rec: RetentionRecord = {
      type:       'permit',
      created_at: daysAgoIso(366),
    }
    expect(shouldRetain(rec, tightPolicy, NOW)).toBe(false)
  })
})

describe('daysUntilEligibleForPurge', () => {
  it('returns a positive count for a record still in its window', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(100),
    }
    const remaining = daysUntilEligibleForPurge(rec, DEFAULT_RETENTION_POLICY, NOW)
    expect(remaining).toBe(1725)                       // 1825 − 100
  })

  it('returns 0 on the eligibility boundary', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(1825),                    // exactly 5 years
    }
    const remaining = daysUntilEligibleForPurge(rec, DEFAULT_RETENTION_POLICY, NOW)
    expect(remaining).toBe(0)
  })

  it('returns negative when the record is past its window', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(2000),
    }
    const remaining = daysUntilEligibleForPurge(rec, DEFAULT_RETENTION_POLICY, NOW)
    expect(remaining).toBeLessThan(0)
    expect(remaining).toBe(-175)                       // 1825 − 2000
  })

  it('returns Infinity for records under legal hold', () => {
    const rec: RetentionRecord = {
      type:       'incident',
      created_at: daysAgoIso(2000),
      legal_hold_id: 'aa',
    }
    expect(daysUntilEligibleForPurge(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(Infinity)
  })

  it('returns Infinity on unparseable created_at (fail-safe)', () => {
    const rec: RetentionRecord = {
      type:       'permit',
      created_at: '',
    }
    expect(daysUntilEligibleForPurge(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(Infinity)
  })

  it('classifies training records on the 3-year boundary', () => {
    const rec: RetentionRecord = {
      type:       'training',
      created_at: daysAgoIso(1095),
    }
    expect(daysUntilEligibleForPurge(rec, DEFAULT_RETENTION_POLICY, NOW)).toBe(0)
  })
})

describe('DEFAULT_RETENTION_POLICY', () => {
  it('matches the migration defaults (sanity check)', () => {
    expect(DEFAULT_RETENTION_POLICY).toEqual({
      incident_retention_days:       1825,
      permit_retention_days:         1095,
      training_retention_days:       1095,
      loto_artifact_retention_years:    7,
    })
  })

  it('is frozen (illegal-states-unrepresentable bit of belt-and-braces)', () => {
    expect(Object.isFrozen(DEFAULT_RETENTION_POLICY)).toBe(true)
  })
})
