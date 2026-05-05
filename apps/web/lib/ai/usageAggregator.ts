// Pure aggregation + pricing helper for the AI usage dashboard.
//
// Lives apart from rateLimit.ts so it has no Supabase dependency
// and can be unit-tested with plain row arrays. The /api/admin/ai-usage
// route fetches rows and pipes them through these functions; that
// keeps cost math, time bucketing, and group-by logic in one place.
//
// Pricing posture: hardcoded per-million-token rates as documented
// on docs.anthropic.com at the time of writing (Sonnet 4.6, Haiku 4.5).
// These are USD estimates — Anthropic's actual invoice will differ
// (cache reads, batch discounts, prompt caching). The dashboard
// surfaces this caveat in the UI; do not treat dollar figures here
// as billing-grade.

import { SONNET, HAIKU } from './models'

// ─── Pricing ──────────────────────────────────────────────────────────
// Rates expressed in USD per million tokens. Source: Anthropic public
// pricing as of 2026-05. When Anthropic changes prices, update here +
// the test in usageAggregator.test.ts.
export interface ModelPricing {
  inputPerMTok:  number
  outputPerMTok: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  [SONNET]: { inputPerMTok: 3,  outputPerMTok: 15 },
  [HAIKU]:  { inputPerMTok: 1,  outputPerMTok: 5  },
}

/**
 * Compute USD cost for a single invocation. Falls back to Sonnet
 * pricing for unknown model ids — surfaces a nonzero cost rather
 * than silently dropping spend on a model we forgot to register.
 */
export function costForInvocation(
  model:        string,
  inputTokens:  number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING[SONNET]
  const inCost  = ((inputTokens  ?? 0) / 1_000_000) * p.inputPerMTok
  const outCost = ((outputTokens ?? 0) / 1_000_000) * p.outputPerMTok
  return inCost + outCost
}

// ─── Row shape ────────────────────────────────────────────────────────
// Mirrors the public.ai_invocations columns we read. tenant_name is
// joined in by the route handler so the aggregator can surface it.
export interface InvocationRow {
  id:            number
  user_id:       string
  tenant_id:     string | null
  tenant_name:   string | null
  surface:       string
  model:         string
  status:        'success' | 'rate_limited' | 'error'
  input_tokens:  number | null
  output_tokens: number | null
  occurred_at:   string  // ISO timestamp
}

// ─── Aggregation result ───────────────────────────────────────────────
export interface UsageSummary {
  totals: {
    invocations:   number
    success:       number
    errors:        number
    rateLimited:   number
    inputTokens:   number
    outputTokens:  number
    estCostUsd:    number
  }
  bySurface: Array<{
    surface:      string
    invocations:  number
    inputTokens:  number
    outputTokens: number
    estCostUsd:   number
  }>
  byTenant: Array<{
    tenantId:     string | null
    tenantName:   string | null
    invocations:  number
    inputTokens:  number
    outputTokens: number
    estCostUsd:   number
  }>
  byStatus: Array<{
    status:      'success' | 'rate_limited' | 'error'
    invocations: number
  }>
  byModel: Array<{
    model:        string
    invocations:  number
    inputTokens:  number
    outputTokens: number
    estCostUsd:   number
  }>
  daily: Array<{
    day:          string  // YYYY-MM-DD UTC
    invocations:  number
    inputTokens:  number
    outputTokens: number
    estCostUsd:   number
  }>
  recentFailures: Array<{
    id:          number
    occurredAt:  string
    surface:     string
    model:       string
    status:      'rate_limited' | 'error'
    tenantName:  string | null
  }>
}

interface SurfaceAccum {
  invocations:  number
  inputTokens:  number
  outputTokens: number
  estCostUsd:   number
}

function emptySurfaceAccum(): SurfaceAccum {
  return { invocations: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0 }
}

/**
 * Roll a flat row list into the dashboard shape. Pure — no I/O.
 */
