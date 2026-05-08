import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import {
  checkLocationCompatibility,
  type OverrideRule,
  type ProductForCompatibility,
} from '@soteria/core/chemicals'

// GET /api/chemicals/locations/[id]/compatibility-check?product=<uuid>
//
// Compares the candidate product against every product currently
// stored in this location (active inventory only). Returns an array
// of conflicts the UI can render inline before the user commits.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

interface ProductRow {
  id:             string
  name:           string
  ghs_pictograms: string[] | null
  storage_class:  string | null
}

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: locationId } = await ctx.params
  if (!UUID_RE.test(locationId)) {
    return NextResponse.json({ error: 'Invalid location id' }, { status: 400 })
  }
  const url = new URL(req.url)
  const productId = url.searchParams.get('product')?.trim() ?? ''
  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ error: 'product query param is required' }, { status: 400 })
  }

  try {
    const [{ data: candidate, error: cErr }, { data: existing, error: eErr }, { data: overrides }] =
      await Promise.all([
        gate.authedClient
          .from('chemical_products')
          .select('id, name, ghs_pictograms, storage_class')
          .eq('id', productId)
          .eq('tenant_id', gate.tenantId)
          .maybeSingle<ProductRow>(),
        gate.authedClient
          .from('chemical_inventory_items')
          .select(`
            product_id,
            chemical_products ( id, name, ghs_pictograms, storage_class )
          `)
          .eq('tenant_id', gate.tenantId)
          .eq('location_id', locationId)
          .in('status', ['in_stock', 'in_use', 'quarantined']),
        gate.authedClient
          .from('chemical_incompatibility_overrides')
          .select('key_a, key_b, key_kind, compatible, reason')
          .eq('tenant_id', gate.tenantId),
      ])

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })
    if (!candidate) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    // De-dupe co-located products (multiple containers of the same
    // product → single row in the comparison).
    const coLocated = new Map<string, ProductForCompatibility & { id: string; name: string }>()
    for (const r of (existing ?? []) as Array<{ chemical_products: ProductRow | ProductRow[] | null }>) {
      const join = r.chemical_products
      const p = Array.isArray(join) ? join[0] : join
      if (!p) continue
      if (p.id === candidate.id) continue   // skip self
      coLocated.set(p.id, {
        id:             p.id,
        name:           p.name,
        ghs_pictograms: p.ghs_pictograms,
        storage_class:  p.storage_class,
      })
    }

    const conflicts = checkLocationCompatibility(
      candidate,
      Array.from(coLocated.values()),
      (overrides ?? []) as OverrideRule[],
    )

    return NextResponse.json({
      candidate: {
        id:   candidate.id,
        name: candidate.name,
      },
      conflicts,
      total: conflicts.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
