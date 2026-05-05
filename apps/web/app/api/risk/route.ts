import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadRisksFiltered, type RiskListFilters } from '@soteria/core/queries/risks'
import type { Band, HierarchyLevel } from '@soteria/core/risk'

// GET  /api/risk   List with filters + pagination (any tenant member).
// POST /api/risk   Create a new risk + (optionally) attach controls
//                  in the same request (tenant admin/owner).
//
// The POST body shape is intentionally chunky:
//   {
//     risk:     { ...risk fields },
//     controls: [{ hierarchy_level, control_id?, custom_name?, status? }, ...]
//   }
//
// The server inserts the risk first (no controls yet → the
// migration-039 PPE-alone constraint trigger early-returns since
// total_controls=0), then multi-row-inserts every control in a
// single statement. The deferred constraint trigger evaluates at
// COMMIT against the full picture — pass/fail correctly even when
// the only controls supplied are PPE.
//
// Auth on POST: tenant admin or owner. RLS in migration 040
// independently enforces tenant scope.

// ─── Shared validators ─────────────────────────────────────────────────────

const VALID_STATUSES = ['open','in_review','controls_in_progress','monitoring','closed','accepted_exception']
const VALID_BANDS    = ['low','moderate','high','extreme']
const VALID_CATS     = ['physical','chemical','biological','mechanical','electrical','ergonomic','psychosocial','environmental','radiological']
const VALID_VIEWS    = ['inherent','residual']
const VALID_SORTS    = ['created_at','residual_score','inherent_score','next_review_date','risk_number']
const VALID_DIRS     = ['asc','desc']
const VALID_SOURCES         = ['inspection','jsa','incident','worker_report','audit','moc','other']
const VALID_ACTIVITY_TYPES  = ['routine','non_routine','emergency']
const VALID_EXPOSURE_FREQS  = ['continuous','daily','weekly','monthly','rare']
const VALID_HIERARCHY_LEVELS: HierarchyLevel[] = ['elimination','substitution','engineering','administrative','ppe']
const VALID_CONTROL_STATUSES = ['planned','implemented','verified','superseded']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── GET ───────────────────────────────────────────────────────────────────

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

// ─── POST ──────────────────────────────────────────────────────────────────

interface PostBody {
  risk?:     unknown
  controls?: unknown
}

interface ControlInput {
  hierarchy_level: HierarchyLevel
  control_id?:     string
  custom_name?:    string
  status?:         'planned' | 'implemented' | 'verified' | 'superseded'
  notes?:          string
}

/** Validate + normalize a single risk-fields object from the body. */
function parseRiskInput(raw: unknown): { ok: true; risk: Record<string, unknown> } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'risk object required' }
  const r = raw as Record<string, unknown>

  const title       = typeof r.title === 'string'       ? r.title.trim()       : ''
  const description = typeof r.description === 'string' ? r.description.trim() : ''
  if (title.length === 0)       return { ok: false, message: 'title required' }
  if (description.length === 0) return { ok: false, message: 'description required' }

  if (typeof r.hazard_category !== 'string' || !VALID_CATS.includes(r.hazard_category)) {
    return { ok: false, message: 'hazard_category must be one of ' + VALID_CATS.join(', ') }
  }
  if (typeof r.source !== 'string' || !VALID_SOURCES.includes(r.source)) {
    return { ok: false, message: 'source must be one of ' + VALID_SOURCES.join(', ') }
  }
  if (typeof r.activity_type !== 'string' || !VALID_ACTIVITY_TYPES.includes(r.activity_type)) {
    return { ok: false, message: 'activity_type must be one of ' + VALID_ACTIVITY_TYPES.join(', ') }
  }
  if (typeof r.exposure_frequency !== 'string' || !VALID_EXPOSURE_FREQS.includes(r.exposure_frequency)) {
    return { ok: false, message: 'exposure_frequency must be one of ' + VALID_EXPOSURE_FREQS.join(', ') }
  }

  for (const k of ['inherent_severity', 'inherent_likelihood'] as const) {
    const v = r[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
      return { ok: false, message: `${k} must be an integer 1..5` }
    }
  }

  // Residual is optional at create time (slice 3 wizard captures it
  // in step 5 before submit; if user skipped, residual is null and
  // the risk is in 'open' status until they re-score).
  for (const k of ['residual_severity', 'residual_likelihood'] as const) {
    const v = r[k]
    if (v == null) continue
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
      return { ok: false, message: `${k} must be an integer 1..5 or null` }
    }
  }

  // Optional fields with type checks.
  const optional: Record<string, unknown> = {}
  if (r.location           !== undefined) optional.location          = typeof r.location === 'string' ? r.location.trim() || null : null
  if (r.process            !== undefined) optional.process           = typeof r.process  === 'string' ? r.process.trim()  || null : null
  if (r.affected_personnel !== undefined && r.affected_personnel && typeof r.affected_personnel === 'object') optional.affected_personnel = r.affected_personnel
  if (r.next_review_date   !== undefined && r.next_review_date != null) {
    if (typeof r.next_review_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.next_review_date)) {
      return { ok: false, message: 'next_review_date must be YYYY-MM-DD' }
    }
    optional.next_review_date = r.next_review_date
  }
  for (const k of ['assigned_to', 'reviewer', 'approver'] as const) {
    const v = r[k]
    if (v === undefined) continue
    if (v === null) { optional[k] = null; continue }
    if (typeof v !== 'string' || !UUID_RE.test(v)) {
      return { ok: false, message: `${k} must be a uuid or null` }
    }
    optional[k] = v
  }
  if (r.ppe_only_justification !== undefined) {
    optional.ppe_only_justification = typeof r.ppe_only_justification === 'string'
      ? (r.ppe_only_justification.trim() || null)
      : null
  }
  if (r.source_ref_id !== undefined) {
    if (r.source_ref_id === null) optional.source_ref_id = null
    else if (typeof r.source_ref_id === 'string' && UUID_RE.test(r.source_ref_id)) optional.source_ref_id = r.source_ref_id
    else return { ok: false, message: 'source_ref_id must be a uuid or null' }
  }

  return {
    ok: true,
    risk: {
      title,
      description,
      hazard_category:    r.hazard_category,
      source:             r.source,
      activity_type:      r.activity_type,
      exposure_frequency: r.exposure_frequency,
      inherent_severity:  r.inherent_severity,
      inherent_likelihood: r.inherent_likelihood,
      residual_severity:  r.residual_severity   ?? null,
      residual_likelihood: r.residual_likelihood ?? null,
      ...optional,
    },
  }
}

