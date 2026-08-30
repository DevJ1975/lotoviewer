import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { buildSdsFacsimile } from '@soteria/core/sdsFacsimile'
import { type ParsedSdsPayload } from '@soteria/core/chemicals'

// GET /api/chemicals/products/[id]/sds/[sdsId]/facsimile
//
// Returns the assembled 16-section SdsFacsimileModel for the on-screen viewer
// and (client-side) PDF. The facsimile is a DERIVED, reformatted view of the
// parsed SDS — never the authoritative document of record. Two safeguards
// live here:
//   - 409 unless parse_review_status === 'approved': we never surface a
//     facsimile built from un-reviewed AI output. A pending/rejected parse is
//     not yet trustworthy enough to present as a clean "SDS".
//   - provenance (source URL, revision/parsed dates, model) is assembled into
//     the model so the viewer + PDF can always render the "reformatted, not
//     the original" banner.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string; sdsId: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id, sdsId } = await ctx.params
  if (!UUID_RE.test(id) || !UUID_RE.test(sdsId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: sds, error: sErr } = await admin
      .from('chemical_sds_documents')
      .select('parsed_payload, parse_review_status, parse_model, created_at, product_id, tenant_id')
      .eq('id', sdsId)
      .eq('tenant_id', gate.tenantId)
      .eq('product_id', id)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sds) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (sds.parse_review_status !== 'approved') {
      return NextResponse.json(
        { error: 'A facsimile is available only after the parsed SDS has been reviewed and approved.' },
        { status: 409 },
      )
    }
    if (!sds.parsed_payload) {
      return NextResponse.json({ error: 'This SDS has no parsed data to reformat.' }, { status: 409 })
    }

    // Provenance: the manufacturer URL lives on the product row (set by the
    // upload/discovery flows and read by the drift monitor).
    const { data: product } = await admin
      .from('chemical_products')
      .select('sds_source_url')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()

    const model = buildSdsFacsimile(sds.parsed_payload as ParsedSdsPayload, {
      sourceUrl:  product?.sds_source_url ?? null,
      parsedDate: sds.created_at ?? null,
      parseModel: sds.parse_model ?? null,
    })

    return NextResponse.json({ model })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
