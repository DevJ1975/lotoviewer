import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { computeLoginUrl } from '@/lib/email/sendInvite'
import { sendIncidentAlertEmail } from '@/lib/email/sendIncidentAlert'
import {
  INCIDENT_TYPES,
  INCIDENT_STATUSES,
  INCIDENT_SEVERITY_ACTUAL,
  ACTIVE_INCIDENT_STATUSES,
  validateCreateInput,
  type IncidentCreateInput,
  type IncidentRow,
  type IncidentStatus,
  type IncidentType,
  type IncidentSeverityActual,
} from '@soteria/core/incident'
import { previewClassificationFromSeverity } from '@soteria/core/incidentClassification'
import {
  buildDispatchPlan,
  type IncidentNotificationRule,
  type IncidentRuleMember,
} from '@soteria/core/incidentNotificationRules'

// GET  /api/incidents   List with filters + pagination (any tenant member).
// POST /api/incidents   File a new incident (any tenant member — reporting
//                       is intentionally low-friction).
//
// Auth model: any member can read + write the intake row. Status/
// classification/RCA/CAPA writes (added in later phases) gate to admin.
// RLS in migration 059 enforces tenant scope independently.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_SORTS = ['reported_at', 'occurred_at', 'severity_actual', 'report_number'] as const
const VALID_DIRS  = ['asc', 'desc'] as const

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
    let q = gate.authedClient
      .from('incidents')
      .select(SELECT_COLS, { count: 'exact' })
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
    Sentry.captureException(e, { tags: { route: 'incidents/GET' } })
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

  // Validate via the shared core validator. We pass through the
  // wire-shape unchanged so type narrowing happens in one place.
  const input: Partial<IncidentCreateInput> = {
    incident_type:           typeof body.incident_type === 'string' ? body.incident_type as IncidentType : undefined,
    occurred_at:             typeof body.occurred_at   === 'string' ? body.occurred_at : undefined,
    description:             typeof body.description   === 'string' ? body.description : undefined,
    location_text:           typeof body.location_text === 'string' ? body.location_text : null,
    shift:                   typeof body.shift         === 'string' ? body.shift as IncidentCreateInput['shift'] : null,
    immediate_action_taken:  typeof body.immediate_action_taken === 'string' ? body.immediate_action_taken : null,
    severity_actual:         typeof body.severity_actual === 'string' ? body.severity_actual as IncidentSeverityActual : undefined,
    severity_potential:      typeof body.severity_potential === 'string' ? body.severity_potential as IncidentCreateInput['severity_potential'] : null,
    probability:             typeof body.probability   === 'string' ? body.probability as IncidentCreateInput['probability'] : null,
    spill_substance:         typeof body.spill_substance === 'string' ? body.spill_substance : null,
    spill_quantity:          typeof body.spill_quantity === 'number' ? body.spill_quantity : null,
    spill_quantity_unit:     typeof body.spill_quantity_unit === 'string' ? body.spill_quantity_unit as IncidentCreateInput['spill_quantity_unit'] : null,
    location_geo:            typeof body.location_geo === 'string' ? body.location_geo : null,
    related_loto_permit_id:           typeof body.related_loto_permit_id === 'string' ? body.related_loto_permit_id : null,
    related_hot_work_permit_id:       typeof body.related_hot_work_permit_id === 'string' ? body.related_hot_work_permit_id : null,
    related_confined_space_permit_id: typeof body.related_confined_space_permit_id === 'string' ? body.related_confined_space_permit_id : null,
    related_jha_id:                   typeof body.related_jha_id === 'string' ? body.related_jha_id : null,
  }
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

    // Best-effort notification fan-out. Failures are Sentry-logged
    // inside the helpers; we don't want a flaky email provider to
    // block the user-facing 201 response. We DO await here (rather
    // than fire-and-forget) so the per-incident notifications log is
    // populated before the client refetches it — matters more than
    // tail latency for a low-volume endpoint.
    try {
      await dispatchInitialNotifications(req, incident, gate.userId, gate.userEmail)
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

// ─── Notification fan-out ─────────────────────────────────────────────────
//
// Loads the tenant's enabled rules + memberships, builds the dispatch
// plan via the pure rules engine, and writes one
// incident_notifications row per (channel, recipient) pair. Phase 1
// implements the email channel; push is wired in Phase 2 via the
// existing /api/push/dispatch helper.

async function dispatchInitialNotifications(
  req: Request,
  incident: IncidentRow,
  triggeredBy: string,
  triggeredByEmail: string | null,
): Promise<void> {
  const admin = supabaseAdmin()

  const [{ data: rulesData }, { data: membershipsData }, { data: tenantData }] = await Promise.all([
    admin
      .from('incident_notification_rules')
      .select('id, tenant_id, name, enabled, match_incident_type, match_severity_actual, match_severity_potential, match_recordable, notify_roles, notify_user_ids, notify_emails, channels, escalation_minutes')
      .eq('tenant_id', incident.tenant_id)
      .eq('enabled', true),
    admin
      .from('tenant_memberships')
      .select('user_id, role, profiles:profiles!inner(email)')
      .eq('tenant_id', incident.tenant_id),
    admin
      .from('tenants')
      .select('name')
      .eq('id', incident.tenant_id)
      .maybeSingle(),
  ])

  const rules = (rulesData ?? []) as IncidentNotificationRule[]
  if (rules.length === 0) return

  // Membership rows arrive with a nested `profiles` object thanks to
  // the inner join. Flatten to the engine's TenantMembership shape.
  type MembershipRow = {
    user_id: string
    role: 'owner' | 'admin' | 'member' | 'viewer'
    profiles: { email: string | null } | { email: string | null }[] | null
  }
  const memberships: IncidentRuleMember[] = ((membershipsData ?? []) as MembershipRow[]).map(m => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return { user_id: m.user_id, role: m.role, email: p?.email ?? null }
  })

  // Phase 1 doesn't run the OSHA classifier; preview from severity so
  // the rules-engine match_recordable filter still works. The Phase 4
  // classify route will overwrite this signal with the real value.
  const previewClass = previewClassificationFromSeverity(incident.severity_actual)
  const isRecordable = previewClass !== null

  const plans = buildDispatchPlan(incident, rules, memberships, isRecordable)

  if (plans.length === 0) return

  const appUrl = computeLoginUrl(req)
  const tenantName = (tenantData as { name?: string | null } | null)?.name ?? null

  // Build a rule-id → name lookup for audit/email rendering.
  const ruleNameById = new Map(rules.map(r => [r.id, r.name]))

  const logRows: Array<Record<string, unknown>> = []

  for (const plan of plans) {
    const { recipient, rule_id } = plan
    if (recipient.channel === 'email' && recipient.email) {
      const ok = await sendIncidentAlertEmail({
        to:             recipient.email,
        recipientName:  null,
        reportNumber:   incident.report_number,
        incidentType:   incident.incident_type,
        severityActual: incident.severity_actual,
        occurredAt:     incident.occurred_at,
        locationText:   incident.location_text,
        description:    incident.description,
        appUrl,
        incidentId:     incident.id,
        tenantName,
        tenantId:       incident.tenant_id,
        triggeredBy,
        ruleName:       ruleNameById.get(rule_id) ?? null,
      })
      logRows.push({
        tenant_id:          incident.tenant_id,
        incident_id:        incident.id,
        rule_id,
        trigger_type:       'initial',
        channel:            'email',
        recipient_user_id:  recipient.user_id,
        recipient_email:    recipient.email,
        status:             ok ? 'sent' : 'failed',
      })
    } else if (recipient.channel === 'push') {
      // Phase 2 wires push via /api/push/dispatch. Log as 'skipped'
      // so the per-incident notifications tab shows what *would*
      // have been sent.
      logRows.push({
        tenant_id:          incident.tenant_id,
        incident_id:        incident.id,
        rule_id,
        trigger_type:       'initial',
        channel:            'push',
        recipient_user_id:  recipient.user_id,
        recipient_email:    recipient.email,
        status:             'skipped',
        error_text:         'push channel ships in Phase 2',
      })
    } else if (recipient.channel === 'sms') {
      // SMS channel reserved for a future provider integration.
      logRows.push({
        tenant_id:          incident.tenant_id,
        incident_id:        incident.id,
        rule_id,
        trigger_type:       'initial',
        channel:            'sms',
        recipient_user_id:  recipient.user_id,
        recipient_phone:    null,
        status:             'skipped',
        error_text:         'sms channel not configured',
      })
    }
  }

  // _ to silence the unused-var lint for triggeredByEmail — kept in the
  // signature so a future audit-context tag can use it.
  void triggeredByEmail

  if (logRows.length > 0) {
    const { error: logErr } = await admin
      .from('incident_notifications')
      .insert(logRows)
    if (logErr) {
      Sentry.captureException(logErr, { tags: { route: 'incidents/POST', stage: 'notify-log' } })
    }
  }
}
