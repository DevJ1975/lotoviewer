// Incident notification rules engine — pure logic.
//
// Given an incident + a tenant's configured rules, produce the list
// of (channel, recipient) pairs that should be notified. The engine
// itself does no I/O; the API route fetches the rules + memberships
// and feeds them in, then dispatches via the existing email + push
// helpers and writes incident_notifications log rows.
//
// Designed to be exhaustively testable from Vitest — see
// apps/web/__tests__/lib/incidentNotificationRules.test.ts.

import type {
  IncidentRow,
  IncidentType,
  IncidentSeverityActual,
  IncidentSeverityPotential,
} from './incident'

// ──────────────────────────────────────────────────────────────────────────
// Rule shape (mirrors public.incident_notification_rules)
// ──────────────────────────────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'push' | 'sms'

export interface IncidentNotificationRule {
  id:                       string
  tenant_id:                string
  name:                     string
  enabled:                  boolean
  match_incident_type:      IncidentType[] | null
  match_severity_actual:    IncidentSeverityActual[] | null
  match_severity_potential: IncidentSeverityPotential[] | null
  /** null = either; true = only when the incident is OSHA recordable;
   *  false = only when not recordable. Phase 1 callers pass
   *  isRecordable from previewClassificationFromSeverity since the
   *  classify route doesn't exist yet — the rule still works. */
  match_recordable:         boolean | null
  notify_roles:             Array<'owner' | 'admin' | 'member' | 'viewer'> | null
  notify_user_ids:          string[] | null
  notify_emails:            string[] | null
  channels:                 NotificationChannel[]
  escalation_minutes:       number | null
}

// Membership row used for role → user-id resolution.
export interface IncidentRuleMember {
  user_id:    string
  email:      string | null
  role:       'owner' | 'admin' | 'member' | 'viewer'
}

export interface ResolvedRecipient {
  channel:        NotificationChannel
  user_id:        string | null
  email:          string | null
  /** Why this recipient is in the list — tells the audit log which
   *  rule fired and via which path (role/user/email). */
  source:         'role' | 'user_id' | 'email'
}

// ──────────────────────────────────────────────────────────────────────────
// Match
// ──────────────────────────────────────────────────────────────────────────

interface MatchInput {
  incident_type:       IncidentType
  severity_actual:     IncidentSeverityActual
  severity_potential:  IncidentSeverityPotential | null
  is_recordable:       boolean
}

function matches(rule: IncidentNotificationRule, m: MatchInput): boolean {
  if (!rule.enabled) return false
  if (rule.match_incident_type && !rule.match_incident_type.includes(m.incident_type)) return false
  if (rule.match_severity_actual && !rule.match_severity_actual.includes(m.severity_actual)) return false
  if (rule.match_severity_potential) {
    if (!m.severity_potential) return false
    if (!rule.match_severity_potential.includes(m.severity_potential)) return false
  }
  if (rule.match_recordable !== null && rule.match_recordable !== m.is_recordable) return false
  return true
}

export function matchRules(
  incident: Pick<IncidentRow, 'incident_type' | 'severity_actual' | 'severity_potential'>,
  rules: ReadonlyArray<IncidentNotificationRule>,
  isRecordable: boolean,
): IncidentNotificationRule[] {
  const m: MatchInput = {
    incident_type:      incident.incident_type,
    severity_actual:    incident.severity_actual,
    severity_potential: incident.severity_potential,
    is_recordable:      isRecordable,
  }
  return rules.filter(r => matches(r, m))
}

// ──────────────────────────────────────────────────────────────────────────
// Recipient resolution
// ──────────────────────────────────────────────────────────────────────────
//
// Builds the unique (channel, recipient) list for one rule. We
// dedupe by (channel, user_id) when the recipient is a known user
// and by (channel, email) for raw-email recipients — a single user
// who matches both via role membership and an explicit user_id won't
// receive duplicate emails.

export function buildRecipientList(
  rule: IncidentNotificationRule,
  memberships: ReadonlyArray<IncidentRuleMember>,
): ResolvedRecipient[] {
  const out: ResolvedRecipient[] = []
  const seen = new Set<string>()    // dedupe key

  function add(r: ResolvedRecipient): void {
    const key = `${r.channel}|${r.user_id ?? ''}|${(r.email ?? '').toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(r)
  }

  // Resolve role-based recipients to (user_id, email) tuples from
  // memberships.
  if (rule.notify_roles && rule.notify_roles.length > 0) {
    const roles = new Set(rule.notify_roles)
    for (const m of memberships) {
      if (!roles.has(m.role)) continue
      for (const channel of rule.channels) {
        add({ channel, user_id: m.user_id, email: m.email, source: 'role' })
      }
    }
  }

  // User-id recipients — fan out across channels. We look up email
  // from memberships when available so the email channel works.
  if (rule.notify_user_ids && rule.notify_user_ids.length > 0) {
    for (const userId of rule.notify_user_ids) {
      const member = memberships.find(m => m.user_id === userId)
      for (const channel of rule.channels) {
        add({ channel, user_id: userId, email: member?.email ?? null, source: 'user_id' })
      }
    }
  }

  // Raw email recipients — email channel only (we don't have a push
  // subscription or phone for someone outside the tenant).
  if (rule.notify_emails && rule.notify_emails.length > 0) {
    for (const email of rule.notify_emails) {
      const trimmed = email.trim()
      if (!trimmed) continue
      add({ channel: 'email', user_id: null, email: trimmed, source: 'email' })
    }
  }

  return out
}

// Convenience: full pipeline. Matches rules against the incident,
// builds + dedupes the recipient list across all matching rules.
// Returns the recipient + the rule-id that put them on the list (the
// first rule wins for the dedupe — the audit log records which rule
// fired so the operator can see why each channel went out).
export interface DispatchPlan {
  rule_id:    string
  recipient:  ResolvedRecipient
}

export function buildDispatchPlan(
  incident: Pick<IncidentRow, 'incident_type' | 'severity_actual' | 'severity_potential'>,
  rules: ReadonlyArray<IncidentNotificationRule>,
  memberships: ReadonlyArray<IncidentRuleMember>,
  isRecordable: boolean,
): DispatchPlan[] {
  const matched = matchRules(incident, rules, isRecordable)
  const seen = new Set<string>()
  const plans: DispatchPlan[] = []
  for (const rule of matched) {
    const recipients = buildRecipientList(rule, memberships)
    for (const r of recipients) {
      const key = `${r.channel}|${r.user_id ?? ''}|${(r.email ?? '').toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      plans.push({ rule_id: rule.id, recipient: r })
    }
  }
  return plans
}
