import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isHostAllowed } from '@/lib/chemicalSdsFetch'

// GET /api/superadmin/sds-library/stats
//
// Coverage dashboard data: review-status breakdown, the source-host histogram,
// and which hosts sit OUTSIDE the SDS fetch allowlist (so an operator knows
// which manufacturers to add to CHEMICAL_SDS_HOST_ALLOWLIST).

export const runtime = 'nodejs'

const TOP_N = 20

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('sds_library_chemicals')
    .select('review_status, source_host')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{ review_status: string; source_host: string | null }>
  const statusCounts: Record<string, number> = {}
  const hostCounts: Record<string, number> = {}
  for (const r of rows) {
    statusCounts[r.review_status] = (statusCounts[r.review_status] ?? 0) + 1
    if (r.source_host) hostCounts[r.source_host] = (hostCounts[r.source_host] ?? 0) + 1
  }

  const sortedHosts = Object.entries(hostCounts)
    .map(([host, count]) => ({ host, count, allowlisted: isHostAllowed(host) }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    total:             rows.length,
    statusCounts,
    topHosts:          sortedHosts.slice(0, TOP_N),
    unallowlistedHosts: sortedHosts.filter(h => !h.allowlisted).slice(0, TOP_N),
  })
}
