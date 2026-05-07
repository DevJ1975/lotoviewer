import { describe, it, expect } from 'vitest'
import {
  trir, dart, ltir, severityRate,
  nearMissToRecordableRatio,
  actionsClosedOnTimePct,
  daysSinceLastRecordable,
  rcaCompletionPct,
  meanTimeToCloseDays,
  meanDaysToRtw,
  bucketByMonth,
  severityActualBreakdown,
  hierarchyOfControlsMix,
  bodyPartHeatmap,
  shiftDayHeatmap,
  selectRecordableInWindow,
  summarizeIncidentScorecard,
  type IncidentRowForMetrics,
  type IncidentWithClassification,
  type CareRowForMetrics,
  type InvestigationRowForMetrics,
  type PersonRowForMetrics,
} from '@soteria/core/incidentScorecardMetrics'
import { type IncidentActionRow } from '@soteria/core/incidentAction'

// ──────────────────────────────────────────────────────────────────────────
// Rate helpers
// ──────────────────────────────────────────────────────────────────────────

describe('rate helpers', () => {
  it('TRIR uses the 200,000 hour constant', () => {
    expect(trir(1, 200_000)).toBe(1)
    expect(trir(4, 200_000)).toBe(4)
  })

  it('DART sums deaths + days_away + restricted', () => {
    expect(dart(1, 1, 1, 200_000)).toBe(3)
    expect(dart(0, 0, 0, 200_000)).toBe(0)
  })

  it('LTIR is deaths + days_away only', () => {
    expect(ltir(1, 2, 200_000)).toBe(3)
  })

  it('severity rate divides days × 200K by hours', () => {
    expect(severityRate(50, 200_000)).toBe(50)
  })

  it('all rates return null when hours = 0', () => {
    expect(trir(5, 0)).toBeNull()
    expect(dart(1, 1, 1, 0)).toBeNull()
    expect(ltir(1, 1, 0)).toBeNull()
    expect(severityRate(10, 0)).toBeNull()
  })
})

