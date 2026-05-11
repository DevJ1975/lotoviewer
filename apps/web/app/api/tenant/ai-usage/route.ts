import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aggregateUsage, type InvocationRow, type UsageSummary, costForInvocation } from '@/lib/ai/usageAggregator'

// GET /api/tenant/ai-usage?days=30
//
// Tenant-admin view of the same aggregator that powers /api/superadmin/ai-usage,
// scoped to the caller's tenant. Lets a tenant admin see their own
// AI spend, daily trend, and what's left of their daily budget without
// going through superadmin.
//
// Auth: tenant-admin role (or superadmin via passthrough). The dashboard
// is sensitive — every member of the tenant could be triaged via
// `byUser` if we surfaced that breakdown — so admin/owner only.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 30
const MAX_DAYS     = 365
const MAX_ROWS     = 50_000

export interface TenantUsageResponse {
  windowDays: number
  rowsRead:   number
  truncated:  boolean
  summary:    UsageSummary
  // Today's spend + cap exposed at the top level so the dashboard can
  // render "$2.43 of $5.00 today" without re-summing client-side.
  today: {
    spentCents:  number
    capCents:    number | null
    aiDisabled:  boolean
  }
  caveat: string
}

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const daysRaw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS)
  const days = Number.isFinite(daysRaw) && daysRaw > 0
    ? Math.min(Math.floor(daysRaw), MAX_DAYS)
    : DEFAULT_DAYS

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const admin = supabaseAdmin()

  // Window query + tenant settings (for the budget cap) in parallel.
  const [{ data: invocations, error: invErr }, { data: tenantRow, error: tenantErr }] = await Promise.all([
    admin.from('ai_invocations')
      .select('id, user_id, surface, model, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, occurred_at')
      .eq('tenant_id', gate.tenantId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(MAX_ROWS),
    admin.from('tenants').select('settings').eq('id', gate.tenantId).maybeSingle(),
  ])
  if (invErr)    return NextResponse.json({ error: invErr.message },    { status: 500 })
  if (tenantErr) return NextResponse.json({ error: tenantErr.message }, { status: 500 })

  const rows = invocations ?? []
  const enriched: InvocationRow[] = rows.map(r => ({
    id:                 r.id,
    user_id:            r.user_id,
    tenant_id:          gate.tenantId,
    tenant_name:        null,
    surface:            r.surface,
    model:              r.model,
    status:             r.status as InvocationRow['status'],
    input_tokens:       r.input_tokens,
    output_tokens:      r.output_tokens,
    cache_read_tokens:  r.cache_read_tokens  ?? null,
    cache_write_tokens: r.cache_write_tokens ?? null,
    occurred_at:        r.occurred_at,
  }))

  const summary = aggregateUsage(enriched)

  // Today's spend (UTC start) + cap. We compute spend by re-summing
  // today's successful rows from the already-fetched list rather than
  // making another DB round-trip. Skips ai_disabled / rate-limited /
  // budget-blocked rows since those didn't actually charge.
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  let spentUsd = 0
  for (const r of enriched) {
    if (r.status !== 'success') continue
    if (new Date(r.occurred_at).getTime() < startOfDay.getTime()) continue
    spentUsd += costForInvocation(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens)
  }
  const settings = (tenantRow?.settings ?? {}) as { ai_disabled?: boolean; ai_daily_budget_cents?: number }
  const capCents = typeof settings.ai_daily_budget_cents === 'number' && settings.ai_daily_budget_cents > 0
    ? settings.ai_daily_budget_cents
    : null

  const payload: TenantUsageResponse = {
    windowDays: days,
    rowsRead:   enriched.length,
    truncated:  enriched.length === MAX_ROWS,
    summary,
    today: {
      spentCents: Math.round(spentUsd * 100),
      capCents,
      aiDisabled: settings.ai_disabled === true,
    },
    caveat:
      'USD figures are estimates. Cache reads bill at 10% of base; cache writes at 125%. ' +
      'Use this dashboard for trend / attribution, not for billing.',
  }
  return NextResponse.json(payload)
}
