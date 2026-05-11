import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aggregateUsage, type InvocationRow, type UsageSummary } from '@/lib/ai/usageAggregator'

// GET /api/admin/ai-usage?days=30
//
// Superadmin-only. Reads ai_invocations rows in the requested
// window, joins tenant names, runs them through aggregateUsage(),
// and returns the rolled-up dashboard payload.
//
// Why superadmin (not tenant admin): the dashboard is cross-tenant
// (cost attribution per tenant is one of its primary use cases).
// A per-tenant version is straightforward later — same aggregator,
// scoped query, gated by requireTenantAdmin.

const DEFAULT_DAYS = 30
const MAX_DAYS     = 365
const MAX_ROWS     = 50_000  // hard cap so a single dashboard load can't OOM

export interface UsageResponse {
  windowDays: number
  rowsRead:   number
  truncated:  boolean
  summary:    UsageSummary
  caveat:     string
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const daysRaw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS)
  const days = Number.isFinite(daysRaw) && daysRaw > 0
    ? Math.min(Math.floor(daysRaw), MAX_DAYS)
    : DEFAULT_DAYS

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const admin = supabaseAdmin()

  const { data: invocations, error } = await admin
    .from('ai_invocations')
    .select('id, user_id, tenant_id, surface, model, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, occurred_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(MAX_ROWS)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = invocations ?? []

  // Resolve tenant names in a single round-trip. Avoids embedding
  // the join in the main query (PostgREST FK relationship inference
  // is fragile across schema changes; an explicit lookup is clearer).
  const tenantIds = Array.from(new Set(
    rows.map(r => r.tenant_id).filter((x): x is string => !!x),
  ))
  const tenantNameById = new Map<string, string>()
  if (tenantIds.length > 0) {
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, name')
      .in('id', tenantIds)
    for (const t of tenants ?? []) {
      tenantNameById.set(t.id, t.name)
    }
  }

  const enriched: InvocationRow[] = rows.map(r => ({
    id:                 r.id,
    user_id:            r.user_id,
    tenant_id:          r.tenant_id,
    tenant_name:        r.tenant_id ? tenantNameById.get(r.tenant_id) ?? null : null,
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

  const payload: UsageResponse = {
    windowDays: days,
    rowsRead:   enriched.length,
    truncated:  enriched.length === MAX_ROWS,
    summary,
    caveat:
      'USD figures are estimates derived from list pricing per million tokens. ' +
      'Cache reads bill at 10% of base; cache writes at 125%. Batch discounts + ' +
      'tiered cache pricing nuances are not modeled. Use this dashboard for trend / ' +
      'attribution, not for billing.',
  }

  return NextResponse.json(payload)
}
