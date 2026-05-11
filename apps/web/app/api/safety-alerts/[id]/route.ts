import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import type { IncidentRow } from '@soteria/core/incident'
import type { CommandCenterSafetyAlertDetail } from '@soteria/core/incidentSafetyAlerts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALERT_SELECT_COLS = [
  'id', 'tenant_id', 'incident_id', 'report_number', 'title', 'summary',
  'severity_tone', 'priority', 'status', 'source', 'created_by',
  'acknowledged_by', 'acknowledged_at', 'resolved_by', 'resolved_at',
  'resolution_note', 'created_at', 'updated_at',
].join(', ')

const INCIDENT_SELECT_COLS = [
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

interface RouteContext {
  params: Promise<{ id: string }>
}

export interface SafetyAlertPersonRow {
  id:          string
  person_role: string
  full_name:   string | null
  email:       string | null
  job_title:   string | null
  is_primary:  boolean
}

export interface SafetyAlertNotificationRow {
  id:              number
  rule_id:         string | null
  trigger_type:    string
  channel:         string
  recipient_email: string | null
  status:          string
  error_text:      string | null
  sent_at:         string
}

export interface SafetyAlertDetailResponse {
  alert:         CommandCenterSafetyAlertDetail
  incident:      IncidentRow
  people:        SafetyAlertPersonRow[]
  notifications: SafetyAlertNotificationRow[]
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data: alertData, error: alertError } = await gate.authedClient
      .from('command_center_safety_alerts')
      .select(ALERT_SELECT_COLS)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (alertError) throw new Error(alertError.message)
    if (!alertData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const alert = alertData as CommandCenterSafetyAlertDetail

    const [incidentRes, peopleRes, notificationsRes] = await Promise.all([
      gate.authedClient
        .from('incidents')
        .select(INCIDENT_SELECT_COLS)
        .eq('id', alert.incident_id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle(),
      gate.authedClient
        .from('incident_people')
        .select('id, person_role, full_name, email, job_title, is_primary')
        .eq('incident_id', alert.incident_id)
        .eq('tenant_id', gate.tenantId)
        .order('is_primary', { ascending: false }),
      gate.authedClient
        .from('incident_notifications')
        .select('id, rule_id, trigger_type, channel, recipient_email, status, error_text, sent_at')
        .eq('incident_id', alert.incident_id)
        .order('sent_at', { ascending: false })
        .limit(50),
    ])

    if (incidentRes.error) throw new Error(incidentRes.error.message)
    if (peopleRes.error) throw new Error(peopleRes.error.message)
    if (notificationsRes.error) throw new Error(notificationsRes.error.message)
    if (!incidentRes.data) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    return NextResponse.json({
      alert,
      incident:      incidentRes.data as IncidentRow,
      people:        (peopleRes.data ?? []) as SafetyAlertPersonRow[],
      notifications: (notificationsRes.data ?? []) as SafetyAlertNotificationRow[],
    } satisfies SafetyAlertDetailResponse)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'safety-alerts/[id]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
