import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { computeLoginUrl } from '@/lib/email/sendInvite'
import { sendIncidentAlertEmail } from '@/lib/email/sendIncidentAlert'
import {
  validateCreateInput,
  type IncidentCreateInput,
  type IncidentRow,
  type IncidentType,
} from '@soteria/core/incident'

// PUBLIC POST /api/anonymous-report
//
// Body: { token, ...incident_create_input fields }
//
// No JWT required. Security model:
//   1. Token is a 64-char hex stored in incident_anon_intake_tokens.
//   2. Lookup is via supabaseAdmin (RLS-bypassing).
//   3. Tenant + (optional) location come from the token row.
//   4. The created incident row carries is_anonymous=true and
//      reported_by=null (allowed by migration 067's CHECK).
//   5. Rate-limit (per token): if the token row carries a
//      rate_limit_per_hour, we count the prior hour's reports keyed
//      to this token and reject with 429 when exceeded.
//   6. We DO fan out the standard notification rules so admins get
//      paged about anonymous reports the same way they would for
//      authenticated ones.
//
// This is the only endpoint in the entire module that doesn't run
// behind requireTenantMember/Admin. Treat changes carefully.

const TOKEN_RE = /^[0-9a-f]{64}$/i
const RATE_WINDOW_MS = 60 * 60 * 1000

interface PostBody extends Partial<IncidentCreateInput> {
  token: string
}

