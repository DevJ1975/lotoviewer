import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  NEAR_MISS_HAZARD_CATEGORIES,
  NEAR_MISS_SEVERITY_BANDS,
  NEAR_MISS_STATUSES,
  validateCreateInput,
  type NearMissHazardCategory,
  type NearMissSeverity,
  type NearMissStatus,
} from '@soteria/core/nearMiss'

// GET  /api/near-miss   List with filters + pagination (any tenant member).
// POST /api/near-miss   Create a near-miss report (any tenant member —
//                       reporting is intentionally low-friction).
//
// Auth model: Anyone in the tenant can file (worker reporting is the
// whole point). Status / assignment changes require admin via the
// PATCH route in [id]/route.ts. RLS in migration 042 independently
// enforces tenant scope.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_SORTS = ['reported_at', 'occurred_at', 'severity_potential', 'report_number'] as const
const VALID_DIRS  = ['asc', 'desc'] as const

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)

  // Parse filters. Multi-value: status, severity, hazard_category.
  const statusRaw = url.searchParams.get('status')
  const statuses = statusRaw
    ? statusRaw.split(',').map(s => s.trim()).filter((s): s is NearMissStatus =>
        (NEAR_MISS_STATUSES as readonly string[]).includes(s))
    : []

  const sevRaw = url.searchParams.get('severity')
  const severities = sevRaw
    ? sevRaw.split(',').map(s => s.trim()).filter((s): s is NearMissSeverity =>
        (NEAR_MISS_SEVERITY_BANDS as readonly string[]).includes(s))
    : []

  const catRaw = url.searchParams.get('hazard_category')
  const cats = catRaw
    ? catRaw.split(',').map(s => s.trim()).filter((s): s is NearMissHazardCategory =>
        (NEAR_MISS_HAZARD_CATEGORIES as readonly string[]).includes(s))
    : []

  const search    = url.searchParams.get('search')?.trim() ?? ''
  const assignee  = url.searchParams.get('assigned_to')?.trim() ?? ''

  const sortRaw = url.searchParams.get('sort')
  const sort = (VALID_SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as typeof VALID_SORTS[number]) : 'reported_at'
  const dirRaw = url.searchParams.get('dir')
  const dir = (VALID_DIRS as readonly string[]).includes(dirRaw ?? '')
    ? (dirRaw as typeof VALID_DIRS[number]) : 'desc'

  const limitRaw  = url.searchParams.get('limit')
  const offsetRaw = url.searchParams.get('offset')
  const limit  = Math.min(200, Math.max(1, parseInt(limitRaw  ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(offsetRaw ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('near_misses')
      .select('id, tenant_id, report_number, occurred_at, reported_at, reported_by, location, description, immediate_action_taken, hazard_category, severity_potential, status, assigned_to, linked_risk_id, resolved_at, resolution_notes, created_at, updated_at, updated_by',
        { count: 'exact' })
      .eq('tenant_id', gate.tenantId)

    if (statuses.length   > 0) q = q.in('status', statuses)
    if (severities.length > 0) q = q.in('severity_potential', severities)
    if (cats.length       > 0) q = q.in('hazard_category', cats)
    if (assignee && UUID_RE.test(assignee)) q = q.eq('assigned_to', assignee)
    if (search) {
      // Match on description or report_number; ILIKE via .or() with
      // proper escaping. Supabase's PostgREST .or() requires commas
      // not in values, so we conservatively strip them from search.
      const safe = search.replace(/[,()]/g, ' ').trim()
      if (safe) q = q.or(`description.ilike.%${safe}%,report_number.ilike.%${safe}%`)
    }

    q = q.order(sort, { ascending: dir === 'asc' }).range(offset, offset + limit - 1)

    const { data, count, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({
      reports: data ?? [],
      total:   count ?? 0,
      limit,
      offset,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'near-miss/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Run shared validator. validateCreateInput already type-narrows
  // the well-known fields; we pass the body straight through.
  const validationError = validateCreateInput({
    occurred_at:            typeof body.occurred_at === 'string' ? body.occurred_at : undefined,
    description:            typeof body.description === 'string' ? body.description : undefined,
    hazard_category:        typeof body.hazard_category === 'string' ? body.hazard_category as NearMissHazardCategory : undefined,
    severity_potential:     typeof body.severity_potential === 'string' ? body.severity_potential as NearMissSeverity : undefined,
    location:               typeof body.location === 'string' ? body.location : null,
    immediate_action_taken: typeof body.immediate_action_taken === 'string' ? body.immediate_action_taken : null,
  })
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const insert = {
    tenant_id:              gate.tenantId,
    occurred_at:            body.occurred_at as string,
    description:            (body.description as string).trim(),
    hazard_category:        body.hazard_category as NearMissHazardCategory,
    severity_potential:     body.severity_potential as NearMissSeverity,
    reported_by:            gate.userId,
    location:               typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null,
    immediate_action_taken: typeof body.immediate_action_taken === 'string' && body.immediate_action_taken.trim() ? body.immediate_action_taken.trim() : null,
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('near_misses')
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'near-miss/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ report: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'near-miss/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
