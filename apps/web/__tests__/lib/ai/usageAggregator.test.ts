import { describe, it, expect } from 'vitest'
import {
  costForInvocation,
  aggregateUsage,
  MODEL_PRICING,
  type InvocationRow,
} from '@/lib/ai/usageAggregator'
import { SONNET, HAIKU } from '@/lib/ai/models'

// Cost math + roll-up tests for the AI usage dashboard. Pure
// function — no DB, no network. If Anthropic changes pricing,
// the table-driven tests at the top will fail loudly.

describe('MODEL_PRICING', () => {
  it('Sonnet 4.6 is $3/MTok in, $15/MTok out', () => {
    expect(MODEL_PRICING[SONNET]).toEqual({ inputPerMTok: 3, outputPerMTok: 15 })
  })
  it('Haiku 4.5 is $1/MTok in, $5/MTok out', () => {
    expect(MODEL_PRICING[HAIKU]).toEqual({ inputPerMTok: 1, outputPerMTok: 5 })
  })
})

describe('costForInvocation', () => {
  it('computes Sonnet cost from million-token rates', () => {
    // 1M in @ $3 + 1M out @ $15 = $18
    expect(costForInvocation(SONNET, 1_000_000, 1_000_000)).toBeCloseTo(18, 6)
  })
  it('computes Haiku cost from million-token rates', () => {
    // 1M in @ $1 + 1M out @ $5 = $6
    expect(costForInvocation(HAIKU, 1_000_000, 1_000_000)).toBeCloseTo(6, 6)
  })
  it('handles small token counts', () => {
    // 1000 in @ $3/MTok = $0.003, 500 out @ $15/MTok = $0.0075 → $0.0105
    expect(costForInvocation(SONNET, 1_000, 500)).toBeCloseTo(0.0105, 6)
  })
  it('treats null tokens as zero', () => {
    expect(costForInvocation(SONNET, null, null)).toBe(0)
    expect(costForInvocation(SONNET, undefined, undefined)).toBe(0)
  })
  it('falls back to Sonnet pricing for unknown model ids', () => {
    expect(costForInvocation('gpt-4', 1_000_000, 0)).toBeCloseTo(3, 6)
  })
  it('charges cache reads at 10% of base input rate', () => {
    // 1M cache_read on Sonnet @ $3/MTok * 0.10 = $0.30
    expect(costForInvocation(SONNET, 0, 0, 1_000_000, 0)).toBeCloseTo(0.30, 6)
  })
  it('charges cache writes at 125% of base input rate', () => {
    // 1M cache_write on Sonnet @ $3/MTok * 1.25 = $3.75
    expect(costForInvocation(SONNET, 0, 0, 0, 1_000_000)).toBeCloseTo(3.75, 6)
  })
  it('sums uncached + read + write + output correctly', () => {
    // Sonnet: 1k uncached in (0.003) + 10k read (0.003) + 5k write (0.01875)
    //       + 500 out (0.0075) = 0.03225
    expect(costForInvocation(SONNET, 1_000, 500, 10_000, 5_000)).toBeCloseTo(0.03225, 6)
  })
})