export async function POST(req: Request) {
  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.token || !TOKEN_RE.test(body.token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const validationError = validateCreateInput(body)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const admin = supabaseAdmin()

  try {
    // Resolve token → tenant_id + label.
    const { data: tokenRow, error: tokenErr } = await admin
      .from('incident_anon_intake_tokens')
      .select('id, tenant_id, label, enabled, rate_limit_per_hour, total_reports')
      .eq('token', body.token)
      .maybeSingle()
    if (tokenErr) {
      Sentry.captureException(tokenErr, { tags: { route: 'anonymous-report', stage: 'token-lookup' } })
      return NextResponse.json({ error: 'Token check failed' }, { status: 500 })
    }
    if (!tokenRow || !(tokenRow as { enabled: boolean }).enabled) {
      // Don't leak whether the token exists. Same response for
      // unknown vs disabled.
      return NextResponse.json({ error: 'Token is invalid or disabled' }, { status: 403 })
    }
    const t = tokenRow as {
      id: string; tenant_id: string; label: string; enabled: boolean;
      rate_limit_per_hour: number | null; total_reports: number;
    }

    // Rate limit, if configured. Counts prior anonymous incidents
    // that referenced this token via the anon_token_id FK
    // (migration 068). Replaces the earlier description-prefix tag
    // approach which leaked the marker into every downstream
    // surface (300 log, 301 PDF, lessons library, AI suggest).
    if (t.rate_limit_per_hour && t.rate_limit_per_hour > 0) {
      const sinceIso = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
      const { count } = await admin
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .eq('anon_token_id', t.id)
        .gte('reported_at', sinceIso)
      if ((count ?? 0) >= t.rate_limit_per_hour) {
        return NextResponse.json({
          error: 'Too many anonymous reports from this location in the last hour. Please try again later.',
        }, { status: 429 })
      }
    }

    // Compose the insert. The token reference rides on anon_token_id;
    // the description carries only the worker's narrative — no
    // marker prefix.
    const description = (body.description ?? '').trim()

    const insert = {
      tenant_id:               t.tenant_id,
      incident_type:           body.incident_type as IncidentType,
      occurred_at:             body.occurred_at!,
      description,
      reported_by:             null,
      is_anonymous:            true,
      anon_token_id:           t.id,
      location_text:           body.location_text?.trim() || t.label,
      shift:                   body.shift ?? null,
      immediate_action_taken:  body.immediate_action_taken?.trim() || null,
      severity_actual:         body.severity_actual ?? 'none',
      severity_potential:      body.severity_potential ?? null,
      probability:             body.probability ?? null,
      spill_substance:         body.spill_substance?.trim() || null,
      spill_quantity:          body.spill_quantity ?? null,
      spill_quantity_unit:     body.spill_quantity_unit ?? null,
      location_geo:            body.location_geo ?? null,
    }

    const { data, error } = await admin
      .from('incidents')
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'anonymous-report', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const incident = data as IncidentRow

    // Bump the token's usage counter (best effort).
    await admin
      .from('incident_anon_intake_tokens')
      .update({ total_reports: t.total_reports + 1, last_used_at: new Date().toISOString() })
      .eq('id', t.id)

    // Fan out the same notification stack as a regular report.
    // Wrapped in try/catch — flaky email shouldn't block the 201.
    try {
      const { data: tenantData } = await admin
        .from('tenants')
        .select('name')
        .eq('id', t.tenant_id)
        .maybeSingle()
      const { data: rules } = await admin
        .from('incident_notification_rules')
        .select('id, name, match_incident_type, match_severity_actual, notify_roles, notify_user_ids, notify_emails, channels, enabled')
        .eq('tenant_id', t.tenant_id)
        .eq('enabled', true)
      const { data: members } = await admin
        .from('tenant_memberships')
        .select('user_id, role, profiles:profiles!inner(email)')
        .eq('tenant_id', t.tenant_id)

      // Inline single-pass dispatch so we don't double-import the
      // rules engine; matches POST /api/incidents but slimmer.
      type Rule = {
        id: string; name: string; enabled: boolean
        match_incident_type: string[] | null
        match_severity_actual: string[] | null
        notify_roles: string[] | null
        notify_user_ids: string[] | null
        notify_emails: string[] | null
        channels: string[]
      }
      type MRow = {
        user_id: string
        role: string
        profiles: { email: string | null } | { email: string | null }[] | null
      }
      const memEmails = new Map<string, { email: string; userId: string; role: string }>()
      for (const m of (members ?? []) as MRow[]) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.email) memEmails.set(p.email.toLowerCase(), { email: p.email, userId: m.user_id, role: m.role })
      }
      const recipients = new Map<string, { email: string; user_id: string | null; rule_id: string }>()
      for (const r of (rules ?? []) as Rule[]) {
        const typeMatch = !r.match_incident_type || r.match_incident_type.includes(incident.incident_type)
        const sevMatch  = !r.match_severity_actual || r.match_severity_actual.includes(incident.severity_actual)
        if (!typeMatch || !sevMatch) continue
        if (!r.channels.includes('email')) continue
        if (r.notify_roles) {
          for (const m of memEmails.values()) {
            if (!r.notify_roles.includes(m.role)) continue
            const key = m.email.toLowerCase()
            if (!recipients.has(key)) recipients.set(key, { email: m.email, user_id: m.userId, rule_id: r.id })
          }
        }
        if (r.notify_user_ids) {
          for (const uid of r.notify_user_ids) {
            const m = Array.from(memEmails.values()).find(x => x.userId === uid)
            if (m) {
              const key = m.email.toLowerCase()
              if (!recipients.has(key)) recipients.set(key, { email: m.email, user_id: m.userId, rule_id: r.id })
            }
          }
        }
        if (r.notify_emails) {
          for (const e of r.notify_emails) {
            const trimmed = e.trim()
            if (!trimmed) continue
            const key = trimmed.toLowerCase()
            if (!recipients.has(key)) recipients.set(key, { email: trimmed, user_id: null, rule_id: r.id })
          }
        }
      }

      const appUrl = computeLoginUrl(req)
      const tenantName = (tenantData as { name?: string | null } | null)?.name ?? null
      // Strip the anon marker from the description for the email.
      // Description is now stored unmodified (no token-prefix tag).
      const displayDescription = insert.description as string
      const logRows: Array<Record<string, unknown>> = []
      for (const r of recipients.values()) {
        const ok = await sendIncidentAlertEmail({
          to:             r.email,
          recipientName:  null,
          reportNumber:   incident.report_number,
          incidentType:   incident.incident_type,
          severityActual: incident.severity_actual,
          occurredAt:     incident.occurred_at,
          locationText:   incident.location_text,
          description:    displayDescription,
          appUrl,
          incidentId:     incident.id,
          tenantName,
          tenantId:       incident.tenant_id,
          ruleName:       'Anonymous report',
        })
        logRows.push({
          tenant_id:         incident.tenant_id,
          incident_id:       incident.id,
          rule_id:           r.rule_id,
          trigger_type:      'initial',
          channel:           'email',
          recipient_user_id: r.user_id,
          recipient_email:   r.email,
          status:            ok ? 'sent' : 'failed',
        })
      }
      if (logRows.length > 0) {
        await admin.from('incident_notifications').insert(logRows)
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'anonymous-report', stage: 'notify' } })
    }

    return NextResponse.json({
      ok:            true,
      report_number: incident.report_number,
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'anonymous-report' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
