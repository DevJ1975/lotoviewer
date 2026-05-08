import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/chemicals/inventory/scan?code=CHEM-0042-2026-0007
//
// Resolve a scanned barcode to an inventory container. Field workers
// hit this from /chemicals/scan after the camera reads a code; the
// caller redirects to /chemicals/inventory/{id} on success.

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const code = url.searchParams.get('code')?.trim() ?? ''
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })
  if (code.length > 128) {
    return NextResponse.json({ error: 'code too long' }, { status: 400 })
  }

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_inventory_items')
      .select(`
        id, status, quantity, unit, location_id, expiration_date,
        chemical_products ( id, name, manufacturer, ghs_signal_word, ghs_pictograms ),
        chemical_locations ( id, name, path )
      `)
      .eq('tenant_id', gate.tenantId)
      .eq('barcode', code)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'No container with that barcode.' }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
