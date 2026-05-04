import { describe, it, expect } from 'vitest'
import {
  bucketByDay,
  cancelReasonBreakdown,
  avgPermitDurationMinutes,
  summarizeScorecardFromRows,
} from '@/lib/scorecardMetrics'
import { SITE_DEFAULTS } from '@/lib/confinedSpaceThresholds'
import type { AtmosphericTest, ConfinedSpacePermit } from '@/lib/types'

const NOW = new Date('2026-04-26T12:00:00Z').getTime()
const DAY_MS = 24 * 60 * 60 * 1000

function permit(partial: Partial<ConfinedSpacePermit>): ConfinedSpacePermit {
  return {
    id:                            'p1',
    serial:                        'CSP-20260426-0001',
    space_id:                      'CS-MIX-04',
    purpose:                       'demo',
    started_at:                    new Date(NOW).toISOString(),
    expires_at:                    new Date(NOW + 4 * 3600_000).toISOString(),
    canceled_at:                   null,
    entry_supervisor_id:           'user-1',
    entry_supervisor_signature_at: null,
    attendants:                    [],
    entrants:                      [],
    hazards_present:               [],
    isolation_measures:            [],
    acceptable_conditions_override: null,
    rescue_service:                {},
    communication_method:          null,
    equipment_list:                [],
    concurrent_permits:            null,
    notes:                         null,
    cancel_reason:                 null,
    cancel_notes:                  null,
    attendant_signature_at:        null,
    attendant_signature_name:      null,
    entrant_acknowledgement_at:    null,
    created_at:                    new Date(NOW).toISOString(),
    updated_at:                    new Date(NOW).toISOString(),
    ...partial,
  }
}

function test(partial: Partial<AtmosphericTest>): AtmosphericTest {
  return {
    id:             't1',
    permit_id:      'p1',
    tested_at:      new Date(NOW).toISOString(),
    tested_by:      'user-1',
    o2_pct:         20.9,
    lel_pct:        0,
    h2s_ppm:        0,
    co_ppm:         0,
    other_readings: [],
    instrument_id:  'BW-1',
    kind:           'pre_entry',
    notes:          null,
    created_at:     new Date(NOW).toISOString(),
    ...partial,
  }
}

// ── bucketByDay ────────────────────────────────────────────────────────────

describe('bucketByDay', () => {
  it('renders an unbroken sequence of days in the window even with no data', () => {
    const out = bucketByDay<unknown>([], () => null, () => false, 7, NOW)
    expect(out).toHaveLength(7)
    // Last bucket must be today; first must be 6 days back.
    expect(out[6].date).toBe('2026-04-26')
    expect(out[0].date).toBe('2026-04-20')
    for (const b of out) expect(b.total).toBe(0)
  })

  it('counts rows into the matching day bucket', () => {
    const rows = [
      { ts: new Date(NOW - 0 * DAY_MS).toISOString(), bad: false },
      { ts: new Date(NOW - 0 * DAY_MS).toISOString(), bad: true  },
      { ts: new Date(NOW - 2 * DAY_MS).toISOString(), bad: false },
    ]
    const out = bucketByDay(rows, r => r.ts, r => r.bad, 7, NOW)
    const today = out.find(b => b.date === '2026-04-26')!
    expect(today.total).toBe(2)
    expect(today.fail).toBe(1)
    const twoDaysAgo = out.find(b => b.date === '2026-04-24')!
    expect(twoDaysAgo.total).toBe(1)
    expect(twoDaysAgo.fail).toBe(0)
  })

  it('drops rows outside the window — keeps the chart honest', () => {
    const rows = [
      { ts: new Date(NOW - 60 * DAY_MS).toISOString(), bad: false }, // older than window
      { ts: new Date(NOW + 1 * DAY_MS).toISOString(),  bad: false }, // future
    ]
    const out = bucketByDay(rows, r => r.ts, r => r.bad, 7, NOW)
    const totals = out.reduce((s, b) => s + b.total, 0)
    expect(totals).toBe(0)
  })

  it('skips rows with null/unparseable timestamps without crashing', () => {
    const rows = [
      { ts: null,            bad: false },
      { ts: 'not-a-date',    bad: false },
      { ts: new Date(NOW).toISOString(), bad: false },
    ]
    const out = bucketByDay(rows, r => r.ts as string | null, r => r.bad, 7, NOW)
    const totals = out.reduce((s, b) => s + b.total, 0)
    expect(totals).toBe(1)
  })
})

// ── cancelReasonBreakdown ──────────────────────────────────────────────────

describe('cancelReasonBreakdown', () => {
  it('humanizes enum values into readable labels', () => {
    const permits = [
      permit({ canceled_at: new Date(NOW).toISOString(), cancel_reason: 'task_complete' }),
      permit({ canceled_at: new Date(NOW).toISOString(), cancel_reason: 'task_complete' }),
      permit({ canceled_at: new Date(NOW).toISOString(), cancel_reason: 'prohibited_condition' }),
    ]
    const out = cancelReasonBreakdown(permits, 30, NOW)
    expect(out).toEqual([
      { reason: 'Task complete',        count: 2 },
      { reason: 'Prohibited condition', count: 1 },
    ])
  })

  it('passes through unknown enum values without crashing', () => {
    const permits = [permit({ canceled_at: new Date(NOW).toISOString(), cancel_reason: 'something_new' as 'other' })]
    const out = cancelReasonBreakdown(permits, 30, NOW)
    expect(out[0].reason).toBe('something_new')
  })

  it('ignores permits canceled outside the window', () => {
    const permits = [
      permit({ canceled_at: new Date(NOW - 60 * DAY_MS).toISOString(), cancel_reason: 'task_complete' }),
    ]
    expect(cancelReasonBreakdown(permits, 30, NOW)).toEqual([])
  })
})

