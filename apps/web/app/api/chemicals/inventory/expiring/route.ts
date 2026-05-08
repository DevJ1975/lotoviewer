import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/chemicals/inventory/expiring
//
// Returns the v_chemical_expiring_soon view (tenant-scoped via the
// view's underlying table RLS). Used by the dashboard tile + the
// inventory list's "Expiring soon" filter shortcut.

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('v_chemical_expiring_soon')
      .select('*')
      .eq('tenant_id', gate.tenantId)
      .order('days_remaining', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      items: data ?? [],
      total: (data ?? []).length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
