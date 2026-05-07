import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/tenant-health
//
// Per-tenant operational glance. For every tenant returns counts
// (equipment, permits, workers, members), last activity timestamp,
// AI spend last 30 days, open ticket count.
//
// All reads are service-role (RLS-bypassing) so superadmin sees
// across tenant boundaries. Each query is parallelized; the route
// returns when the slowest finishes. PostgREST doesn't expose
// GROUP BY, so we fetch tenant_id-only rows and tally in JS — fine
// at typical tenant scale (low MB of data over the wire).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface TenantHealthRow {
  tenant_id:           string
  tenant_number:       string
  name:                string
  status:              string
  is_demo:             boolean
  member_count:        number
  equipment_count:     number
  active_permits:      number
  worker_count:        number
  open_tickets:        number
  ai_invocations_30d:  number
  last_activity_at:    string | null
}

export interface TenantHealthResponse {
  tenants: TenantHealthRow[]
}

function tally(rows: Array<{ tenant_id: string | null }> | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows ?? []) {
    if (!r.tenant_id) continue
    m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1)
  }
  return m
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  try {
    const [
      tenantRowsRes,
      memberRows,
      equipmentRows,
      permitRows,
      workerRows,
      ticketRows,
      aiRows,
      auditRows,
    ] = await Promise.all([
      admin.from('tenants').select('id, tenant_number, name, status, is_demo').order('tenant_number', { ascending: true }),
      admin.from('tenant_memberships').select('tenant_id'),
      admin.from('loto_equipment').select('tenant_id').eq('decommissioned', false),
      admin.from('loto_confined_space_permits').select('tenant_id').is('canceled_at', null),
      admin.from('loto_workers').select('tenant_id').eq('active', true),
      admin.from('support_tickets').select('tenant_id').is('resolved_at', null),
      admin.from('ai_invocations').select('tenant_id').gte('occurred_at', since30),
      // For last_activity, ordered + limited so the first occurrence
      // per tenant_id IS the most recent. 50k cap shields against a
      // single hot tenant dominating the result.
      admin.from('audit_log')
        .select('tenant_id, created_at')
        .not('tenant_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50_000),
    ])

    if (tenantRowsRes.error) {
      return NextResponse.json({ error: tenantRowsRes.error.message }, { status: 500 })
    }

    const tenantRows = (tenantRowsRes.data ?? []) as Array<{
      id: string; tenant_number: string; name: string; status: string; is_demo: boolean
    }>

    const memberCounts     = tally(memberRows.data    as Array<{ tenant_id: string | null }> | null)
    const equipmentCounts  = tally(equipmentRows.data as Array<{ tenant_id: string | null }> | null)
    const activePermits    = tally(permitRows.data    as Array<{ tenant_id: string | null }> | null)
    const workerCounts     = tally(workerRows.data    as Array<{ tenant_id: string | null }> | null)
    const openTickets      = tally(ticketRows.data    as Array<{ tenant_id: string | null }> | null)
    const aiInvocations30d = tally(aiRows.data        as Array<{ tenant_id: string | null }> | null)

    const lastActivity = new Map<string, string>()
    for (const r of (auditRows.data ?? []) as Array<{ tenant_id: string; created_at: string }>) {
      if (!lastActivity.has(r.tenant_id)) lastActivity.set(r.tenant_id, r.created_at)
    }

    const rows: TenantHealthRow[] = tenantRows.map(t => ({
      tenant_id:          t.id,
      tenant_number:      t.tenant_number,
      name:               t.name,
      status:             t.status,
      is_demo:            t.is_demo,
      member_count:       memberCounts.get(t.id)     ?? 0,
      equipment_count:    equipmentCounts.get(t.id)  ?? 0,
      active_permits:     activePermits.get(t.id)    ?? 0,
      worker_count:       workerCounts.get(t.id)     ?? 0,
      open_tickets:       openTickets.get(t.id)      ?? 0,
      ai_invocations_30d: aiInvocations30d.get(t.id) ?? 0,
      last_activity_at:   lastActivity.get(t.id)     ?? null,
    }))

    return NextResponse.json({ tenants: rows } as TenantHealthResponse)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Health check failed' }, { status: 500 })
  }
}