// ── avgPermitDurationMinutes ───────────────────────────────────────────────

describe('avgPermitDurationMinutes', () => {
  it('returns 0 when no permits closed in the window', () => {
    expect(avgPermitDurationMinutes([], 30, NOW)).toBe(0)
  })

  it('rounds to nearest minute', () => {
    const permits = [
      permit({
        started_at:  new Date(NOW - 90 * 60_000).toISOString(),  // 90 min ago
        canceled_at: new Date(NOW).toISOString(),
      }),
      permit({
        started_at:  new Date(NOW - 30 * 60_000).toISOString(),  // 30 min ago
        canceled_at: new Date(NOW).toISOString(),
      }),
    ]
    expect(avgPermitDurationMinutes(permits, 30, NOW)).toBe(60)
  })

  it('skips active permits — they would skew the average', () => {
    const permits = [
      permit({ started_at: new Date(NOW - 90 * 60_000).toISOString(), canceled_at: null }),
    ]
    expect(avgPermitDurationMinutes(permits, 30, NOW)).toBe(0)
  })

  it('guards against backwards data (cancel before start)', () => {
    const permits = [
      permit({
        started_at:  new Date(NOW).toISOString(),
        canceled_at: new Date(NOW - 60 * 60_000).toISOString(),
      }),
    ]
    expect(avgPermitDurationMinutes(permits, 30, NOW)).toBe(0)
  })
})

// ── summarizeScorecardFromRows ─────────────────────────────────────────────

describe('summarizeScorecardFromRows', () => {
  it('returns zeros for an empty input set', () => {
    const m = summarizeScorecardFromRows({
      permits: [], tests: [], thresholds: SITE_DEFAULTS,
      equipPhotoStatus: [], windowDays: 30, nowMs: NOW,
    })
    expect(m.totalPermits).toBe(0)
    expect(m.cancelRate).toBe(0)
    expect(m.failingTestRate).toBe(0)
    expect(m.avgPermitDurationMinutes).toBe(0)
    expect(m.permitsByDay).toHaveLength(30)
    expect(m.testsByDay).toHaveLength(30)
  })

  it('cancelRate excludes task_complete — only "real" cancellations count as program failures', () => {
    const permits = [
      permit({ id: 'a', started_at: new Date(NOW - 1 * DAY_MS).toISOString(), canceled_at: new Date(NOW).toISOString(), cancel_reason: 'task_complete' }),
      permit({ id: 'b', started_at: new Date(NOW - 1 * DAY_MS).toISOString(), canceled_at: new Date(NOW).toISOString(), cancel_reason: 'task_complete' }),
      permit({ id: 'c', started_at: new Date(NOW - 1 * DAY_MS).toISOString(), canceled_at: new Date(NOW).toISOString(), cancel_reason: 'prohibited_condition' }),
      permit({ id: 'd', started_at: new Date(NOW - 1 * DAY_MS).toISOString() }), // active
    ]
    const m = summarizeScorecardFromRows({
      permits, tests: [], thresholds: SITE_DEFAULTS,
      equipPhotoStatus: [], windowDays: 30, nowMs: NOW,
    })
    expect(m.totalPermits).toBe(4)
    expect(m.cancelRate).toBe(25)  // 1 of 4 is a non-routine cancel
  })

  it('failingTestRate uses evaluateTest against the supplied thresholds', () => {
    const tests = [
      test({ id: 't1', o2_pct: 20.9 }),                   // pass
      test({ id: 't2', o2_pct: 17.0 }),                   // fail (below 19.5)
      test({ id: 't3', o2_pct: 25.0 }),                   // fail (above 23.5)
    ]
    const m = summarizeScorecardFromRows({
      permits: [], tests, thresholds: SITE_DEFAULTS,
      equipPhotoStatus: [], windowDays: 30, nowMs: NOW,
    })
    expect(m.failingTestRate).toBe(67)  // 2/3 round to 67
  })

  it('permitsByDay marks non-routine cancels as fails', () => {
    const permits = [
      permit({ id: 'a', started_at: new Date(NOW).toISOString(), canceled_at: new Date(NOW).toISOString(), cancel_reason: 'expired' }),
      permit({ id: 'b', started_at: new Date(NOW).toISOString(), canceled_at: new Date(NOW).toISOString(), cancel_reason: 'task_complete' }),
    ]
    const m = summarizeScorecardFromRows({
      permits, tests: [], thresholds: SITE_DEFAULTS,
      equipPhotoStatus: [], windowDays: 7, nowMs: NOW,
    })
    const today = m.permitsByDay.find(b => b.date === '2026-04-26')!
    expect(today.total).toBe(2)
    expect(today.fail).toBe(1)
  })
})
