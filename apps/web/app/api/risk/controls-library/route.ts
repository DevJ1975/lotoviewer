import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/risk/controls-library
// Optional ?hazard_category=physical filter to narrow to controls
// tagged with that category (the wizard's "suggested controls"
// panel uses this).
//
// Returns active controls for the active tenant, ordered by
// hierarchy level (elimination → ppe per ISO 45001 8.1.2) then by
// name. Auth: any tenant member.

const HIERARCHY_ORDER = ['elimination','substitution','engineering','administrative','ppe']

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const cat = url.searchParams.get('hazard_category')?.trim() || null

  try {
    let query = gate.authedClient
      .from('controls_library')
      .select('id, hierarchy_level, name, description, regulatory_ref, applicable_categories')
      .eq('active', true)
      .order('name', { ascending: true })

    if (cat) {
      // applicable_categories is a jsonb array; cs.contains on
      // PostgREST does the @> check.
      query = query.contains('applicable_categories', JSON.stringify([cat]))
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    // Sort by hierarchy level (most-effective first) then by name —
    // a single SQL order on hierarchy_level would put 'engineering'
    // alphabetically before 'ppe' which happens to be ISO order
    // here, but we want elimination > substitution > engineering >
    // administrative > ppe explicitly. Re-sort client-side.
    const sorted = (data ?? []).slice().sort((a, b) => {
      const aIdx = HIERARCHY_ORDER.indexOf(a.hierarchy_level)
      const bIdx = HIERARCHY_ORDER.indexOf(b.hierarchy_level)
      if (aIdx !== bIdx) return aIdx - bIdx
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ controls: sorted })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/controls-library/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
