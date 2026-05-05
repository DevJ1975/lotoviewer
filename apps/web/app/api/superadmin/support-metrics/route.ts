import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  aggregateMetrics,
  type MetricsTicketRow,
  type MetricsSummary,
} from '@/lib/support/ticketMetrics'

// GET /api/superadmin/support-metrics?days=30
//
// Superadmin-only. Pulls support_tickets in the requested window,
// joins tenant names, and rolls them up via aggregateMetrics().
// Mirrors the shape of /api/superadmin/ai-usage so the page can
// reuse the same KPI/breakdown patterns.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 30
const MAX_DAYS     = 365
const MAX_ROWS     = 50_000

export interface SupportMetricsResponse {
  windowDays: number
  rowsRead:   number
  truncated:  boolean
  summary:    MetricsSummary
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url     = new URL(req.url)
  const daysRaw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS)
  const days    = Number.isFinite(daysRaw) && daysRaw > 0
    ? Math.min(Math.floor(daysRaw), MAX_DAYS)
    : DEFAULT_DAYS

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const admin = supabaseAdmin()

  const { data: tickets, error } = await admin
    .from('support_tickets')
    .select('id, reason, tenant_id, emailed_ok, resolved_at, archived_at, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = tickets ?? []

  // Resolve tenant names — same pattern as the AI-usage route, an
  // explicit lookup avoids fragile PostgREST FK relationship
  // inference across schema changes.
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

  const enriched: MetricsTicketRow[] = rows.map(r => ({
    id:           r.id,
    reason:       (r.reason as MetricsTicketRow['reason']) ?? 'user_requested',
    tenant_id:    r.tenant_id,
    tenant_name:  r.tenant_id ? tenantNameById.get(r.tenant_id) ?? null : null,
    emailed_ok:   r.emailed_ok,
    resolved_at:  r.resolved_at,
    archived_at:  r.archived_at,
    created_at:   r.created_at,
  }))

  const summary = aggregateMetrics(enriched)

  const payload: SupportMetricsResponse = {
    windowDays: days,
    rowsRead:   enriched.length,
    truncated:  enriched.length === MAX_ROWS,
    summary,
  }
  return NextResponse.json(payload)
}