describe('nearMissToRecordableRatio', () => {
  it('returns the ratio when recordables > 0', () => {
    expect(nearMissToRecordableRatio(20, 4)).toBe(5)
    expect(nearMissToRecordableRatio(0, 1)).toBe(0)
  })

  it('returns null when recordables = 0 (avoid divide-by-zero)', () => {
    expect(nearMissToRecordableRatio(15, 0)).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// CAPA on-time helper
// ──────────────────────────────────────────────────────────────────────────

describe('actionsClosedOnTimePct', () => {
  function action(over: Partial<IncidentActionRow>): IncidentActionRow {
    return {
      id: 'a', tenant_id: 't', incident_id: 'i',
      action_type: 'corrective', hierarchy_of_controls: null,
      description: 'x', owner_user_id: null, due_at: null,
      status: 'open', completed_at: null, verified_at: null, verified_by: null,
      verification_evidence: null, source_rca_node_id: null, cancel_reason: null,
      created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
      created_by: null, updated_by: null,
      ...over,
    }
  }

  it('returns null when no closed actions', () => {
    expect(actionsClosedOnTimePct([
      action({ status: 'open' }),
      action({ status: 'in_progress' }),
    ])).toBeNull()
  })

  it('counts on-time + late closed actions', () => {
    expect(actionsClosedOnTimePct([
      action({ status: 'complete', completed_at: '2026-04-05T00:00:00Z', due_at: '2026-04-10T00:00:00Z' }),
      action({ status: 'complete', completed_at: '2026-04-15T00:00:00Z', due_at: '2026-04-10T00:00:00Z' }),
      action({ status: 'verified', completed_at: '2026-04-09T00:00:00Z', due_at: '2026-04-10T00:00:00Z' }),
    ])).toBeCloseTo((2 / 3) * 100)
  })

  it('open actions don\'t count in either denominator or numerator', () => {
    expect(actionsClosedOnTimePct([
      action({ status: 'open' }),
      action({ status: 'complete', completed_at: '2026-04-05T00:00:00Z', due_at: '2026-04-10T00:00:00Z' }),
    ])).toBe(100)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Days since last recordable
// ──────────────────────────────────────────────────────────────────────────

describe('daysSinceLastRecordable', () => {
  function row(occurred: string, recordable: boolean): IncidentWithClassification {
    return {
      id: 'r' + occurred, incident_type: 'injury_illness',
      occurred_at: occurred, reported_at: occurred, closed_at: null,
      shift: null, severity_actual: 'medical', status: 'reported',
      classification: { incident_id: 'r' + occurred,
        meets_recording_criteria: recordable,
        classification: recordable ? 'other_recordable' : null,
      },
    }
  }

  it('returns -1 sentinel when no recordable on file', () => {
    const now = new Date('2026-05-01T00:00:00Z').getTime()
    expect(daysSinceLastRecordable([
      row('2026-04-01T00:00:00Z', false),
      row('2026-04-15T00:00:00Z', false),
    ], now)).toBe(-1)
  })

  it('returns days since the most recent recordable', () => {
    const now = new Date('2026-05-01T00:00:00Z').getTime()
    expect(daysSinceLastRecordable([
      row('2026-04-01T00:00:00Z', true),
      row('2026-04-25T00:00:00Z', true),
      row('2026-04-15T00:00:00Z', true),
    ], now)).toBe(6)
  })

  it('floors to whole days, never negative', () => {
    const now = new Date('2026-04-25T12:00:00Z').getTime()
    expect(daysSinceLastRecordable([
      row('2026-04-25T11:00:00Z', true),
    ], now)).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Investigation quality
// ──────────────────────────────────────────────────────────────────────────

describe('rcaCompletionPct', () => {
  it('returns null when no recordables', () => {
    expect(rcaCompletionPct([], []).pct).toBeNull()
  })

  it('counts recordables with a completed investigation', () => {
    const rec1 = { id: 'i1' } as IncidentWithClassification
    const rec2 = { id: 'i2' } as IncidentWithClassification
    const rec3 = { id: 'i3' } as IncidentWithClassification
    const inv: InvestigationRowForMetrics[] = [
      { incident_id: 'i1', completed_at: '2026-04-10T00:00:00Z' },
      { incident_id: 'i2', completed_at: null },
    ]
    const r = rcaCompletionPct([rec1, rec2, rec3], inv)
    expect(r.withCompletedRca).toBe(1)
    expect(r.pct).toBeCloseTo((1 / 3) * 100)
  })
})

describe('meanTimeToCloseDays', () => {
  function row(reported: string, closed: string | null): IncidentRowForMetrics {
    return {
      id: 'r', incident_type: 'injury_illness',
      occurred_at: reported, reported_at: reported, closed_at: closed,
      shift: null, severity_actual: 'medical', status: 'reported',
    }
  }

  it('returns null when no closed incidents', () => {
    expect(meanTimeToCloseDays([row('2026-04-01T00:00:00Z', null)])).toBeNull()
  })

  it('averages reported_at → closed_at across closed cases', () => {
    expect(meanTimeToCloseDays([
      row('2026-04-01T00:00:00Z', '2026-04-05T00:00:00Z'),  // 4 days
      row('2026-04-10T00:00:00Z', '2026-04-20T00:00:00Z'),  // 10 days
      row('2026-04-30T00:00:00Z', null),                     // ignored
    ])).toBe(7)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Care metrics
// ──────────────────────────────────────────────────────────────────────────

describe('meanDaysToRtw', () => {
  it('returns null when no closed cases', () => {
    expect(meanDaysToRtw([])).toBeNull()
  })

  it('averages created_at → return_to_work_at', () => {
    const cs: CareRowForMetrics[] = [
      { incident_id: '1', case_status: 'closed', days_away_from_work: 0, days_restricted: 0,
        return_to_work_at: '2026-04-08T00:00:00Z', created_at: '2026-04-01T00:00:00Z' },
      { incident_id: '2', case_status: 'closed', days_away_from_work: 0, days_restricted: 0,
        return_to_work_at: '2026-04-15T00:00:00Z', created_at: '2026-04-01T00:00:00Z' },
    ]
    expect(meanDaysToRtw(cs)).toBe((7 + 14) / 2)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Trend buckets
// ──────────────────────────────────────────────────────────────────────────

describe('bucketByMonth', () => {
  it('pre-fills empty months in the window', () => {
    const now = new Date('2026-04-15T00:00:00Z').getTime()
    const buckets = bucketByMonth([], 90, now)
    expect(buckets.length).toBeGreaterThanOrEqual(3)
    for (const b of buckets) expect(b.count).toBe(0)
  })

  it('drops rows outside the window', () => {
    const now = new Date('2026-04-15T00:00:00Z').getTime()
    const buckets = bucketByMonth([
      { occurred_at: '2026-03-01T00:00:00Z' },
      { occurred_at: '2026-04-10T00:00:00Z' },
      { occurred_at: '2024-01-01T00:00:00Z' },     // way outside
    ], 60, now)
    const total = buckets.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(2)
  })
})

describe('severityActualBreakdown', () => {
  it('counts every band, including zero', () => {
    const out = severityActualBreakdown([
      { id: '1', incident_type: 'injury_illness', occurred_at: '', reported_at: '',
        closed_at: null, shift: null, severity_actual: 'medical', status: 'reported' },
      { id: '2', incident_type: 'injury_illness', occurred_at: '', reported_at: '',
        closed_at: null, shift: null, severity_actual: 'medical', status: 'reported' },
      { id: '3', incident_type: 'near_miss',      occurred_at: '', reported_at: '',
        closed_at: null, shift: null, severity_actual: 'none',     status: 'reported' },
    ])
    expect(out.medical).toBe(2)
    expect(out.none).toBe(1)
    expect(out.fatality).toBe(0)
  })
})

describe('hierarchyOfControlsMix', () => {
  function action(over: Partial<IncidentActionRow>): IncidentActionRow {
    return {
      id: 'a', tenant_id: 't', incident_id: 'i',
      action_type: 'corrective', hierarchy_of_controls: null,
      description: 'x', owner_user_id: null, due_at: null,
      status: 'complete', completed_at: '2026-04-05T00:00:00Z', verified_at: null, verified_by: null,
      verification_evidence: null, source_rca_node_id: null, cancel_reason: null,
      created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
      created_by: null, updated_by: null,
      ...over,
    }
  }

  it('only counts actions in complete or verified status', () => {
    const mix = hierarchyOfControlsMix([
      action({ status: 'open',     hierarchy_of_controls: 'engineering' }),
      action({ status: 'complete', hierarchy_of_controls: 'engineering' }),
      action({ status: 'verified', hierarchy_of_controls: 'ppe' }),
    ])
    const eng = mix.find(b => b.level === 'engineering')!.count
    const ppe = mix.find(b => b.level === 'ppe')!.count
    expect(eng).toBe(1)
    expect(ppe).toBe(1)
  })

  it('counts unset hierarchy in its own bucket', () => {
    const mix = hierarchyOfControlsMix([
      action({ status: 'complete', hierarchy_of_controls: null }),
    ])
    expect(mix.find(b => b.level === 'unset')!.count).toBe(1)
  })
})

describe('bodyPartHeatmap', () => {
  it('counts each body part across all injured rows', () => {
    const rows: PersonRowForMetrics[] = [
      { incident_id: '1', body_part: ['hand_right', 'arm_left'] },
      { incident_id: '2', body_part: ['hand_right'] },
      { incident_id: '3', body_part: null },
    ]
    const out = bodyPartHeatmap(rows)
    expect(out.find(b => b.body_part === 'hand_right')?.count).toBe(2)
    expect(out.find(b => b.body_part === 'arm_left')?.count).toBe(1)
  })

  it('sorts descending by count', () => {
    const out = bodyPartHeatmap([
      { incident_id: '1', body_part: ['back_lower'] },
      { incident_id: '2', body_part: ['hand_right'] },
      { incident_id: '3', body_part: ['hand_right'] },
      { incident_id: '4', body_part: ['hand_right'] },
    ])
    expect(out[0]!.body_part).toBe('hand_right')
    expect(out[0]!.count).toBe(3)
  })
})

describe('shiftDayHeatmap', () => {
  it('pre-fills all 28 cells (4 shifts × 7 weekdays)', () => {
    const out = shiftDayHeatmap([])
    expect(out).toHaveLength(28)
  })

  it('counts incidents into the right (shift, weekday) cell', () => {
    // 2026-04-15 is a Wednesday (weekday 3 UTC).
    const out = shiftDayHeatmap([
      { id: '1', incident_type: 'injury_illness', occurred_at: '2026-04-15T14:00:00Z',
        reported_at: '', closed_at: null, shift: 'day', severity_actual: 'medical', status: 'reported' },
      { id: '2', incident_type: 'injury_illness', occurred_at: '2026-04-15T22:00:00Z',
        reported_at: '', closed_at: null, shift: 'night', severity_actual: 'medical', status: 'reported' },
      { id: '3', incident_type: 'injury_illness', occurred_at: '2026-04-15T10:00:00Z',
        reported_at: '', closed_at: null, shift: null, severity_actual: 'medical', status: 'reported' },
    ])
    expect(out.find(b => b.shift === 'day'     && b.weekday === 3)?.count).toBe(1)
    expect(out.find(b => b.shift === 'night'   && b.weekday === 3)?.count).toBe(1)
    expect(out.find(b => b.shift === 'unknown' && b.weekday === 3)?.count).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// selectRecordableInWindow
// ──────────────────────────────────────────────────────────────────────────

describe('selectRecordableInWindow', () => {
  function inc(id: string, occurred: string, rec: boolean): IncidentWithClassification {
    return {
      id, incident_type: 'injury_illness',
      occurred_at: occurred, reported_at: occurred, closed_at: null,
      shift: null, severity_actual: 'medical', status: 'reported',
      classification: {
        incident_id: id,
        meets_recording_criteria: rec,
        classification: rec ? 'other_recordable' : null,
      },
    }
  }

  it('keeps only recordables inside the window', () => {
    const now = new Date('2026-04-30T00:00:00Z').getTime()
    const rows = [
      inc('a', '2026-04-15T00:00:00Z', true),     // in
      inc('b', '2026-04-15T00:00:00Z', false),    // not recordable
      inc('c', '2025-10-01T00:00:00Z', true),     // outside 30-day window
    ]
    const out = selectRecordableInWindow(rows, 30, now)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('a')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// End-to-end summarizer smoke test
// ──────────────────────────────────────────────────────────────────────────

describe('summarizeIncidentScorecard', () => {
  it('rolls up a small fixture into the expected shape', () => {
    const now = new Date('2026-04-30T00:00:00Z').getTime()
    const incidents: IncidentWithClassification[] = [
      // Recordable days_away in window
      {
        id: 'a', incident_type: 'injury_illness', occurred_at: '2026-04-10T00:00:00Z',
        reported_at: '2026-04-10T00:00:00Z', closed_at: null, shift: 'day',
        severity_actual: 'lost_time', status: 'investigating',
        classification: { incident_id: 'a', meets_recording_criteria: true, classification: 'days_away' },
      },
      // Near miss in window
      {
        id: 'b', incident_type: 'near_miss', occurred_at: '2026-04-12T00:00:00Z',
        reported_at: '2026-04-12T00:00:00Z', closed_at: null, shift: 'day',
        severity_actual: 'none', status: 'reported',
        classification: null,
      },
    ]
    const careCases: CareRowForMetrics[] = [
      {
        incident_id: 'a', case_status: 'modified_duty',
        days_away_from_work: 5, days_restricted: 0,
        return_to_work_at: null, created_at: '2026-04-10T00:00:00Z',
      },
    ]
    const investigations: InvestigationRowForMetrics[] = [
      { incident_id: 'a', completed_at: null },
    ]
    const out = summarizeIncidentScorecard({
      windowDays: 365, nowMs: now, hoursWorked: 200_000,
      incidents, actions: [], careCases, investigations, injuredPeople: [],
    })

    expect(out.totalRecordable).toBe(1)
    expect(out.totalNearMiss).toBe(1)
    expect(out.totalDaysAwayCases).toBe(1)
    expect(out.totalDaysAwayCount).toBe(5)            // pulled from care
    expect(out.trir).toBe(1)                           // 1 × 200K / 200K
    expect(out.dart).toBe(1)
    expect(out.ltir).toBe(1)
    expect(out.severityRate).toBe(5)                  // 5 days × 200K / 200K
    expect(out.openCareCases).toBe(1)
    expect(out.modifiedDutyCases).toBe(1)
    expect(out.daysSinceLastRecordable).toBe(20)      // April 10 → April 30
    expect(out.nearMissToRecordableRatio).toBe(1)
    expect(out.recordablesByMonth.length).toBeGreaterThan(0)
  })
})
