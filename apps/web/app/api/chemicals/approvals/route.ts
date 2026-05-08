import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/chemicals/approvals
//
// Pending chemical-inventory requests for the active tenant.
// `requested` status with the worker who filed it + product context
// joined in. The /chemicals/approvals admin page renders these as a
// queue; an admin then approves (→ in_stock) or rejects (→ rejected).

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_inventory_items')
      .select(`
        id, barcode, quantity, unit, container_type,
        purchase_order, notes, requested_by, requested_at, created_at,
        chemical_products ( id, name, manufacturer, ghs_signal_word, ghs_pictograms ),
        chemical_locations ( id, name, path )
      `)
      .eq('tenant_id', gate.tenantId)
      .eq('status', 'requested')
      .order('requested_at', { ascending: true, nullsFirst: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const items = data ?? []

    // Look up requester names in a single batch round-trip.
    const requesterIds = Array.from(new Set(
      items.map(r => r.requested_by).filter((u): u is string => !!u),
    ))
    let requesterNames: Record<string, string> = {}
    if (requesterIds.length > 0) {
      const { data: profiles } = await gate.authedClient
        .from('profiles')
        .select('id, full_name')
        .in('id', requesterIds)
      requesterNames = Object.fromEntries(
        (profiles ?? []).map(p => [p.id, p.full_name ?? '']),
      )
    }

    return NextResponse.json({
      items: items.map(r => ({
        ...r,
        requester_name: r.requested_by ? requesterNames[r.requested_by] ?? null : null,
      })),
      total: items.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
