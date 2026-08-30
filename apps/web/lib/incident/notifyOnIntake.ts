import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { computeLoginUrl } from '@/lib/email/sendInvite'
import { sendIncidentAlertEmail } from '@/lib/email/sendIncidentAlert'
import type { IncidentRow } from '@soteria/core/incident'
import { previewClassificationFromSeverity } from '@soteria/core/incidentClassification'
import {
  buildDispatchPlan,
  type IncidentNotificationRule,
  type IncidentRuleMember,
} from '@soteria/core/incidentNotificationRules'

// Initial notification fan-out for a freshly filed incident.
//
// Both intake paths — POST /api/incidents (authenticated) and POST
// /api/anonymous-report (public QR) — land here. They used to carry
// separate copies of this logic, and the copies had drifted: the
// anonymous one never loaded match_severity_potential or
// match_recordable, so a tenant rule scoped to "extreme potential
// only" fired for every anonymous report and a rule scoped to
// "recordable only" fired for none of them. Which door a worker
// walked through must not change who gets paged, so there is now one
// implementation and one rules engine.

const RULE_COLUMNS = [
  'id', 'tenant_id', 'name', 'enabled',
  'match_incident_type', 'match_severity_actual', 'match_severity_potential',
  'match_recordable',
  'notify_roles', 'notify_user_ids', 'notify_emails',
  'channels', 'escalation_minutes',
].join(', ')

interface MembershipRow {
  user_id: string
  role:    IncidentRuleMember['role']
  // The inner join yields an object, but PostgREST types it as an
  // array when it can't prove cardinality — handle both.
  profiles: { email: string | null } | { email: string | null }[] | null
}

export async function dispatchIntakeNotifications(
  req: Request,
  incident: IncidentRow,
  triggeredBy: string | null,
): Promise<void> {
  const admin = supabaseAdmin()

  const [{ data: rulesData }, { data: membershipsData }, { data: tenantData }] = await Promise.all([
    admin
      .from('incident_notification_rules')
      .select(RULE_COLUMNS)
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

  const rules = (rulesData ?? []) as unknown as IncidentNotificationRule[]
  if (rules.length === 0) return

  const memberships: IncidentRuleMember[] = ((membershipsData ?? []) as unknown as MembershipRow[]).map(m => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return { user_id: m.user_id, role: m.role, email: profile?.email ?? null }
  })

  // Phase 1 doesn't run the OSHA classifier; preview from severity so
  // the rules-engine match_recordable filter still works. The Phase 4
  // classify route overwrites this signal with the real value.
  const isRecordable = previewClassificationFromSeverity(incident.severity_actual) !== null

  const plans = buildDispatchPlan(incident, rules, memberships, isRecordable)
  if (plans.length === 0) return

  const appUrl     = computeLoginUrl(req)
  const tenantName = (tenantData as { name?: string | null } | null)?.name ?? null
  const ruleNameById = new Map(rules.map(r => [r.id, r.name]))

  // Sends go out together, not one after another. Every recipient's SMTP
  // round-trip used to sit between the reporter and their 201 — with a
  // handful of rules matching, that is seconds of a person staring at a
  // spinner after reporting an injury. Ported from the version that lived
  // in app/api/incidents/route.ts before this moved here; the move brought
  // the sequential loop back with it.
  const logRows = (await Promise.all(plans.map(async ({ rule_id, recipient }) => {
    const base = {
      tenant_id:         incident.tenant_id,
      incident_id:       incident.id,
      rule_id,
      trigger_type:      'initial',
      recipient_user_id: recipient.user_id,
    }

    if (recipient.channel === 'email' && recipient.email) {
      const sent = await sendIncidentAlertEmail({
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
      return {
        ...base,
        channel:         'email',
        recipient_email: recipient.email,
        status:          sent ? 'sent' : 'failed',
      }
    } else if (recipient.channel === 'push') {
      // Phase 2 wires push via /api/push/dispatch. Log as 'skipped'
      // so the per-incident notifications tab shows what *would*
      // have been sent.
      return {
        ...base,
        channel:         'push',
        recipient_email: recipient.email,
        status:          'skipped',
        error_text:      'push channel ships in Phase 2',
      }
    } else if (recipient.channel === 'sms') {
      return {
        ...base,
        channel:         'sms',
        recipient_phone: null,
        status:          'skipped',
        error_text:      'sms channel not configured',
      }
    }
    return null
  }))).filter(r => r !== null)

  if (logRows.length === 0) return

  const { error } = await admin.from('incident_notifications').insert(logRows)
  if (error) {
    Sentry.captureException(error, { tags: { module: 'incident/notifyOnIntake', stage: 'notify-log' } })
  }
}
