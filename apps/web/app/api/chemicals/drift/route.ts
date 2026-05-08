import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/chemicals/drift
//
// Recent SDS-drift check log for the active tenant. Powers the
// /chemicals/drift admin page; surfaces every cron + manual check
// across all products with full per-row context (which product,
// outcome, baseline vs latest revision date, link to the new SDS
// when applicable).

const VALID_OUTCOMES = ['unchanged', 'newer', 'older', 'unknown', 'fetch_failed'] as const

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const outcome = url.searchParams.get('outcome')
  const limit  = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit')  ?? '200', 10) || 200))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('chemical_sds_revision_checks')
      .select(`
        id, product_id, source_url, http_status,
        baseline_revision_date, baseline_file_hash,
        latest_revision_date, latest_file_hash,
        outcome, new_sds_id, notes, trigger, checked_at,
        chemical_products ( id, name, manufacturer, archived_at )
      `, { count: 'exact' })
      .eq('tenant_id', gate.tenantId)

    if (outcome && (VALID_OUTCOMES as readonly string[]).includes(outcome)) {
      q = q.eq('outcome', outcome)
    }

    q = q.order('checked_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data, count, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ checks: data ?? [], total: count ?? 0, limit, offset })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
