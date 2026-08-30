import { NextResponse } from 'next/server'
import { SORT_DIRS } from '@/lib/listParams'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { dispatchIntakeNotifications } from '@/lib/incident/notifyOnIntake'
import {
  INCIDENT_TYPES,
  INCIDENT_STATUSES,
  INCIDENT_SEVERITY_ACTUAL,
  ACTIVE_INCIDENT_STATUSES,
  coerceCreateInput,
  validateCreateInput,
  type IncidentRow,
  type IncidentStatus,
  type IncidentType,
  type IncidentSeverityActual,
} from '@soteria/core/incident'
import { buildIncidentSafetyAlertInsert } from '@soteria/core/incidentSafetyAlerts'

// GET  /api/incidents   List with filters + pagination (any tenant member).
// POST /api/incidents   File a new incident (any tenant member — reporting
//                       is intentionally low-friction).
//
// Auth model: any member can read + write the intake row. Status/
// classification/RCA/CAPA writes (added in later phases) gate to admin.
// RLS in migration 059 enforces tenant scope independently.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_SORTS = ['reported_at', 'occurred_at', 'severity_actual', 'report_number'] as const
const VALID_DIRS  = SORT_DIRS

const SELECT_COLS = [
  'id', 'tenant_id', 'report_number', 'incident_type',
  'occurred_at', 'reported_at', 'reported_by', 'is_anonymous',
  'location_text', 'location_geo', 'shift', 'description', 'immediate_action_taken',
  'severity_actual', 'severity_potential', 'probability', 'classification_matrix_cell',
  'status', 'assigned_investigator',
  'related_loto_permit_id', 'related_hot_work_permit_id',
  'related_confined_space_permit_id', 'related_jha_id',
  'workers_comp_claim_number',
  'spill_substance', 'spill_quantity', 'spill_quantity_unit',
  'legacy_near_miss_id',
  'closed_at', 'closed_by',
  'created_at', 'updated_at', 'updated_by',
].join(', ')

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)

  const typeRaw = url.searchParams.get('type')
  const types = typeRaw
    ? typeRaw.split(',').map(s => s.trim()).filter((s): s is IncidentType =>
        (INCIDENT_TYPES as readonly string[]).includes(s))
    : []

  const statusRaw = url.searchParams.get('status')
  const statuses = statusRaw
    ? statusRaw.split(',').map(s => s.trim()).filter((s): s is IncidentStatus =>
        (INCIDENT_STATUSES as readonly string[]).includes(s))
    : []

  const sevRaw = url.searchParams.get('severity_actual')
  const severities = sevRaw
    ? sevRaw.split(',').map(s => s.trim()).filter((s): s is IncidentSeverityActual =>
        (INCIDENT_SEVERITY_ACTUAL as readonly string[]).includes(s))
    : []

  const search    = url.searchParams.get('search')?.trim() ?? ''
  const assignee  = url.searchParams.get('assigned_investigator')?.trim() ?? ''
  const activeOnly = url.searchParams.get('active') === '1'

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
    // One definition of "which incidents match this request", applied to
    // both the page query and the severity tallies below. Keeping it in a
    // single place is what stops the tallies from drifting away from the
    // rows they are supposed to describe.
    const matching = (columns: string, headOnly: boolean) => {
      let q = gate.authedClient
        .from('incidents')
        .select(columns, { count: 'exact', head: headOnly })
        .eq('tenant_id', gate.tenantId)

      if (types.length      > 0) q = q.in('incident_type',   types)
      if (statuses.length   > 0) q = q.in('status',          statuses)
      if (severities.length > 0) q = q.in('severity_actual', severities)
      if (activeOnly)            q = q.in('status', ACTIVE_INCIDENT_STATUSES as unknown as string[])
      if (assignee && UUID_RE.test(assignee)) q = q.eq('assigned_investigator', assignee)
      if (search) {
        const safe = search.replace(/[,()]/g, ' ').trim()
        if (safe) q = q.or(`description.ilike.%${safe}%,report_number.ilike.%${safe}%`)
      }
      return q
    }

    const pageQuery = matching(SELECT_COLS, false)
      .order(sort, { ascending: dir === 'asc' })
      .range(offset, offset + limit - 1)

    // Severity tallies are counted across the whole matching set, not the
    // page. The triage tiles drive where a safety lead looks first, so a
    // count that silently stops at `limit` is worse than no count at all.
    // head:true makes each of these a count-only round trip, no rows.
    //
    // Always intersected with the active statuses, whatever the caller
    // asked for: these answer "what is still open and how bad is it",
    // which is why the field is named for that and not for the page.
    const severityQueries = INCIDENT_SEVERITY_ACTUAL.map(sev =>
      matching('id', true)
        .eq('severity_actual', sev)
        .in('status', ACTIVE_INCIDENT_STATUSES as unknown as string[]),
    )

    const [pageResult, ...severityResults] = await Promise.all([
      pageQuery,
      ...severityQueries,
    ])

    const { data, count, error } = pageResult
    if (error) throw new Error(error.message)

    const activeSeverityCounts = {} as Record<IncidentSeverityActual, number>
    INCIDENT_SEVERITY_ACTUAL.forEach((sev, i) => {
      const r = severityResults[i]
      if (r.error) throw new Error(r.error.message)
      activeSeverityCounts[sev] = r.count ?? 0
    })

    return NextResponse.json({
      reports:                data ?? [],
      total:                  count ?? 0,
      active_severity_counts: activeSeverityCounts,
      limit,
      offset,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Narrow the untrusted wire shape in one place, shared with the
  // anonymous QR route so both intake paths accept the same payloads.
  const input = coerceCreateInput(body)
  const validationError = validateCreateInput(input)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  // Default severity_actual: near-miss → 'none'; everything else
  // defaults to 'none' too (severity is set at triage). The DB CHECK
  // constraint enforces the enum.
  const severityActual: IncidentSeverityActual = input.severity_actual ?? 'none'

  const insert = {
    tenant_id:               gate.tenantId,
    incident_type:           input.incident_type!,
    occurred_at:             input.occurred_at!,
    description:             input.description!.trim(),
    reported_by:             gate.userId,
    is_anonymous:            false,
    location_text:           input.location_text?.trim() || null,
    shift:                   input.shift ?? null,
    immediate_action_taken:  input.immediate_action_taken?.trim() || null,
    severity_actual:         severityActual,
    severity_potential:      input.severity_potential ?? null,
    probability:             input.probability ?? null,
    spill_substance:         input.spill_substance?.trim() || null,
    spill_quantity:          input.spill_quantity ?? null,
    spill_quantity_unit:     input.spill_quantity_unit ?? null,
    location_geo:            input.location_geo ?? null,
    related_loto_permit_id:           input.related_loto_permit_id ?? null,
    related_hot_work_permit_id:       input.related_hot_work_permit_id ?? null,
    related_confined_space_permit_id: input.related_confined_space_permit_id ?? null,
    related_jha_id:                   input.related_jha_id ?? null,
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incidents')
      .insert(insert)
      .select(SELECT_COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'incidents/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const incident = data as unknown as IncidentRow

    try {
      await createCommandCenterSafetyAlert(incident, gate.userId)
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'incidents/POST', stage: 'command-center-alert' } })
    }

    // Best-effort notification fan-out. Failures are Sentry-logged
    // inside the helpers; we don't want a flaky email provider to
    // block the user-facing 201 response. We DO await here (rather
    // than fire-and-forget) so the per-incident notifications log is
    // populated before the client refetches it — matters more than
    // tail latency for a low-volume endpoint.
    try {
      await dispatchIntakeNotifications(req, incident, gate.userId)
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'incidents/POST', stage: 'notify' } })
    }

    return NextResponse.json({ report: incident }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'incidents/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function createCommandCenterSafetyAlert(
  incident: IncidentRow,
  createdBy: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('command_center_safety_alerts')
    .insert(buildIncidentSafetyAlertInsert(incident, createdBy))

  if (error) throw new Error(error.message)
}
