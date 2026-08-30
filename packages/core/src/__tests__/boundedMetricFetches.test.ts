import { afterEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { _resetActiveSupabaseClient, setActiveSupabaseClient } from '../supabaseClient'
import { fetchNearMissMetrics } from '../nearMissMetrics'
import { fetchJhaMetrics } from '../jhaMetrics'
import { fetchRiskMetrics } from '../riskMetrics'
import { BASELINE_LOOKBACK_DAYS, fetchInsightsMetrics } from '../insightsMetrics'

// These dashboards used to pull whole tables into the browser. The math is
// covered by the per-module summarizer tests; what this file pins down is the
// other half of the contract — every read is bounded, and the totals the
// panels display still come from the whole table (as counts) rather than from
// the bounded row set.

interface RecordedQuery {
  table:   string
  columns: string
  count?:  string
  head?:   boolean
  limit?:  number
  filters: string[]
}

type Respond = (query: RecordedQuery) => { data?: unknown[]; count?: number }

function installRecordingClient(respond: Respond): RecordedQuery[] {
  const queries: RecordedQuery[] = []

  const from = (table: string) => {
    const query: RecordedQuery = { table, columns: '', filters: [] }
    queries.push(query)

    const chain = {
      select: (columns: string, options?: { count?: string; head?: boolean }) => {
        query.columns = columns
        query.count   = options?.count
        query.head    = options?.head
        return chain
      },
      in:    (column: string, values: readonly unknown[]) => {
        query.filters.push(`${column}=in.(${values.join(',')})`)
        return chain
      },
      neq:   (column: string, value: unknown) => {
        query.filters.push(`${column}=neq.${String(value)}`)
        return chain
      },
      not:   (column: string, operator: string, value: unknown) => {
        query.filters.push(`${column}=not.${operator}.${String(value)}`)
        return chain
      },
      gte:   (column: string, value: unknown) => {
        query.filters.push(`${column}=gte.${String(value)}`)
        return chain
      },
      order: () => chain,
      limit: (n: number) => { query.limit = n; return chain },
      then:  (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const { data = [], count } = respond(query)
        return Promise.resolve({ data, count: count ?? data.length, error: null }).then(resolve, reject)
      },
    }
    return chain
  }

  setActiveSupabaseClient({ from } as unknown as SupabaseClient)
  return queries
}

/** Every row-returning read must be filtered and capped; counts may be unfiltered. */
function expectBounded(queries: RecordedQuery[]): void {
  for (const q of queries) {
    expect(q.columns, `${q.table} selects *`).not.toContain('*')
    if (q.head) continue
    expect(q.limit, `${q.table} has no row cap`).toBeGreaterThan(0)
  }
}

function daysBetween(fromIso: string, toMs: number): number {
  return Math.round((toMs - Date.parse(fromIso)) / 86_400_000)
}

afterEach(() => { _resetActiveSupabaseClient() })

describe('fetchNearMissMetrics', () => {
  it('reads only the open cohort and takes both totals from exact counts', async () => {
    const openRow = {
      id: 'nm-1', report_number: 'NM-2026-0001', description: 'Dropped wrench',
      status: 'triaged', severity_potential: 'high',
      reported_at: new Date(Date.now() - 45 * 86_400_000).toISOString(), resolved_at: null,
    }
    const queries = installRecordingClient(q => {
      if (q.head) return { count: q.filters.length > 0 ? 12 : 4_310 }
      return { data: [openRow], count: 1 }
    })

    const metrics = await fetchNearMissMetrics()

    expectBounded(queries)
    const rowQuery = queries.find(q => !q.head)!
    expect(rowQuery.filters).toContain('status=in.(new,triaged,investigating)')
    // The trend tile is a count over the whole table inside the window, not a
    // scan of the rows we fetched.
    expect(queries.filter(q => q.head).some(q => q.filters.some(f => f.startsWith('reported_at=gte.')))).toBe(true)

    expect(metrics).not.toBeNull()
    expect(metrics!.totalAll).toBe(4_310)
    expect(metrics!.newLast30Days).toBe(12)
    expect(metrics!.totalActive).toBe(1)
    expect(metrics!.bySeverity.high).toBe(1)
    expect(metrics!.agingActive).toBe(1)
    expect(metrics!.topUnresolved).toHaveLength(1)
  })
})

describe('fetchJhaMetrics', () => {
  it('excludes superseded revisions server-side and rebuilds their bucket from the count', async () => {
    const activeJha = {
      id: 'jha-1', job_number: 'JHA-2026-0001', title: 'Line break',
      status: 'approved', next_review_date: '2020-01-01',
    }
    const hazard = {
      id: 'hz-1', jha_id: 'jha-1', step_id: null, hazard_category: 'chemical',
      description: 'Residual acid', potential_severity: 'extreme', notes: null,
      tenant_id: 't-1', created_at: '2026-01-01T00:00:00Z',
    }
    const queries = installRecordingClient(q => {
      if (q.head) return { count: 7 }
      if (q.table === 'jhas')        return { data: [activeJha], count: 1 }
      if (q.table === 'jha_hazards') return { data: [hazard] }
      return { data: [] }
    })

    const metrics = await fetchJhaMetrics()

    expectBounded(queries)
    for (const table of ['jhas', 'jha_hazards', 'jha_hazard_controls']) {
      const q = queries.find(entry => entry.table === table && !entry.head)!
      expect(q.filters.some(f => f.endsWith('=neq.superseded')), `${table} still reads superseded rows`).toBe(true)
    }
    expect(queries.find(q => q.table === 'jha_hazards')!.columns).toContain('jhas!inner(status)')

    expect(metrics).not.toBeNull()
    expect(metrics!.totalAll).toBe(7)
    expect(metrics!.totalActive).toBe(1)
    expect(metrics!.byStatus.approved).toBe(1)
    expect(metrics!.byStatus.superseded).toBe(6)
    expect(metrics!.overdueReview).toBe(1)
    expect(metrics!.highOrExtremeHazards).toBe(1)
  })
})

describe('fetchRiskMetrics', () => {
  it('reads the live register only and takes the denominator from an exact count', async () => {
    const openRisk = {
      id: 'r-1', risk_number: 'RSK-2026-0001', title: 'Unguarded nip point',
      status: 'open', hazard_category: 'mechanical',
      inherent_score: 20, inherent_band: 'extreme',
      residual_score: null, residual_band: null, next_review_date: null,
    }
    const queries = installRecordingClient(q => {
      if (q.head) return { count: 900 }
      if (q.table === 'risks') return { data: [openRisk], count: 1 }
      return { data: [] }
    })

    const metrics = await fetchRiskMetrics()

    expectBounded(queries)
    expect(queries.find(q => q.table === 'risks' && !q.head)!.filters)
      .toContain('status=not.in.("closed","accepted_exception")')
    expect(queries.find(q => q.table === 'risk_controls')!.filters)
      .toContain('risks.status=not.in.("closed","accepted_exception")')

    expect(metrics).not.toBeNull()
    expect(metrics!.totalAll).toBe(900)
    expect(metrics!.totalActive).toBe(1)
    expect(metrics!.byEffectiveBand.extreme).toBe(1)
    expect(metrics!.highOrExtremeWithoutPlan).toBe(1)
    expect(metrics!.hierarchyDistribution.none).toBe(1)
  })
})

describe('fetchInsightsMetrics', () => {
  it('floors the reads at the window plus the baseline lookback', async () => {
    const queries = installRecordingClient(() => ({ data: [] }))

    const windowDays = 90
    const metrics = await fetchInsightsMetrics(windowDays)

    expectBounded(queries)
    const floorOf = (table: string): string => {
      const filter = queries.find(q => q.table === table)!.filters.find(f => f.includes('=gte.'))!
      return filter.split('=gte.')[1]
    }
    // Baselines are built from readings older than the window, so the floor
    // has to clear the window before the lookback starts counting.
    expect(daysBetween(floorOf('loto_atmospheric_tests'), metrics.nowMs))
      .toBe(windowDays + BASELINE_LOOKBACK_DAYS)
    // Permits reach back further still: one can open before a reading is taken.
    expect(daysBetween(floorOf('loto_confined_space_permits'), metrics.nowMs))
      .toBeGreaterThan(windowDays + BASELINE_LOOKBACK_DAYS)

    expect(metrics.windowDays).toBe(windowDays)
    expect(metrics.worstSpaces).toEqual([])
    expect(metrics.anomalies).toEqual([])
    expect(metrics.supervisors).toEqual([])
  })
})
