import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { persistFetchedSds, statusForPersistOutcome } from '@/lib/chemicalSdsPersist'

// POST /api/chemicals/products/[id]/sds/fetch   { "url": "https://..." }
//
// Downloads a human-confirmed SDS candidate URL (from /discover) and persists
// it as a chemical_sds_documents row with source='ai_fetch'. The download +
// dedupe + upload + insert is shared with the "adopt from library" flow via
// persistFetchedSds() in lib/chemicalSdsPersist.ts; this route owns auth, the
// product-existence check, and the HTTP mapping.
//
// We DON'T flip active_sds_id. The fetched PDF is unparsed and unreviewed;
// it becomes active only after the user runs Parse and approves it. The
// persistence step does record sds_source_url so the drift monitor can watch
// it going forward.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { tenantId, userId } = gate

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })

  let body: { url?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected JSON body' }, { status: 400 }) }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  let parsedUrl: URL
  try { parsedUrl = new URL(url) }
  catch { return NextResponse.json({ error: 'A valid url is required' }, { status: 400 }) }
  if (parsedUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'SDS URL must be https' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: product, error: pErr } = await admin
      .from('chemical_products')
      .select('id')
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (pErr)     return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const persisted = await persistFetchedSds({ tenantId, productId, url, userId })
    if (!persisted.ok) {
      const message = persisted.outcome === 'not_pdf'
        ? 'Fetched content is not a valid PDF'
        : `Could not fetch the SDS (${persisted.outcome})${persisted.detail ? `: ${persisted.detail}` : ''}`
      return NextResponse.json(
        { error: message, outcome: persisted.outcome },
        { status: statusForPersistOutcome(persisted.outcome) },
      )
    }

    return NextResponse.json(
      persisted.deduped ? { sds: persisted.sds, deduped: true } : { sds: persisted.sds },
      { status: persisted.deduped ? 200 : 201 },
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
