import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/chemicals/products/[id]/sds/[sdsId]/url
// Returns a short-lived signed URL for the SDS PDF in the
// chemical-sds bucket. Bucket is private; UI fetches this URL each
// time it wants to display or download the SDS.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TTL_SECONDS = 60 * 5

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
      .select('storage_path, product_id, tenant_id')
      .eq('id', sdsId)
      .eq('tenant_id', gate.tenantId)
      .eq('product_id', id)
      .maybeSingle()
    if (sErr)  return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sds)  return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: signed, error: signErr } = await admin
      .storage
      .from('chemical-sds')
      .createSignedUrl(sds.storage_path, TTL_SECONDS)
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: signErr?.message ?? 'Failed to sign URL' }, { status: 500 })
    }
    return NextResponse.json({ url: signed.signedUrl, expires_in: TTL_SECONDS })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
