import { describe, it, expect } from 'vitest'
import {
  aggregateMetrics, lifecycleOf, formatDuration, PRIORITY_LABEL,
  type MetricsTicketRow,
} from '@/lib/support/ticketMetrics'

function row(overrides: Partial<MetricsTicketRow> = {}): MetricsTicketRow {
  return {
    id:           'id-' + Math.random().toString(36).slice(2),
    reason:       'user_requested',
    tenant_id:    'tenant-A',
    tenant_name:  'Acme',
    emailed_ok:   true,
    resolved_at:  null,
    archived_at:  null,
    created_at:   '2026-04-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('lifecycleOf', () => {
  it('returns archived when archived_at is set (regardless of resolved_at)', () => {
    expect(lifecycleOf(row({ resolved_at: '2026-04-15T00:00:00Z', archived_at: '2026-05-15T00:00:00Z' }))).toBe('archived')
  })
  it('returns resolved when resolved_at is set + archived_at is null', () => {
    expect(lifecycleOf(row({ resolved_at: '2026-04-15T00:00:00Z', archived_at: null }))).toBe('resolved')
  })
  it('returns open when both timestamps are null', () => {
    expect(lifecycleOf(row({ resolved_at: null, archived_at: null }))).toBe('open')
  })
})

describe('aggregateMetrics — totals', () => {
  it('returns zero totals on empty input', () => {
    const r = aggregateMetrics([])
    expect(r.totals).toEqual({ all: 0, open: 0, resolved: 0, archived: 0, emailFailed: 0 })
    expect(r.byTenant).toEqual([])
    expect(r.daily).toEqual([])
    expect(r.oldestOpenAgeDays).toBeNull()
  })

  it('counts each lifecycle bucket independently', () => {
    const r = aggregateMetrics([
      row(),                                                                // open
      row({ resolved_at: '2026-04-15T00:00:00Z' }),                         // resolved
      row({ resolved_at: '2026-04-15T00:00:00Z', archived_at: '2026-05-15T00:00:00Z' }), // archived
      row({ resolved_at: '2026-04-15T00:00:00Z', archived_at: '2026-05-16T00:00:00Z' }), // archived
    ])
    expect(r.totals.open).toBe(1)
    expect(r.totals.resolved).toBe(1)
    expect(r.totals.archived).toBe(2)
    expect(r.totals.all).toBe(4)
  })

  it('counts emailFailed only when emailed_ok is explicitly false', () => {
    const r = aggregateMetrics([
      row({ emailed_ok: false }),
      row({ emailed_ok: null }),
      row({ emailed_ok: true }),
    ])
    expect(r.totals.emailFailed).toBe(1)
  })
})

describe('aggregateMetrics — byPriority', () => {
  it('always returns all 3 reasons (zeroed if absent)', () => {
    const r = aggregateMetrics([])
    expect(r.byPriority.length).toBe(3)
    expect(r.byPriority.map(p => p.reason)).toEqual(['safety_critical', 'low_confidence', 'user_requested'])
  })

  it('uses friendly priority labels', () => {
    const r = aggregateMetrics([])
    expect(r.byPriority[0].label).toBe(PRIORITY_LABEL.safety_critical)
  })

  it('rolls counts per (reason, lifecycle)', () => {
    const r = aggregateMetrics([
      row({ reason: 'safety_critical' }),
      row({ reason: 'safety_critical', resolved_at: '2026-04-15T00:00:00Z' }),
      row({ reason: 'low_confidence',  resolved_at: '2026-04-15T00:00:00Z', archived_at: '2026-05-15T00:00:00Z' }),
      row({ reason: 'user_requested' }),
    ])
    const safety = r.byPriority.find(p => p.reason === 'safety_critical')!
    const low    = r.byPriority.find(p => p.reason === 'low_confidence')!
    const user   = r.byPriority.find(p => p.reason === 'user_requested')!
    expect(safety).toMatchObject({ open: 1, resolved: 1, archived: 0, total: 2 })
    expect(low   ).toMatchObject({ open: 0, resolved: 0, archived: 1, total: 1 })
    expect(user  ).toMatchObject({ open: 1, resolved: 0, archived: 0, total: 1 })
  })
})

