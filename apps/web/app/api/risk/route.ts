import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { loadRisksFiltered, type RiskListFilters } from '@soteria/core/queries/risks'
import type { Band } from '@soteria/core/risk'

// GET /api/risk
// Query params (all optional):
//   status            comma-separated risk statuses
//   band              low|moderate|high|extreme
//   hazard_category   comma-separated hazard categories
//   assigned_to       uuid
//   search            ILIKE on title or risk_number
//   view              inherent|residual (default: residual)
//   sort              created_at|residual_score|inherent_score|next_review_date|risk_number
//   dir               asc|desc
//   limit             default 50, max 200
//   offset            default 0
//
// Auth: any tenant member. RLS in migration 040 already scopes the
// rows; we use the authenticated user's client (not service-role)
// so RLS runs as a defense-in-depth check on every list call.

const VALID_STATUSES = ['open','in_review','controls_in_progress','monitoring','closed','accepted_exception']
const VALID_BANDS    = ['low','moderate','high','extreme']
const VALID_CATS     = ['physical','chemical','biological','mechanical','electrical','ergonomic','psychosocial','environmental','radiological']
const VALID_VIEWS    = ['inherent','residual']
const VALID_SORTS    = ['created_at','residual_score','inherent_score','next_review_date','risk_number']
const VALID_DIRS     = ['asc','desc']

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const filters: RiskListFilters = {}

  // Multi-value params (comma-separated). Filter to known values.
  const statusParam = url.searchParams.get('status')
  if (statusParam) {
    const parsed = statusParam.split(',').map(s => s.trim()).filter(s => VALID_STATUSES.includes(s))
    if (parsed.length > 0) filters.status = parsed as RiskListFilters['status']
  }
  const catParam = url.searchParams.get('hazard_category')
  if (catParam) {
    const parsed = catParam.split(',').map(s => s.trim()).filter(s => VALID_CATS.includes(s))
    if (parsed.length > 0) filters.hazardCategory = parsed as RiskListFilters['hazardCategory']
  }

  // Single-value validated params.
  const bandParam = url.searchParams.get('band')
  if (bandParam && VALID_BANDS.includes(bandParam)) filters.band = bandParam as Band

  const viewParam = url.searchParams.get('view')
  if (viewParam && VALID_VIEWS.includes(viewParam)) filters.view = viewParam as RiskListFilters['view']

  const sortParam = url.searchParams.get('sort')
  if (sortParam && VALID_SORTS.includes(sortParam)) filters.sort = sortParam as RiskListFilters['sort']

  const dirParam = url.searchParams.get('dir')
  if (dirParam && VALID_DIRS.includes(dirParam)) filters.dir = dirParam as RiskListFilters['dir']

  const assignedTo = url.searchParams.get('assigned_to')?.trim()
  if (assignedTo) filters.assignedTo = assignedTo

  const search = url.searchParams.get('search')?.trim()
  if (search) filters.search = search

  const limitRaw  = url.searchParams.get('limit')
  const offsetRaw = url.searchParams.get('offset')
  if (limitRaw)  filters.limit  = parseInt(limitRaw, 10)
  if (offsetRaw) filters.offset = parseInt(offsetRaw, 10)

  try {
    const result = await loadRisksFiltered(gate.authedClient, filters)
    return NextResponse.json({
      risks:  result.risks,
      total:  result.total,
      limit:  filters.limit  ?? 50,
      offset: filters.offset ?? 0,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
