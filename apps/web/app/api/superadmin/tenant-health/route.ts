import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/tenant-health
//
// Per-tenant operational glance. For every tenant returns counts
// (equipment, permits, workers, members), last activity timestamp,
// AI spend last 30 days, open ticket count.
//
// All reads are service-role (RLS-bypassing) so superadmin sees across
// tenant boundaries. The get_tenant_health RPC does the per-tenant GROUP BY
// tallies and last-activity (max(created_at)) in one set-based pass.

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

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  try {
    // One set-based pass (get_tenant_health) instead of eight whole-table
    // fetches + JS tallying. Counts come back as bigint, hence Number().
    const { data, error } = await admin.rpc('get_tenant_health', { p_since: since30 })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows: TenantHealthRow[] = ((data ?? []) as Array<{
      tenant_id: string; tenant_number: string; name: string; status: string; is_demo: boolean
      member_count: number; equipment_count: number; active_permits: number
      worker_count: number; open_tickets: number; ai_invocations_30d: number
      last_activity_at: string | null
    }>).map(r => ({
      tenant_id:          r.tenant_id,
      tenant_number:      r.tenant_number,
      name:               r.name,
      status:             r.status,
      is_demo:            r.is_demo,
      member_count:       Number(r.member_count),
      equipment_count:    Number(r.equipment_count),
      active_permits:     Number(r.active_permits),
      worker_count:       Number(r.worker_count),
      open_tickets:       Number(r.open_tickets),
      ai_invocations_30d: Number(r.ai_invocations_30d),
      last_activity_at:   r.last_activity_at,
    }))

    return NextResponse.json({ tenants: rows } as TenantHealthResponse)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Health check failed' }, { status: 500 })
  }
}