describe('aggregateMetrics — byTenant', () => {
  it('groups by tenant and falls back to "__none__" bucket on null', () => {
    const r = aggregateMetrics([
      row({ tenant_id: 'A', tenant_name: 'Acme' }),
      row({ tenant_id: 'B', tenant_name: 'Beta' }),
      row({ tenant_id: null, tenant_name: null }),
      row({ tenant_id: null, tenant_name: null }),
    ])
    expect(r.byTenant.length).toBe(3)
    const noneBucket = r.byTenant.find(t => t.tenantId === null)
    expect(noneBucket?.total).toBe(2)
  })

  it('orders byTenant with most-open-first', () => {
    const r = aggregateMetrics([
      row({ tenant_id: 'A', tenant_name: 'Acme' }),                                       // open
      row({ tenant_id: 'B', tenant_name: 'Beta' }),                                       // open
      row({ tenant_id: 'B', tenant_name: 'Beta' }),                                       // open
      row({ tenant_id: 'C', tenant_name: 'Gamma', resolved_at: '2026-04-15T00:00:00Z' }), // resolved
    ])
    expect(r.byTenant[0].tenantId).toBe('B')   // 2 open
    expect(r.byTenant[1].tenantId).toBe('A')   // 1 open
    expect(r.byTenant[2].tenantId).toBe('C')   // 0 open, 1 total
  })
})

describe('aggregateMetrics — resolutionMs', () => {
  it('returns null stats when no tickets are resolved', () => {
    const r = aggregateMetrics([row(), row()])
    expect(r.resolutionMs).toEqual({ count: 0, median: null, p90: null, mean: null })
  })

  it('measures created_at → resolved_at duration (ignoring archived_at)', () => {
    // 1h, 2h, 4h durations. median = 2h, mean ≈ 7/3 h.
    const make = (h: number) => row({
      created_at:  '2026-04-01T00:00:00Z',
      resolved_at: new Date(Date.parse('2026-04-01T00:00:00Z') + h * 3600_000).toISOString(),
      archived_at: '2026-05-15T00:00:00Z',  // archival should not affect duration
    })
    const r = aggregateMetrics([make(1), make(2), make(4)])
    expect(r.resolutionMs.count).toBe(3)
    expect(r.resolutionMs.median).toBe(2 * 3600_000)
    expect(r.resolutionMs.mean).toBeCloseTo((1 + 2 + 4) / 3 * 3600_000, 0)
  })

  it('skips negative durations (clock skew defense)', () => {
    const r = aggregateMetrics([row({
      created_at:  '2026-04-02T00:00:00Z',
      resolved_at: '2026-04-01T00:00:00Z',  // before created_at
    })])
    expect(r.resolutionMs.count).toBe(0)
  })
})

describe('aggregateMetrics — daily', () => {
  it('counts opens on creation day and resolves on resolved day', () => {
    const r = aggregateMetrics([
      row({ created_at: '2026-04-01T12:00:00Z' }),
      row({ created_at: '2026-04-01T13:00:00Z', resolved_at: '2026-04-03T00:00:00Z' }),
      row({ created_at: '2026-04-02T00:00:00Z' }),
    ])
    const apr1 = r.daily.find(d => d.day === '2026-04-01')!
    const apr2 = r.daily.find(d => d.day === '2026-04-02')!
    const apr3 = r.daily.find(d => d.day === '2026-04-03')!
    expect(apr1.opened).toBe(2)
    expect(apr1.resolved).toBe(0)
    expect(apr2.opened).toBe(1)
    expect(apr3.resolved).toBe(1)
  })

  it('sorts daily ascending', () => {
    const r = aggregateMetrics([
      row({ created_at: '2026-04-03T12:00:00Z' }),
      row({ created_at: '2026-04-01T12:00:00Z' }),
      row({ created_at: '2026-04-02T12:00:00Z' }),
    ])
    expect(r.daily.map(d => d.day)).toEqual(['2026-04-01', '2026-04-02', '2026-04-03'])
  })
})

describe('aggregateMetrics — oldestOpenAgeDays', () => {
  it('returns null when no open tickets exist', () => {
    const r = aggregateMetrics([row({ resolved_at: '2026-05-01T00:00:00Z' })])
    expect(r.oldestOpenAgeDays).toBeNull()
  })

  it('measures age of the oldest still-open ticket', () => {
    const r = aggregateMetrics(
      [
        row({ created_at: '2026-04-01T00:00:00Z' }),
        row({ created_at: '2026-04-25T00:00:00Z' }),
      ],
      new Date('2026-05-05T00:00:00Z'),
    )
    expect(r.oldestOpenAgeDays).toBe(34)
  })
})

describe('formatDuration', () => {
  it('renders the right unit per scale', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(30_000)).toBe('<1 min')
    expect(formatDuration(120_000)).toBe('2 min')
    expect(formatDuration(3 * 3600_000)).toBe('3.0 h')
    expect(formatDuration(2 * 86_400_000)).toBe('2.0 d')
  })
})
