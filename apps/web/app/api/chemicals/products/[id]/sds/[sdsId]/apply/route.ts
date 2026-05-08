import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  parseToProductFields,
  type ParsedSdsPayload,
} from '@soteria/core/chemicals'

// POST   /api/chemicals/products/[id]/sds/[sdsId]/apply
//        Approve the parsed payload and merge selected fields onto the
//        product. Body: { fields: string[] | 'all' } — caller chooses
//        which proposed fields to write. Marks the SDS row as approved.
//
// DELETE /api/chemicals/products/[id]/sds/[sdsId]/apply
//        Reject the parse: clear parsed_payload, set status='rejected'.
//        Used when the AI output was so off it's not worth reviewing.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string; sdsId: string }> }

const APPLICABLE_FIELDS = new Set([
  'name', 'manufacturer', 'product_code',
  'cas_numbers', 'synonyms',
  'physical_state',
  'ghs_pictograms', 'ghs_signal_word',
  'hazard_statements', 'precautionary_statements',
  'nfpa_health', 'nfpa_flammability', 'nfpa_instability', 'nfpa_special',
  'ppe_required',
  'flash_point_c', 'boiling_point_c', 'vapor_pressure_kpa',
  'pel_twa_ppm', 'stel_ppm', 'idlh_ppm',
  'first_aid', 'firefighting', 'spill_cleanup',
  'storage_class', 'incompatibilities',
  'dot_un_number', 'dot_hazard_class', 'dot_packing_group',
  'sds_revision_date',
])

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId
  const userId   = gate.userId

  const { id: productId, sdsId } = await ctx.params
  if (!UUID_RE.test(productId) || !UUID_RE.test(sdsId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body OK — defaults to all */ }

  const fieldsArg = body.fields
  const requested: Set<string> | 'all' = fieldsArg === 'all' || fieldsArg === undefined
    ? 'all'
    : new Set(
        (Array.isArray(fieldsArg) ? fieldsArg : [])
          .filter((f): f is string => typeof f === 'string'),
      )

  try {
    const admin = supabaseAdmin()

    const { data: sds, error: sErr } = await admin
      .from('chemical_sds_documents')
      .select('id, parsed_payload, parse_review_status, product_id, tenant_id')
      .eq('id', sdsId)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sds)  return NextResponse.json({ error: 'SDS not found' }, { status: 404 })

    if (!sds.parsed_payload) {
      return NextResponse.json({ error: 'SDS has not been parsed yet.' }, { status: 409 })
    }
    if (sds.parse_review_status === 'approved') {
      return NextResponse.json({ error: 'SDS parse has already been applied.' }, { status: 409 })
    }

    const parsed = sds.parsed_payload as ParsedSdsPayload
    const proposed = parseToProductFields(parsed)

    // Build the update payload, intersecting the caller's selection
    // with the keys we actually consider safe to write.
    const update: Record<string, unknown> = { updated_by: userId }
    let appliedCount = 0
    for (const [k, v] of Object.entries(proposed)) {
      if (!APPLICABLE_FIELDS.has(k)) continue
      if (requested !== 'all' && !requested.has(k)) continue
      update[k] = v
      appliedCount += 1
    }

    if (appliedCount === 0) {
      // Caller asked for fields, but none were both applicable AND
      // present in the parse — short-circuit instead of a no-op write.
      return NextResponse.json({ error: 'No applicable fields selected.' }, { status: 400 })
    }

    const { data: product, error: pErr } = await admin
      .from('chemical_products')
      .update(update)
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .select('*')
      .maybeSingle()
    if (pErr)    return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    await admin
      .from('chemical_sds_documents')
      .update({ parse_review_status: 'approved' })
      .eq('id', sdsId)
      .eq('tenant_id', tenantId)

    return NextResponse.json({
      product,
      applied:       Object.keys(update).filter(k => k !== 'updated_by'),
      applied_count: appliedCount,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId

  const { id: productId, sdsId } = await ctx.params
  if (!UUID_RE.test(productId) || !UUID_RE.test(sdsId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_sds_documents')
      .update({
        parse_review_status: 'rejected',
        parsed_payload:      null,
        parse_confidence:    null,
      })
      .eq('id', sdsId)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'SDS not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
