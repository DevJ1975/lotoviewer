import { describe, it, expect } from 'vitest'
import {
  computeSpaceFailureRows,
  computeAnomalies,
  computeSupervisorRows,
  MIN_BASELINE_SAMPLES,
  MIN_FAIL_RANK_TESTS,
} from '@/lib/insightsMetrics'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
} from '@/lib/types'

// Each test feeds the pure summarizers fixtures; we never touch supabase.
// Date math is anchored to a fixed nowMs so tests stay deterministic
// when re-run on different days.

const NOW_MS = new Date('2026-04-30T12:00:00Z').getTime()
const DAY_MS = 24 * 60 * 60 * 1000

function makeSpace(overrides: Partial<ConfinedSpace> = {}): ConfinedSpace {
  return {
    space_id:               'TANK-A',
    description:            'Storage tank A',
    department:             'Operations',
    classification:         'permit_required',
    space_type:             'tank',
    entry_dimensions:       null,
    known_hazards:          [],
    acceptable_conditions:  null,
    isolation_required:     null,
    equip_photo_url:        null,
    interior_photo_url:     null,
    internal_notes:         null,
    decommissioned:         false,
    created_at:             '2025-01-01T00:00:00Z',
    updated_at:             '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makePermit(overrides: Partial<ConfinedSpacePermit> = {}): ConfinedSpacePermit {
  return {
    id:                              'csp-1',
    serial:                          'CSP-1',
    space_id:                        'TANK-A',
    purpose:                         'inspection',
    started_at:                      new Date(NOW_MS - 2 * DAY_MS).toISOString(),
    expires_at:                      new Date(NOW_MS - 2 * DAY_MS + 8 * 60 * 60_000).toISOString(),
    canceled_at:                     null,
    entry_supervisor_id:             'sup-1',
    entry_supervisor_signature_at:   new Date(NOW_MS - 2 * DAY_MS + 5 * 60_000).toISOString(),
    attendants:                      [],
    entrants:                        [],
    hazards_present:                 [],
    isolation_measures:              [],
    acceptable_conditions_override:  null,
    rescue_service:                  { name: 'On-call' },
    communication_method:            null,
    equipment_list:                  [],
    concurrent_permits:              null,
    notes:                           null,
    cancel_reason:                   null,
    cancel_notes:                    null,
    attendant_signature_at:          null,
    attendant_signature_name:        null,
    entrant_acknowledgement_at:      null,
    work_order_ref:                  null,
    signon_token:                    null,
    created_at:                      new Date(NOW_MS - 2 * DAY_MS).toISOString(),
    updated_at:                      new Date(NOW_MS - 2 * DAY_MS).toISOString(),
    ...overrides,
  }
}

function makeTest(overrides: Partial<AtmosphericTest> = {}): AtmosphericTest {
  return {
    id:              't-' + Math.random().toString(36).slice(2),
    permit_id:       'csp-1',
    tested_at:       new Date(NOW_MS - 1 * DAY_MS).toISOString(),
    tested_by:       'sup-1',
    o2_pct:          20.9,
    lel_pct:         0,
    h2s_ppm:         0,
    co_ppm:          0,
    other_readings:  [],
    instrument_id:   'meter-1',
    kind:            'periodic',
    notes:           null,
    created_at:      new Date(NOW_MS - 1 * DAY_MS).toISOString(),
    ...overrides,
  }
}

// ── computeSpaceFailureRows ──────────────────────────────────────────────

describe('computeSpaceFailureRows', () => {
  it('returns empty when no spaces have enough tests', () => {
    const rows = computeSpaceFailureRows({
      tests:      [makeTest()],
      permits:    [makePermit()],
      spaces:     [makeSpace()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(rows).toHaveLength(0)
  })

  it('includes a space once it crosses MIN_FAIL_RANK_TESTS', () => {
    const tests = Array.from({ length: MIN_FAIL_RANK_TESTS }, (_, i) =>
      makeTest({ id: `t-${i}`, tested_at: new Date(NOW_MS - (i + 1) * 60_000).toISOString() }))
    const rows = computeSpaceFailureRows({
      tests,
      permits:    [makePermit()],
      spaces:     [makeSpace()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].space_id).toBe('TANK-A')
    expect(rows[0].totalTests).toBe(MIN_FAIL_RANK_TESTS)
    expect(rows[0].failCount).toBe(0)
    expect(rows[0].failRatePct).toBe(0)
  })

  it('counts a failing reading (LEL > 10%) as failCount', () => {
    // Mix of pass + fail readings on the same space.
    const tests = [
      ...Array.from({ length: 4 }, (_, i) => makeTest({ id: `pass-${i}`, lel_pct: 0 })),
      ...Array.from({ length: 2 }, (_, i) => makeTest({ id: `fail-${i}`, lel_pct: 25 })),
    ]
    const rows = computeSpaceFailureRows({
      tests,
      permits:    [makePermit()],
      spaces:     [makeSpace()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].totalTests).toBe(6)
    expect(rows[0].failCount).toBe(2)
    expect(rows[0].failRatePct).toBe(33)
  })

  it('sorts spaces by failRatePct desc', () => {
    // Two spaces — TANK-B has 50% fail rate, TANK-A has 20%.
    const tests = [
      // TANK-A: 5 pass, 0 fail (20% will be set up below)
      ...Array.from({ length: 4 }, (_, i) =>
        makeTest({ id: `a-pass-${i}`, permit_id: 'csp-1' })),
      makeTest({ id: 'a-fail',  permit_id: 'csp-1', lel_pct: 25 }),
      // TANK-B: 2 pass, 2 fail
      ...Array.from({ length: 3 }, (_, i) =>
        makeTest({ id: `b-pass-${i}`, permit_id: 'csp-2' })),
      makeTest({ id: 'b-fail-1', permit_id: 'csp-2', lel_pct: 30 }),
      makeTest({ id: 'b-fail-2', permit_id: 'csp-2', lel_pct: 30 }),
      makeTest({ id: 'b-fail-3', permit_id: 'csp-2', lel_pct: 30 }),
    ]
    const permits = [
      makePermit({ id: 'csp-1', space_id: 'TANK-A' }),
      makePermit({ id: 'csp-2', space_id: 'TANK-B' }),
    ]
    const spaces = [
      makeSpace({ space_id: 'TANK-A' }),
      makeSpace({ space_id: 'TANK-B' }),
    ]
    const rows = computeSpaceFailureRows({
      tests, permits, spaces, windowDays: 30, nowMs: NOW_MS,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].space_id).toBe('TANK-B')   // worst first
    expect(rows[1].space_id).toBe('TANK-A')
  })

  it('excludes tests outside the window', () => {
    const stale = makeTest({
      tested_at: new Date(NOW_MS - 100 * DAY_MS).toISOString(),
    })
    const inWindow = Array.from({ length: MIN_FAIL_RANK_TESTS }, (_, i) =>
      makeTest({ id: `t-${i}`, tested_at: new Date(NOW_MS - 1 * DAY_MS).toISOString() }))
    const rows = computeSpaceFailureRows({
      tests:      [stale, ...inWindow],
      permits:    [makePermit()],
      spaces:     [makeSpace()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(rows[0].totalTests).toBe(MIN_FAIL_RANK_TESTS)
  })
})

// ── computeAnomalies ─────────────────────────────────────────────────────

describe('computeAnomalies', () => {
  it('returns nothing when baseline has fewer than MIN_BASELINE_SAMPLES', () => {
    const tests = Array.from({ length: MIN_BASELINE_SAMPLES - 1 }, (_, i) =>
      makeTest({ id: `t-${i}`, o2_pct: 20.9 }))
    const out = computeAnomalies({
      tests,
      permits:    [makePermit()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(out).toHaveLength(0)
  })

  it('flags a reading > 3σ from the per-space mean as severity=high', () => {
    // Baseline: 8 readings clustered at 20.9. Anomaly: a reading at 18.0 —
    // that's much more than 3σ from the mean given a tight distribution.
    const baseline = Array.from({ length: 8 }, (_, i) => makeTest({
      id: `base-${i}`,
      // Tiny jitter so stdev is non-zero (the path is "constant baseline
      // → no z-score" otherwise).
      o2_pct: 20.9 + (i % 2 === 0 ? 0.05 : -0.05),
      tested_at: new Date(NOW_MS - 90 * DAY_MS - i * DAY_MS).toISOString(),
    }))
    const recent = makeTest({
      id: 'recent',
      o2_pct: 18.0,
      tested_at: new Date(NOW_MS - 1 * DAY_MS).toISOString(),
    })
    const out = computeAnomalies({
      tests:      [...baseline, recent],
      permits:    [makePermit()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    // Only the recent reading is in the window → exactly one anomaly.
    expect(out).toHaveLength(1)
    expect(out[0].testId).toBe('recent')
    expect(out[0].channel).toBe('o2')
    expect(out[0].severity).toBe('high')
    expect(out[0].zScore).toBeLessThan(-3)
  })

  it('flags 2σ ≤ |z| < 3σ as severity=moderate', () => {
    const baseline = Array.from({ length: 16 }, (_, i) => makeTest({
      id: `base-${i}`,
      // Wider spread → larger stdev → 2-3σ anomaly band lands further
      // from the mean.
      o2_pct: 20.9 + (i % 4 - 1.5) * 0.1,
      tested_at: new Date(NOW_MS - 100 * DAY_MS - i * DAY_MS).toISOString(),
    }))
    const recent = makeTest({
      id: 'recent',
      // ~2.3σ below mean given the spread above.
      o2_pct: 20.6,
      tested_at: new Date(NOW_MS - 1 * DAY_MS).toISOString(),
    })
    const out = computeAnomalies({
      tests:      [...baseline, recent],
      permits:    [makePermit()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    const a = out.find(r => r.testId === 'recent')
    expect(a).toBeDefined()
    expect(a!.severity).toBe('moderate')
    expect(Math.abs(a!.zScore!)).toBeGreaterThanOrEqual(2)
    expect(Math.abs(a!.zScore!)).toBeLessThan(3)
  })

  it('does NOT flag readings within 2σ of the mean', () => {
    const baseline = Array.from({ length: 16 }, (_, i) => makeTest({
      id: `base-${i}`,
      o2_pct: 20.9 + (i % 2 === 0 ? 0.1 : -0.1),
      tested_at: new Date(NOW_MS - 100 * DAY_MS - i * DAY_MS).toISOString(),
    }))
    const recent = makeTest({
      id: 'recent',
      o2_pct: 20.95,    // within 1σ
      tested_at: new Date(NOW_MS - 1 * DAY_MS).toISOString(),
    })
    const out = computeAnomalies({
      tests:      [...baseline, recent],
      permits:    [makePermit()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(out.find(r => r.testId === 'recent')).toBeUndefined()
  })

  it('skips channels where the baseline stdev is zero', () => {
    // All historical readings exactly identical → stdev 0 → no anomaly
    // detection (a real reading at any value would be ±∞ z, useless).
    const baseline = Array.from({ length: 10 }, (_, i) => makeTest({
      id: `base-${i}`,
      o2_pct: 20.9,
      lel_pct: 0,
      tested_at: new Date(NOW_MS - 100 * DAY_MS - i * DAY_MS).toISOString(),
    }))
    const recent = makeTest({
      id: 'recent',
      o2_pct: 18.0,    // would be flagged if stdev > 0
      lel_pct: 0,
      tested_at: new Date(NOW_MS - 1 * DAY_MS).toISOString(),
    })
    const out = computeAnomalies({
      tests:      [...baseline, recent],
      permits:    [makePermit()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(out).toHaveLength(0)
  })

  it('newest-first ordering', () => {
    const baseline = Array.from({ length: 10 }, (_, i) => makeTest({
      id: `base-${i}`,
      o2_pct: 20.9 + (i % 2 === 0 ? 0.05 : -0.05),
      tested_at: new Date(NOW_MS - 100 * DAY_MS - i * DAY_MS).toISOString(),
    }))
    const older = makeTest({
      id: 'older',
      o2_pct: 18.0,
      tested_at: new Date(NOW_MS - 5 * DAY_MS).toISOString(),
    })
    const newer = makeTest({
      id: 'newer',
      o2_pct: 18.0,
      tested_at: new Date(NOW_MS - 1 * DAY_MS).toISOString(),
    })
    const out = computeAnomalies({
      tests:      [...baseline, older, newer],
      permits:    [makePermit()],
      windowDays: 30,
      nowMs:      NOW_MS,
    })
    expect(out[0].testId).toBe('newer')
    expect(out[1].testId).toBe('older')
  })
})

// ── computeSupervisorRows ────────────────────────────────────────────────

describe('computeSupervisorRows', () => {
  it('counts permits issued, signed, canceled by reason', () => {
    // For the canceled permits, started_at and canceled_at are 1 hour
    // apart so avgPermitMinutes computes to 60. signature_at is null on
    // the canceled fixtures so "permitsSigned" reflects only genuinely-
    // signed permits.
    const startedAt = new Date(NOW_MS - 1 * DAY_MS).toISOString()
    const canceledAt = new Date(NOW_MS - 1 * DAY_MS + 60 * 60_000).toISOString()
    const permits = [
      makePermit({ id: '1', entry_supervisor_id: 'sup-A', entry_supervisor_signature_at: new Date(NOW_MS - DAY_MS).toISOString() }),
      makePermit({ id: '2', entry_supervisor_id: 'sup-A', entry_supervisor_signature_at: null }),
      makePermit({ id: '3', entry_supervisor_id: 'sup-A',
        entry_supervisor_signature_at: null,
        started_at:    startedAt,
        canceled_at:   canceledAt,
        cancel_reason: 'task_complete' }),
      makePermit({ id: '4', entry_supervisor_id: 'sup-A',
        entry_supervisor_signature_at: null,
        started_at:    startedAt,
        canceled_at:   canceledAt,
        cancel_reason: 'prohibited_condition' }),
      makePermit({ id: '5', entry_supervisor_id: 'sup-B' }),
    ]
    const out = computeSupervisorRows({ permits, windowDays: 30, nowMs: NOW_MS })
    expect(out).toHaveLength(2)
    expect(out[0].supervisorId).toBe('sup-A')
    expect(out[0].permitsIssued).toBe(4)
    expect(out[0].permitsSigned).toBe(1)
    expect(out[0].cancelTaskComplete).toBe(1)
    expect(out[0].cancelForCause).toBe(1)
    // sup-A's two canceled permits both ran 60 minutes → avg = 60.
    expect(out[0].avgPermitMinutes).toBe(60)
    expect(out[1].supervisorId).toBe('sup-B')
    expect(out[1].permitsIssued).toBe(1)
  })

  it('excludes permits started outside the window', () => {
    const permits = [
      makePermit({
        id: 'old',
        entry_supervisor_id: 'sup-A',
        started_at: new Date(NOW_MS - 100 * DAY_MS).toISOString(),
      }),
      makePermit({
        id: 'recent',
        entry_supervisor_id: 'sup-A',
        started_at: new Date(NOW_MS - 5 * DAY_MS).toISOString(),
      }),
    ]
    const out = computeSupervisorRows({ permits, windowDays: 30, nowMs: NOW_MS })
    expect(out).toHaveLength(1)
    expect(out[0].permitsIssued).toBe(1)
  })

  it('returns avgPermitMinutes=0 when no canceled permits', () => {
    const permits = [
      makePermit({ id: '1', entry_supervisor_id: 'sup-A', canceled_at: null }),
    ]
    const out = computeSupervisorRows({ permits, windowDays: 30, nowMs: NOW_MS })
    expect(out[0].avgPermitMinutes).toBe(0)
  })

  it('sorts supervisors by permitsIssued desc', () => {
    const permits = [
      ...Array.from({ length: 3 }, (_, i) => makePermit({ id: `b-${i}`, entry_supervisor_id: 'sup-B' })),
      ...Array.from({ length: 5 }, (_, i) => makePermit({ id: `a-${i}`, entry_supervisor_id: 'sup-A' })),
      ...Array.from({ length: 1 }, (_, i) => makePermit({ id: `c-${i}`, entry_supervisor_id: 'sup-C' })),
    ]
    const out = computeSupervisorRows({ permits, windowDays: 30, nowMs: NOW_MS })
    expect(out.map(r => r.supervisorId)).toEqual(['sup-A', 'sup-B', 'sup-C'])
  })
})
