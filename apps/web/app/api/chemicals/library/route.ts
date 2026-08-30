import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { GHS_PICTOGRAMS } from '@soteria/core/chemicals'

// GET /api/chemicals/library — search the shared, cross-tenant SDS library.
//
// Returns only APPROVED entries. Any authenticated tenant member can read the
// library (RLS is read-all); the per-tenant catalog is unaffected. A member
// adopts an entry via POST /api/chemicals/library/[id]/adopt.

const PICTOGRAMS = GHS_PICTOGRAMS as readonly string[]

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const search    = url.searchParams.get('search')?.trim() ?? ''
  const pictogram = url.searchParams.get('pictogram')?.trim() ?? ''
  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit')  ?? '100', 10) || 100))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('sds_library_chemicals')
      .select(
        'id, canonical_name, manufacturer, product_code, cas_primary, cas_numbers, synonyms, ' +
        'physical_state, ghs_pictograms, ghs_signal_word, source_url, source_host, sds_revision_date',
        { count: 'exact' },
      )
      .eq('review_status', 'approved')

    if (search) {
      // Same PostgREST-safety as the products search: strip clause delimiters
      // and wildcard aliases, then escape LIKE specials for a literal match.
      const safe = search.replace(/[,()*]/g, ' ').trim()
      if (safe) {
        const escaped = safe.replace(/[\\%_]/g, m => `\\${m}`)
        q = q.or([
          `canonical_name.ilike.%${escaped}%`,
          `manufacturer.ilike.%${escaped}%`,
          `product_code.ilike.%${escaped}%`,
          `cas_primary.ilike.%${escaped}%`,
        ].join(','))
      }
    }

    if (pictogram && PICTOGRAMS.includes(pictogram)) {
      q = q.contains('ghs_pictograms', [pictogram])
    }

    q = q.order('canonical_name', { ascending: true }).range(offset, offset + limit - 1)

    const { data, count, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({ chemicals: data ?? [], total: count ?? 0, limit, offset })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
