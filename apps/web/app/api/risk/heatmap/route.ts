import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { loadHeatmapCells, type HeatmapView, type HeatmapFilters } from '@soteria/core/queries/risks'

// GET /api/risk/heatmap
// Query params:
//   view              inherent|residual (default: inherent)
//   status            comma-separated risk statuses
//   hazard_category   comma-separated hazard categories
//
// Returns the 5x5 cell aggregate keyed "S,L" → count. For view=residual,
// rows where residual_severity or residual_likelihood is NULL are
// excluded (no cell to land in).
//
// Auth: any tenant member.

const VALID_STATUSES = ['open','in_review','controls_in_progress','monitoring','closed','accepted_exception']
const VALID_CATS     = ['physical','chemical','biological','mechanical','electrical','ergonomic','psychosocial','environmental','radiological']

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const viewParam = url.searchParams.get('view')
  const view: HeatmapView = viewParam === 'residual' ? 'residual' : 'inherent'

  const filters: HeatmapFilters = {}

  const statusParam = url.searchParams.get('status')
  if (statusParam) {
    const parsed = statusParam.split(',').map(s => s.trim()).filter(s => VALID_STATUSES.includes(s))
    if (parsed.length > 0) filters.status = parsed as HeatmapFilters['status']
  }
  const catParam = url.searchParams.get('hazard_category')
  if (catParam) {
    const parsed = catParam.split(',').map(s => s.trim()).filter(s => VALID_CATS.includes(s))
    if (parsed.length > 0) filters.hazardCategory = parsed as HeatmapFilters['hazardCategory']
  }

  try {
    const result = await loadHeatmapCells(gate.authedClient, view, filters)
    return NextResponse.json({ cells: result.cells, total: result.total, view })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/heatmap/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
