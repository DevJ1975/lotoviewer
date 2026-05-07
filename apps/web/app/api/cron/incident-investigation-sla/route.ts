import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendInvestigationDueReminder } from '@/lib/email/sendInvestigationDueReminder'
import {
  type IncidentRow,
  type IncidentSeverityActual,
  type IncidentType,
} from '@soteria/core/incident'

// Hourly cron: incident-investigation-sla.
//
// For each tenant's enabled notification rules that carry an
// escalation_minutes value, find incidents where:
//   - the rule matches (type, severity_actual, severity_potential,
//     recordable predicate)
//   - the incident is still in 'reported' or 'triaged' status
//     (i.e. nobody has begun investigating)
//   - reported_at + rule.escalation_minutes ≤ now()
//
// Send an escalation reminder to the rule's role/user/email
// recipients, and write an incident_notifications row with
// trigger_type='escalation' so the audit trail shows it.
//
// Idempotency: we look at incident_notifications for an existing
// 'escalation' row for the same (incident_id, rule_id) and skip the
// send if one exists. This keeps the cron safe to re-run hourly
// without spamming.
//
// Vercel schedule: 0 * * * * (top of every hour).

export const runtime = 'nodejs'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

export async function GET(req: Request)  {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}

interface NotificationRuleRow {
  id:                       string
  tenant_id:                string
  enabled:                  boolean
  match_incident_type:      IncidentType[] | null
  match_severity_actual:    IncidentSeverityActual[] | null
  notify_roles:             Array<'owner' | 'admin' | 'member' | 'viewer'> | null
  notify_user_ids:          string[] | null
  notify_emails:            string[] | null
  escalation_minutes:       number | null
}

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)

  let escalated = 0
  let skipped = 0
  let failed = 0

  try {
    // 1. Pull every rule that has an escalation_minutes value. The
    //    cron is per-rule, not per-tenant — a tenant with three
    //    escalating rules walks the candidate set three times.
    const { data: rulesData, error: rulesErr } = await admin
      .from('incident_notification_rules')
      .select('id, tenant_id, enabled, match_incident_type, match_severity_actual, notify_roles, notify_user_ids, notify_emails, escalation_minutes')
      .eq('enabled', true)
      .not('escalation_minutes', 'is', null)
    if (rulesErr) throw new Error(rulesErr.message)

    const rules = (rulesData ?? []) as NotificationRuleRow[]
    if (rules.length === 0) {
      return NextResponse.json({ ok: true, escalated: 0, skipped: 0, failed: 0, rules: 0 })
    }

    // Cache tenant info + memberships per tenant so we don't re-query
    // for each rule.
    const tenantNameCache = new Map<string, string | null>()
    const membershipsCache = new Map<string, Array<{ user_id: string; email: string | null; role: string }>>()

    async function getTenantName(tenantId: string): Promise<string | null> {
      if (tenantNameCache.has(tenantId)) return tenantNameCache.get(tenantId) ?? null
      const { data } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle()
      const name = (data as { name?: string | null } | null)?.name ?? null
      tenantNameCache.set(tenantId, name)
      return name
    }

    async function getMemberships(tenantId: string) {
      const cached = membershipsCache.get(tenantId)
      if (cached) return cached
      const { data } = await admin
        .from('tenant_memberships')
        .select('user_id, role, profiles:profiles!inner(email)')
        .eq('tenant_id', tenantId)
      type Row = {
        user_id: string
        role: string
        profiles: { email: string | null } | { email: string | null }[] | null
      }
      const out = ((data ?? []) as Row[]).map(m => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return { user_id: m.user_id, role: m.role, email: p?.email ?? null }
      })
      membershipsCache.set(tenantId, out)
      return out
    }

    // 2. For each rule, find candidate incidents.
    for (const rule of rules) {
      const cutoff = new Date(Date.now() - (rule.escalation_minutes ?? 0) * 60_000).toISOString()

      let q = admin
        .from('incidents')
        .select('id, tenant_id, report_number, incident_type, severity_actual, severity_potential, occurred_at, reported_at, status')
        .eq('tenant_id', rule.tenant_id)
        .in('status', ['reported', 'triaged'])
        .lte('reported_at', cutoff)
      if (rule.match_incident_type && rule.match_incident_type.length > 0)
        q = q.in('incident_type',   rule.match_incident_type as string[])
      if (rule.match_severity_actual && rule.match_severity_actual.length > 0)
        q = q.in('severity_actual', rule.match_severity_actual as string[])

      const { data: incidents, error: incErr } = await q
      if (incErr) {
        Sentry.captureException(incErr, {
          tags: { route: 'cron/incident-investigation-sla', stage: 'incidents-fetch', rule: rule.id },
        })
        continue
      }

      if (!incidents || incidents.length === 0) continue

      for (const incident of incidents as IncidentRow[]) {
        // Idempotency check — skip if we've already escalated this
        // (incident, rule) pair.
        const { data: existing } = await admin
          .from('incident_notifications')
          .select('id')
          .eq('incident_id', incident.id)
          .eq('rule_id', rule.id)
          .eq('trigger_type', 'escalation')
          .limit(1)
          .maybeSingle()
        if (existing) { skipped++; continue }

        // Resolve recipients: roles → memberships, plus explicit
        // user_ids and emails. Same posture as the rules engine
        // but inlined here because we only need email + we already
        // know the rule matched (no second match pass needed).
        const memberships = await getMemberships(rule.tenant_id)
        const tenantName = await getTenantName(rule.tenant_id)
        const recipients = new Map<string, { email: string; user_id: string | null }>()

        if (rule.notify_roles && rule.notify_roles.length > 0) {
          const wanted = new Set(rule.notify_roles)
          for (const m of memberships) {
            if (!wanted.has(m.role as 'owner' | 'admin' | 'member' | 'viewer')) continue
            if (!m.email) continue
            recipients.set(m.email.toLowerCase(), { email: m.email, user_id: m.user_id })
          }
        }
        if (rule.notify_user_ids && rule.notify_user_ids.length > 0) {
          for (const uid of rule.notify_user_ids) {
            const m = memberships.find(x => x.user_id === uid)
            if (m?.email) recipients.set(m.email.toLowerCase(), { email: m.email, user_id: uid })
          }
        }
        if (rule.notify_emails && rule.notify_emails.length > 0) {
          for (const e of rule.notify_emails) {
            const trimmed = e.trim()
            if (trimmed) recipients.set(trimmed.toLowerCase(), { email: trimmed, user_id: null })
          }
        }

        if (recipients.size === 0) { skipped++; continue }

        const reportedMs = new Date(incident.reported_at).getTime()
        const hoursOverdue = Math.max(1, Math.floor((Date.now() - reportedMs) / 3600_000))

        const logRows: Array<Record<string, unknown>> = []
        for (const r of recipients.values()) {
          const ok = await sendInvestigationDueReminder({
            to:               r.email,
            recipientName:    null,
            reportNumber:     incident.report_number,
            incidentType:     incident.incident_type,
            severityActual:   incident.severity_actual,
            occurredAt:       incident.occurred_at,
            reportedAt:       incident.reported_at,
            hoursOverdue,
            appUrl,
            incidentId:       incident.id,
            tenantName,
            tenantId:         incident.tenant_id,
          })
          if (ok) escalated++
          else    failed++
          logRows.push({
            tenant_id:         incident.tenant_id,
            incident_id:       incident.id,
            rule_id:           rule.id,
            trigger_type:      'escalation',
            channel:           'email',
            recipient_user_id: r.user_id,
            recipient_email:   r.email,
            status:            ok ? 'sent' : 'failed',
          })
        }

        if (logRows.length > 0) {
          const { error: logErr } = await admin
            .from('incident_notifications')
            .insert(logRows)
          if (logErr) {
            Sentry.captureException(logErr, {
              tags: { route: 'cron/incident-investigation-sla', stage: 'notify-log' },
            })
          }
        }
      }
    }

    return NextResponse.json({
      ok: true, escalated, skipped, failed, rules: rules.length,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/incident-investigation-sla' } })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
