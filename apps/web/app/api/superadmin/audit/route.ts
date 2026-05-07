import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/audit
//
// Cross-tenant audit log explorer. Filters: tenant, table, operation,
// actor (email-search), date range, limit. Service-role read so
// superadmin sees rows regardless of tenant_id (the per-tenant
// audit_log RLS would otherwise scope reads).
//
// Query params:
//   tenant       — uuid of the tenant_id, or 'all' / unset for all
//   table        — exact table_name match (e.g. 'loto_equipment')
//   op           — INSERT | UPDATE | DELETE
//   actorEmail   — substring match against the joined profiles.email
//   from         — ISO timestamp lower bound (inclusive)
//   to           — ISO timestamp upper bound (inclusive)
//   limit        — default 200, max 1000

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 200
const MAX_LIMIT     = 1000

export interface SuperadminAuditRow {
  id:           number
  tenant_id:    string | null
  tenant_name:  string | null
  actor_id:     string | null
  actor_email:  string | null
  table_name:   string
  operation:    'INSERT' | 'UPDATE' | 'DELETE'
  row_pk:       string | null
  old_row:      Record<string, unknown> | null
  new_row:      Record<string, unknown> | null
  created_at:   string
}

export interface SuperadminAuditResponse {
  rows:    SuperadminAuditRow[]
  total:   number  // matches the page-level filters; capped at limit
  filters: {
    tenant:     string | null
    table:      string | null
    op:         string | null
    actorEmail: string | null
    from:       string | null
    to:         string | null
    limit:      number
  }
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const tenant     = url.searchParams.get('tenant')      || null
  const table      = url.searchParams.get('table')       || null
  const op         = url.searchParams.get('op')          || null
  const actorEmail = url.searchParams.get('actorEmail')  || null
  const from       = url.searchParams.get('from')        || null
  const to         = url.searchParams.get('to')          || null
  const limitRaw   = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
    : DEFAULT_LIMIT

  const admin = supabaseAdmin()
  let q = admin
    .from('audit_log')
    .select('id, tenant_id, actor_id, actor_email, table_name, operation, row_pk, old_row, new_row, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (tenant && tenant !== 'all') q = q.eq('tenant_id', tenant)
  if (table)                       q = q.eq('table_name', table)
  if (op === 'INSERT' || op === 'UPDATE' || op === 'DELETE') q = q.eq('operation', op)
  if (actorEmail)                  q = q.ilike('actor_email', `%${actorEmail}%`)
  if (from)                        q = q.gte('created_at', from)
  if (to)                          q = q.lte('created_at', to)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<Omit<SuperadminAuditRow, 'tenant_name'>>

  // Resolve tenant names in one round-trip so the page can show
  // "Snak King" rather than a UUID. Filter the IN to just the
  // tenant_ids actually present in the result set.
  const tenantIds = Array.from(new Set(rows.map(r => r.tenant_id).filter((x): x is string => !!x)))
  const tenantNameById = new Map<string, string>()
  if (tenantIds.length > 0) {
    const { data: tenants } = await admin.from('tenants').select('id, name').in('id', tenantIds)
    for (const t of (tenants ?? []) as Array<{ id: string; name: string }>) {
      tenantNameById.set(t.id, t.name)
    }
  }

  const enriched: SuperadminAuditRow[] = rows.map(r => ({
    ...r,
    tenant_name: r.tenant_id ? tenantNameById.get(r.tenant_id) ?? null : null,
  }))

  const payload: SuperadminAuditResponse = {
    rows: enriched,
    total: enriched.length,
    filters: { tenant, table, op, actorEmail, from, to, limit },
  }
  return NextResponse.json(payload)
}