function row(overrides: Partial<InvocationRow> = {}): InvocationRow {
  return {
    id:                 1,
    user_id:            'user-1',
    tenant_id:          'tenant-A',
    tenant_name:        'Acme',
    surface:            'support-chat',
    model:              SONNET,
    status:             'success',
    input_tokens:       1000,
    output_tokens:      500,
    cache_read_tokens:  null,
    cache_write_tokens: null,
    occurred_at:        '2026-05-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('aggregateUsage', () => {
  it('returns empty totals on empty input', () => {
    const r = aggregateUsage([])
    expect(r.totals.invocations).toBe(0)
    expect(r.totals.estCostUsd).toBe(0)
    expect(r.bySurface).toEqual([])
    expect(r.byTenant).toEqual([])
    expect(r.daily).toEqual([])
    expect(r.recentFailures).toEqual([])
  })

  it('rolls up totals across statuses', () => {
    const r = aggregateUsage([
      row({ id: 1, status: 'success' }),
      row({ id: 2, status: 'success' }),
      row({ id: 3, status: 'error' }),
      row({ id: 4, status: 'rate_limited', input_tokens: 0, output_tokens: 0 }),
    ])
    expect(r.totals.invocations).toBe(4)
    expect(r.totals.success).toBe(2)
    expect(r.totals.errors).toBe(1)
    expect(r.totals.rateLimited).toBe(1)
  })

  it('sums tokens and cost per surface', () => {
    const rows = [
      row({ id: 1, surface: 'support-chat', input_tokens: 1_000_000, output_tokens: 0 }),
      row({ id: 2, surface: 'support-chat', input_tokens: 1_000_000, output_tokens: 0 }),
      row({ id: 3, surface: 'validate-photo', model: HAIKU, input_tokens: 1_000_000, output_tokens: 0 }),
    ]
    const r = aggregateUsage(rows)
    const chat = r.bySurface.find(s => s.surface === 'support-chat')
    const vp   = r.bySurface.find(s => s.surface === 'validate-photo')
    expect(chat?.invocations).toBe(2)
    expect(chat?.inputTokens).toBe(2_000_000)
    expect(chat?.estCostUsd).toBeCloseTo(6, 6)   // 2M * $3
    expect(vp?.estCostUsd).toBeCloseTo(1, 6)     // 1M * $1
  })

  it('orders bySurface by est cost descending', () => {
    const rows = [
      row({ id: 1, surface: 'cheap',  model: HAIKU,  input_tokens: 1000, output_tokens: 0 }),
      row({ id: 2, surface: 'pricey', model: SONNET, input_tokens: 1_000_000, output_tokens: 0 }),
    ]
    const r = aggregateUsage(rows)
    expect(r.bySurface[0].surface).toBe('pricey')
    expect(r.bySurface[1].surface).toBe('cheap')
  })

  it('groups by tenant and preserves tenant_name', () => {
    const rows = [
      row({ id: 1, tenant_id: 'A', tenant_name: 'Acme' }),
      row({ id: 2, tenant_id: 'B', tenant_name: 'Beta', input_tokens: 2000, output_tokens: 1000 }),
      row({ id: 3, tenant_id: 'A', tenant_name: 'Acme' }),
    ]
    const r = aggregateUsage(rows)
    expect(r.byTenant.length).toBe(2)
    const acme = r.byTenant.find(t => t.tenantId === 'A')
    expect(acme?.tenantName).toBe('Acme')
    expect(acme?.invocations).toBe(2)
  })

  it('handles rows with null tenant_id under a single bucket', () => {
    const rows = [
      row({ id: 1, tenant_id: null, tenant_name: null }),
      row({ id: 2, tenant_id: null, tenant_name: null }),
    ]
    const r = aggregateUsage(rows)
    expect(r.byTenant.length).toBe(1)
    expect(r.byTenant[0].tenantId).toBeNull()
    expect(r.byTenant[0].invocations).toBe(2)
  })

  it('buckets by UTC day', () => {
    const rows = [
      row({ id: 1, occurred_at: '2026-05-01T23:59:00Z' }),
      row({ id: 2, occurred_at: '2026-05-02T00:01:00Z' }),
      row({ id: 3, occurred_at: '2026-05-02T12:00:00Z' }),
    ]
    const r = aggregateUsage(rows)
    expect(r.daily.length).toBe(2)
    expect(r.daily[0].day).toBe('2026-05-01')
    expect(r.daily[0].invocations).toBe(1)
    expect(r.daily[1].day).toBe('2026-05-02')
    expect(r.daily[1].invocations).toBe(2)
  })

  it('computes cacheHitRate per surface from read + uncached input', () => {
    const rows = [
      row({ id: 1, surface: 'generate-loto-steps', input_tokens: 100, cache_read_tokens: 900 }),
      row({ id: 2, surface: 'generate-loto-steps', input_tokens: 50,  cache_read_tokens: 450 }),
      row({ id: 3, surface: 'support-chat',        input_tokens: 1000, cache_read_tokens: 0 }),
    ]
    const r = aggregateUsage(rows)
    const loto = r.bySurface.find(s => s.surface === 'generate-loto-steps')!
    const chat = r.bySurface.find(s => s.surface === 'support-chat')!
    // (900 + 450) / (900 + 450 + 100 + 50) = 1350 / 1500 = 0.9
    expect(loto.cacheHitRate).toBeCloseTo(0.9, 6)
    // Zero cache reads → 0% hit rate even with input tokens.
    expect(chat.cacheHitRate).toBe(0)
  })

  it('counts budget_blocked into totals + failures', () => {
    const rows = [
      row({ id: 1, status: 'success' }),
      row({ id: 2, status: 'budget_blocked', occurred_at: '2026-05-02T12:00:00Z' }),
    ]
    const r = aggregateUsage(rows)
    expect(r.totals.budgetBlocked).toBe(1)
    expect(r.recentFailures.find(f => f.id === 2)?.status).toBe('budget_blocked')
  })

  it('orders daily ascending for chart rendering', () => {
    const rows = [
      row({ id: 1, occurred_at: '2026-05-03T12:00:00Z' }),
      row({ id: 2, occurred_at: '2026-05-01T12:00:00Z' }),
      row({ id: 3, occurred_at: '2026-05-02T12:00:00Z' }),
    ]
    const r = aggregateUsage(rows)
    expect(r.daily.map(d => d.day)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('collects failures and excludes successes', () => {
    const rows = [
      row({ id: 1, status: 'success' }),
      row({ id: 2, status: 'error', occurred_at: '2026-05-02T12:00:00Z' }),
      row({ id: 3, status: 'rate_limited', occurred_at: '2026-05-03T12:00:00Z' }),
    ]
    const r = aggregateUsage(rows)
    expect(r.recentFailures.length).toBe(2)
    expect(r.recentFailures.map(f => f.id).sort()).toEqual([2, 3])
  })

  it('caps failures at 25 and orders newest-first', () => {
    const rows: InvocationRow[] = []
    for (let i = 0; i < 30; i++) {
      rows.push(row({
        id: i,
        status: 'error',
        occurred_at: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
      }))
    }
    const r = aggregateUsage(rows)
    expect(r.recentFailures.length).toBe(25)
    // Verify ordering: occurredAt descending
    for (let i = 1; i < r.recentFailures.length; i++) {
      expect(r.recentFailures[i - 1].occurredAt >= r.recentFailures[i].occurredAt).toBe(true)
    }
  })

  it('byStatus counts each status independently', () => {
    const rows = [
      row({ id: 1, status: 'success' }),
      row({ id: 2, status: 'success' }),
      row({ id: 3, status: 'error' }),
    ]
    const r = aggregateUsage(rows)
    const succ = r.byStatus.find(s => s.status === 'success')
    const err  = r.byStatus.find(s => s.status === 'error')
    expect(succ?.invocations).toBe(2)
    expect(err?.invocations).toBe(1)
  })

  it('byModel splits Sonnet vs Haiku correctly', () => {
    const rows = [
      row({ id: 1, model: SONNET, input_tokens: 1_000_000 }),
      row({ id: 2, model: HAIKU,  input_tokens: 1_000_000 }),
      row({ id: 3, model: HAIKU,  input_tokens: 1_000_000 }),
    ]
    const r = aggregateUsage(rows)
    const sonnet = r.byModel.find(m => m.model === SONNET)
    const haiku  = r.byModel.find(m => m.model === HAIKU)
    expect(sonnet?.invocations).toBe(1)
    expect(haiku?.invocations).toBe(2)
  })
})