/** Validate + normalize the controls array from the body. */
function parseControlsInput(raw: unknown): { ok: true; controls: ControlInput[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, controls: [] }
  if (!Array.isArray(raw)) return { ok: false, message: 'controls must be an array' }
  if (raw.length > 50) return { ok: false, message: 'too many controls (max 50)' }

  const out: ControlInput[] = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') return { ok: false, message: 'each control must be an object' }
    const obj = c as Record<string, unknown>
    if (typeof obj.hierarchy_level !== 'string' || !VALID_HIERARCHY_LEVELS.includes(obj.hierarchy_level as HierarchyLevel)) {
      return { ok: false, message: 'hierarchy_level required (' + VALID_HIERARCHY_LEVELS.join(', ') + ')' }
    }
    const control_id = typeof obj.control_id === 'string' && UUID_RE.test(obj.control_id) ? obj.control_id : undefined
    const custom_name = typeof obj.custom_name === 'string' ? obj.custom_name.trim() : undefined
    if (!control_id && !custom_name) {
      return { ok: false, message: 'each control needs either control_id (uuid) or custom_name' }
    }
    const status = typeof obj.status === 'string' && VALID_CONTROL_STATUSES.includes(obj.status)
      ? obj.status as ControlInput['status']
      : 'planned'
    const notes  = typeof obj.notes === 'string' ? obj.notes.trim() || undefined : undefined
    out.push({ hierarchy_level: obj.hierarchy_level as HierarchyLevel, control_id, custom_name, status, notes })
  }
  return { ok: true, controls: out }
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const r = parseRiskInput(body.risk)
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: 400 })

  const c = parseControlsInput(body.controls)
  if (!c.ok) return NextResponse.json({ error: c.message }, { status: 400 })

  const admin = supabaseAdmin()

  // Step 1 — insert the risk. The PPE-alone trigger fires AFTER but
  // sees zero controls and early-returns (`if v_total_controls = 0
  // then return null`).
  const insertPayload = {
    ...r.risk,
    tenant_id:  gate.tenantId,
    created_by: gate.userId,
  }

  const { data: created, error: insertErr } = await admin
    .from('risks')
    .insert(insertPayload)
    .select('id, risk_number, inherent_severity, inherent_likelihood, inherent_score, inherent_band, residual_score, residual_band, status, created_at')
    .single()
  if (insertErr || !created) {
    Sentry.captureException(insertErr, { tags: { route: 'risk/POST', stage: 'insert-risk' } })
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Step 2 — multi-row insert all controls (if any). The PPE-alone
  // trigger evaluates at COMMIT after every row in this single
  // statement lands, so it sees the full picture for the
  // all-PPE-no-justification check.
  if (c.controls.length > 0) {
    const controlRows = c.controls.map(cn => ({
      tenant_id:        gate.tenantId,
      risk_id:          created.id,
      control_id:       cn.control_id ?? null,
      custom_name:      cn.custom_name ?? null,
      hierarchy_level:  cn.hierarchy_level,
      status:           cn.status ?? 'planned',
      notes:            cn.notes ?? null,
      created_by:       gate.userId,
    }))
    const { error: controlsErr } = await admin
      .from('risk_controls')
      .insert(controlRows)
    if (controlsErr) {
      // PPE-alone trigger surfaces here. Surface the friendly code.
      if (typeof controlsErr.message === 'string' && controlsErr.message.includes('PPE-alone rule')) {
        // Roll back the risk row so the caller can fix + retry.
        await admin.from('risks').delete().eq('id', created.id)
        return NextResponse.json({
          error: 'PPE-alone rule violation: this risk has inherent_score >= 8 and only PPE-level controls. Document why higher-level controls are not feasible in ppe_only_justification, or add at least one non-PPE control.',
          code:  'ppe_only_justification_required',
        }, { status: 422 })
      }
      // Generic failure — also roll back the risk row to avoid an
      // orphaned partial record.
      await admin.from('risks').delete().eq('id', created.id)
      Sentry.captureException(controlsErr, { tags: { route: 'risk/POST', stage: 'insert-controls' } })
      return NextResponse.json({ error: controlsErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ risk: created }, { status: 201 })
}
