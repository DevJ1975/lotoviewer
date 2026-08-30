import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/chemicals/inventory/[id]/emergency
//
// Life-safety projection of a container for the first-aid "panic" view.
// Selects ONLY what the emergency screen renders (hazard banner, first
// aid, spill response, PPE, emergency phone) — deliberately narrower than
// the full inventory detail GET so the panic path stays lean and carries
// no admin/disposal fields a field worker doesn't need mid-incident.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_inventory_items')
      .select(`
        id, barcode, status,
        chemical_products (
          id, name, manufacturer,
          ghs_signal_word, ghs_pictograms, hazard_statements, ppe_required,
          first_aid, spill_cleanup, emergency_phone,
          nfpa_health, nfpa_flammability, nfpa_instability, nfpa_special,
          dot_un_number, dot_hazard_class, dot_packing_group
        ),
        chemical_locations ( name, path )
      `)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
