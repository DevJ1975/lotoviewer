import { describe, it, expect } from 'vitest'
import {
  computeSeverityDistribution,
  selectActive,
  countReportedSince,
  countAging,
  computeTopUnresolved,
  type NearMissRowForMetrics,
} from '@soteria/core/nearMissMetrics'
import type { NearMissSeverity, NearMissStatus } from '@soteria/core/nearMiss'

// Pure-logic tests for the dashboard aggregator. Mirrors the
// riskMetrics test pattern: build a fixture set of rows + assert
// each helper handles edge cases (empty input, all-active,
// all-closed, mixed).

function row(over: Partial<NearMissRowForMetrics> = {}): NearMissRowForMetrics {
  return {
    id:                 'r-1',
    report_number:      'NM-2026-0001',
    description:        'something almost happened',
    status:             'new' as NearMissStatus,
    severity_potential: 'moderate' as NearMissSeverity,
    reported_at:        '2026-04-01T00:00:00Z',
    resolved_at:        null,
    ...over,
  }
}

describe('selectActive', () => {
  it('keeps new / triaged / investigating', () => {
    const rows = [
      row({ id: 'a', status: 'new' }),
      row({ id: 'b', status: 'triaged' }),
      row({ id: 'c', status: 'investigating' }),
      row({ id: 'd', status: 'closed' }),
      row({ id: 'e', status: 'escalated_to_risk' }),
    ]
    expect(selectActive(rows).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('computeSeverityDistribution', () => {
  it('counts active rows by severity', () => {
    const rows = [
      row({ id: '1', severity_potential: 'low' }),
      row({ id: '2', severity_potential: 'low' }),
      row({ id: '3', severity_potential: 'high' }),
      row({ id: '4', severity_potential: 'extreme' }),
    ]
    expect(computeSeverityDistribution(rows)).toEqual({
      low: 2, moderate: 0, high: 1, extreme: 1,
    })
  })

  it('returns zero counts for empty input', () => {
    expect(computeSeverityDistribution([])).toEqual({
      low: 0, moderate: 0, high: 0, extreme: 0,
    })
  })
})

describe('countReportedSince', () => {
  const now = new Date('2026-05-01T00:00:00Z')

  it('counts rows reported within the window regardless of status', () => {
    const rows = [
      row({ id: '1', reported_at: '2026-04-25T00:00:00Z' }),                              // 6d ago — in
      row({ id: '2', reported_at: '2026-03-25T00:00:00Z' }),                              // 37d ago — out
      row({ id: '3', reported_at: '2026-04-15T00:00:00Z', status: 'closed' }),            // 16d ago, closed — still counts
      row({ id: '4', reported_at: '2026-04-30T23:00:00Z' }),                              // 1h ago — in
    ]
    expect(countReportedSince(rows, 30, now)).toBe(3)
  })
})

describe('countAging', () => {
  const now = new Date('2026-05-01T00:00:00Z')

  it('counts ONLY active rows older than the window', () => {
    const rows = [
      row({ id: '1', reported_at: '2026-03-15T00:00:00Z', status: 'new' }),               // 47d, active — in
      row({ id: '2', reported_at: '2026-03-15T00:00:00Z', status: 'closed' }),            // 47d, closed — out
      row({ id: '3', reported_at: '2026-04-15T00:00:00Z', status: 'investigating' }),     // 16d, active — out (within window)
      row({ id: '4', reported_at: '2026-02-01T00:00:00Z', status: 'triaged' }),           // 89d, active — in
    ]
    expect(countAging(rows, 30, now)).toBe(2)
  })
})

describe('computeTopUnresolved', () => {
  it('sorts by severity desc, then oldest first, and slices to N', () => {
    const rows = [
      row({ id: 'a', severity_potential: 'low',      status: 'new', reported_at: '2026-04-01T00:00:00Z' }),
      row({ id: 'b', severity_potential: 'extreme',  status: 'triaged', reported_at: '2026-04-10T00:00:00Z' }),
      row({ id: 'c', severity_potential: 'high',     status: 'investigating', reported_at: '2026-04-05T00:00:00Z' }),
      row({ id: 'd', severity_potential: 'moderate', status: 'new', reported_at: '2026-04-07T00:00:00Z' }),
      row({ id: 'e', severity_potential: 'extreme',  status: 'new', reported_at: '2026-04-12T00:00:00Z' }),
      // closed should be excluded
      row({ id: 'f', severity_potential: 'extreme',  status: 'closed', reported_at: '2026-03-01T00:00:00Z' }),
    ]
    const top = computeTopUnresolved(rows, 3).map(r => r.id)
    // b (extreme, 04-10) before e (extreme, 04-12); then c (high)
    expect(top).toEqual(['b', 'e', 'c'])
  })

  it('returns empty array when nothing is active', () => {
    const rows = [
      row({ id: '1', status: 'closed' }),
      row({ id: '2', status: 'escalated_to_risk' }),
    ]
    expect(computeTopUnresolved(rows, 5)).toEqual([])
  })
})
