import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { EM385_EDITIONS, type Em385Edition } from '@soteria/core/em385'

// GET /api/em385/requirements?edition=2024
//
// Returns the global EM-385 requirements catalog for an edition (or all
// editions when none is supplied). The catalog is a shared reference list (no
// tenant_id); RLS allows any authenticated user to read it. Used to power the
// "add requirement" picker and to show citations on the register.

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const editionRaw = url.searchParams.get('edition')?.trim()
  const edition = editionRaw && (EM385_EDITIONS as readonly string[]).includes(editionRaw)
    ? (editionRaw as Em385Edition)
    : null

  try {
    let q = gate.authedClient
      .from('em385_requirements')
      .select('id, edition, category, code, title, description, citation, record_type, default_required, retention_rule, retention_years, renewal_interval_months, links_module, sort_order, created_at')
      .order('sort_order', { ascending: true })

    if (edition) q = q.eq('edition', edition)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({ requirements: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/requirements/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