export function aggregateUsage(rows: InvocationRow[]): UsageSummary {
  const totals = {
    invocations:  0,
    success:      0,
    errors:       0,
    rateLimited:  0,
    inputTokens:  0,
    outputTokens: 0,
    estCostUsd:   0,
  }

  const bySurfaceMap = new Map<string, SurfaceAccum>()
  const byTenantMap  = new Map<string, SurfaceAccum & { tenantName: string | null }>()
  const byStatusMap  = new Map<'success' | 'rate_limited' | 'error', number>()
  const byModelMap   = new Map<string, SurfaceAccum>()
  const dailyMap     = new Map<string, SurfaceAccum>()
  const failures: UsageSummary['recentFailures'] = []

  for (const r of rows) {
    const inTok  = r.input_tokens  ?? 0
    const outTok = r.output_tokens ?? 0
    const cost   = costForInvocation(r.model, inTok, outTok)

    totals.invocations  += 1
    totals.inputTokens  += inTok
    totals.outputTokens += outTok
    totals.estCostUsd   += cost
    if (r.status === 'success')      totals.success     += 1
    if (r.status === 'error')        totals.errors      += 1
    if (r.status === 'rate_limited') totals.rateLimited += 1

    const surfAcc = bySurfaceMap.get(r.surface) ?? emptySurfaceAccum()
    surfAcc.invocations  += 1
    surfAcc.inputTokens  += inTok
    surfAcc.outputTokens += outTok
    surfAcc.estCostUsd   += cost
    bySurfaceMap.set(r.surface, surfAcc)

    const tenantKey = r.tenant_id ?? '__none__'
    const tenAcc = byTenantMap.get(tenantKey) ?? { ...emptySurfaceAccum(), tenantName: r.tenant_name }
    tenAcc.invocations  += 1
    tenAcc.inputTokens  += inTok
    tenAcc.outputTokens += outTok
    tenAcc.estCostUsd   += cost
    if (!tenAcc.tenantName && r.tenant_name) tenAcc.tenantName = r.tenant_name
    byTenantMap.set(tenantKey, tenAcc)

    byStatusMap.set(r.status, (byStatusMap.get(r.status) ?? 0) + 1)

    const modAcc = byModelMap.get(r.model) ?? emptySurfaceAccum()
    modAcc.invocations  += 1
    modAcc.inputTokens  += inTok
    modAcc.outputTokens += outTok
    modAcc.estCostUsd   += cost
    byModelMap.set(r.model, modAcc)

    const day = r.occurred_at.slice(0, 10)  // ISO YYYY-MM-DD UTC
    const dayAcc = dailyMap.get(day) ?? emptySurfaceAccum()
    dayAcc.invocations  += 1
    dayAcc.inputTokens  += inTok
    dayAcc.outputTokens += outTok
    dayAcc.estCostUsd   += cost
    dailyMap.set(day, dayAcc)

    if (r.status !== 'success' && failures.length < 25) {
      failures.push({
        id:         r.id,
        occurredAt: r.occurred_at,
        surface:    r.surface,
        model:      r.model,
        status:     r.status,
        tenantName: r.tenant_name,
      })
    }
  }

  return {
    totals,
    bySurface: Array.from(bySurfaceMap.entries())
      .map(([surface, v]) => ({ surface, ...v }))
      .sort((a, b) => b.estCostUsd - a.estCostUsd),
    byTenant: Array.from(byTenantMap.entries())
      .map(([tid, v]) => ({
        tenantId:     tid === '__none__' ? null : tid,
        tenantName:   v.tenantName,
        invocations:  v.invocations,
        inputTokens:  v.inputTokens,
        outputTokens: v.outputTokens,
        estCostUsd:   v.estCostUsd,
      }))
      .sort((a, b) => b.estCostUsd - a.estCostUsd),
    byStatus: Array.from(byStatusMap.entries())
      .map(([status, invocations]) => ({ status, invocations }))
      .sort((a, b) => b.invocations - a.invocations),
    byModel: Array.from(byModelMap.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.estCostUsd - a.estCostUsd),
    daily: Array.from(dailyMap.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    recentFailures: failures
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 25),
  }
}
