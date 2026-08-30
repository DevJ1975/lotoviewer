import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidCas } from '@soteria/core/chemicals'

// POST /api/chemicals/products/[id]/promote-to-library
//
// Propose a tenant's chemical for the shared library. Tenant admin proposes;
// it lands review_status='pending' for a superadmin to approve. We promote the
// product's metadata + its manufacturer SOURCE URL only — never the tenant's
// stored PDF (preserves the no-redistribution stance). Grows library coverage
// from real-world usage.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: p, error: pErr } = await admin
      .from('chemical_products')
      .select('*')
      .eq('id', productId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (pErr)  return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!p)    return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const product = p as Record<string, unknown>
    const sourceUrl = (product.sds_source_url as string | null) ?? null
    if (!sourceUrl) {
      return NextResponse.json(
        { error: 'This product has no manufacturer SDS URL to promote. Fetch or set its SDS source first.' },
        { status: 400 },
      )
    }

    const casNumbers = (product.cas_numbers as string[] | null) ?? []
    const casPrimary = casNumbers.find(isValidCas) ?? casNumbers[0] ?? null

    const insertRow = {
      canonical_name:           product.name,
      manufacturer:             product.manufacturer ?? null,
      product_code:             product.product_code ?? null,
      cas_primary:              casPrimary,
      cas_numbers:              casNumbers,
      synonyms:                 product.synonyms ?? [],
      physical_state:           product.physical_state ?? null,
      ghs_pictograms:           product.ghs_pictograms ?? [],
      ghs_signal_word:          product.ghs_signal_word ?? null,
      hazard_statements:        product.hazard_statements ?? null,
      precautionary_statements: product.precautionary_statements ?? null,
      nfpa_health:              product.nfpa_health ?? null,
      nfpa_flammability:        product.nfpa_flammability ?? null,
      nfpa_instability:         product.nfpa_instability ?? null,
      nfpa_special:             product.nfpa_special ?? null,
      ppe_required:             product.ppe_required ?? [],
      flash_point_c:            product.flash_point_c ?? null,
      boiling_point_c:          product.boiling_point_c ?? null,
      storage_class:            product.storage_class ?? null,
      incompatibilities:        product.incompatibilities ?? [],
      dot_un_number:            product.dot_un_number ?? null,
      dot_hazard_class:         product.dot_hazard_class ?? null,
      dot_packing_group:        product.dot_packing_group ?? null,
      source_url:               sourceUrl,
      source_host:              hostOf(sourceUrl),
      sds_revision_date:        product.sds_revision_date ?? null,
      review_status:            'pending',
    }

    const { data: lib, error: insErr } = await admin
      .from('sds_library_chemicals')
      .insert(insertRow)
      .select('id, review_status')
      .single()
    if (insErr) {
      // Identity collision — it's already in the library. Surface that.
      if (insErr.code === '23505') {
        return NextResponse.json({ deduped: true, message: 'This chemical is already in the shared library.' }, { status: 200 })
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ library: lib, deduped: false }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
