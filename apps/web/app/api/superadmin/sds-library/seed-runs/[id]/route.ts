import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/sds-library/seed-runs/[id]
//
// Run status + a live per-status histogram, plus a page of items (optionally
// filtered by ?status=proposed for the review UI).

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ITEM_STATUSES = ['proposed', 'approved', 'rejected', 'researching', 'found', 'not_found', 'error'] as const

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')?.trim() ?? ''
  const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200))

  const admin = supabaseAdmin()

  const { data: run, error: runErr } = await admin
    .from('sds_library_seed_runs')
    .select('id, status, target_count, counts, created_by, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 })
  if (!run)   return NextResponse.json({ error: 'Seed run not found' }, { status: 404 })

  // Live histogram (the run.counts snapshot is only refreshed by the research
  // engine; this is always current).
  const { data: statusRows, error: histErr } = await admin
    .from('sds_library_seed_items')
    .select('status')
    .eq('seed_run_id', id)
  if (histErr) return NextResponse.json({ error: histErr.message }, { status: 500 })
  const histogram: Record<string, number> = {}
  for (const r of (statusRows ?? []) as Array<{ status: string }>) {
    histogram[r.status] = (histogram[r.status] ?? 0) + 1
  }

  let itemsQuery = admin
    .from('sds_library_seed_items')
    .select('id, proposed_name, proposed_cas, proposed_manufacturer, rationale, status, attempts, last_error, chemical_id, created_at')
    .eq('seed_run_id', id)
    .order('created_at', { ascending: true })
    .limit(limit)
  if ((ITEM_STATUSES as readonly string[]).includes(statusFilter)) {
    itemsQuery = itemsQuery.eq('status', statusFilter)
  }
  const { data: items, error: itemsErr } = await itemsQuery
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  return NextResponse.json({ run, histogram, items: items ?? [] })
}
