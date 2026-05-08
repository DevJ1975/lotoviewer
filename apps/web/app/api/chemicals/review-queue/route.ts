import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/chemicals/review-queue
//
// All chemical_sds_documents rows for the active tenant whose
// parse_review_status = 'pending'. Joined to their products so the
// review UI can render product context without a second round-trip.

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_sds_documents')
      .select(`
        id,
        product_id,
        revision_date,
        parse_model,
        parse_confidence,
        parse_review_status,
        parsed_payload,
        created_at,
        chemical_products (
          id,
          name,
          manufacturer,
          ghs_signal_word,
          ghs_pictograms,
          archived_at
        )
      `)
      .eq('tenant_id', gate.tenantId)
      .eq('parse_review_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Drop archived products from the queue — no point reviewing
    // a parse that will never be applied. Supabase nested-select
    // typing materializes the join as an array even for many-to-one
    // FK joins; tolerate either shape at runtime.
    const rows = (data ?? []).filter(r => {
      const join = (r as { chemical_products: unknown }).chemical_products
      const product = Array.isArray(join) ? join[0] : join
      return product && !(product as { archived_at?: string | null }).archived_at
    })

    return NextResponse.json({ pending: rows, total: rows.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
