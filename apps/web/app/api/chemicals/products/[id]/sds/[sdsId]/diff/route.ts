import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { ParsedSdsPayload } from '@soteria/core/chemicals'
import { diffSdsPayloads, summarizeDiff } from '@soteria/core/sdsDiff'

// GET /api/chemicals/products/[id]/sds/[sdsId]/diff
//
// Returns the regulatory-critical DELTA between this SDS revision's parsed
// payload and the most recent PREVIOUSLY-APPROVED revision on the same
// product. Reviewers use it to approve a new revision without re-reading a
// 16-section PDF.
//
// The comparison is deterministic and AI-free: both payloads are already
// stored on chemical_sds_documents.parsed_payload, so the diff is purely a
// structured comparison (see @soteria/core sdsDiff).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string; sdsId: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId

  const { id: productId, sdsId } = await ctx.params
  if (!UUID_RE.test(productId) || !UUID_RE.test(sdsId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // The target revision we're reviewing. Must belong to this tenant +
    // product and have a parsed payload to compare.
    const { data: target, error: tErr } = await admin
      .from('chemical_sds_documents')
      .select('id, parsed_payload, product_id, tenant_id, created_at')
      .eq('id', sdsId)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .maybeSingle()
    if (tErr)    return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!target) return NextResponse.json({ error: 'SDS not found' }, { status: 404 })
    if (!target.parsed_payload) {
      return NextResponse.json({ error: 'SDS has not been parsed yet.' }, { status: 409 })
    }

    // The baseline: the most recent approved revision that was uploaded
    // BEFORE the target. The `.lt('created_at', …)` is load-bearing — without
    // it the query could pick a NEWER approved revision (e.g. when an older
    // sheet is re-reviewed), inverting the "before → after" delta. Upload
    // time (created_at, always present) is the precedence axis; we then take
    // the newest published revision_date among those older uploads.
    const { data: priors, error: pErr } = await admin
      .from('chemical_sds_documents')
      .select('id, parsed_payload, revision_date, created_at')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .eq('parse_review_status', 'approved')
      .neq('id', sdsId)
      .not('parsed_payload', 'is', null)
      .lt('created_at', target.created_at)
      .order('revision_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    const previous = priors?.[0] ?? null
    const prevPayload = (previous?.parsed_payload ?? null) as ParsedSdsPayload | null
    const nextPayload = target.parsed_payload as ParsedSdsPayload

    const diff = diffSdsPayloads(prevPayload, nextPayload)

    return NextResponse.json({
      diff,
      summary:     summarizeDiff(diff),
      hasPrevious: previous !== null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
