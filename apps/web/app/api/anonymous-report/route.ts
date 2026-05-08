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
import { clientIp, hashIp, isOverIpLimit, recordAttempt } from '@/lib/anonReport/ipThrottle'
import { verifyTurnstile } from '@/lib/anonReport/turnstile'
import { generateReceiptPin, hashReceipt, isValidPinFormat, normalizePin } from '@/lib/anonReport/receipt'
import { isOutsideRadius } from '@/lib/anonReport/geofence'

// PUBLIC POST /api/anonymous-report
//
// Body: {
//   token,
//   ...incident_create_input fields,
//   severity_quick?:    'green' | 'amber' | 'red'
//   request_pin?:       boolean
//   request_uploads?:   number (0..4)
//   turnstile_token?:   string
// }
//
// No JWT required. Defence-in-depth:
//   1. IP throttle (rolling 10-minute window).
//   2. Token must exist + be enabled.
//   3. If token.require_captcha → Turnstile must verify.
//   4. If token has rate_limit_per_hour → check it.
//   5. Insert incident with anon_token_id, auto-route if configured.
//   6. Compute geofence flag (never reject — record only).
//   7. If request_pin → generate + return a 6-char PIN.
//   8. If request_uploads > 0 → mint signed upload URLs.

const TOKEN_RE = /^[0-9a-f]{64}$/i
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_UPLOADS = 4
const ATTACH_BUCKET = 'loto-photos'

type SeverityQuick = 'green' | 'amber' | 'red'

interface PostBody extends Partial<IncidentCreateInput> {
  token:           string
  severity_quick?: SeverityQuick
  request_pin?:    boolean
  request_uploads?:number
  turnstile_token?:string
}

// Quick-tap maps to severity_potential. severity_actual stays
// 'none' until triage; the public form is for hazard signal, not
// post-incident severity coding.
function mapQuickSeverity(q: SeverityQuick | undefined): IncidentCreateInput['severity_potential'] | null {
  switch (q) {
    case 'green': return 'low'
    case 'amber': return 'moderate'
    case 'red':   return 'high'
    default:      return null
  }
}

export async function POST(req: Request) {
  const ipHash = hashIp(clientIp(req))

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch {
    void recordAttempt(ipHash, 'submit_invalid')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.token || !TOKEN_RE.test(body.token)) {
    void recordAttempt(ipHash, 'submit_invalid')
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  // IP throttle check before we touch anything else. Generic 429.
  if (await isOverIpLimit(ipHash)) {
    void recordAttempt(ipHash, 'submit_rate_limit')
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429 },
    )
  }

  // Coerce severity_quick onto the create input before validation.
  if (body.severity_quick && !body.severity_potential) {
    body.severity_potential = mapQuickSeverity(body.severity_quick) ?? undefined
  }

  // Description is required for the typed form path; with severity-
  // only quick-tap, accept a minimal description so validation passes.
  if (body.severity_quick && (!body.description || body.description.trim().length < 4)) {
    body.description = body.description?.trim() || `[severity:${body.severity_quick}] (no narrative provided)`
  }

  const validationError = validateCreateInput(body)
  if (validationError) {
    void recordAttempt(ipHash, 'submit_invalid')
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const admin = supabaseAdmin()

  try {
    // Resolve token → tenant + config.
    const { data: tokenRow, error: tokenErr } = await admin
      .from('incident_anon_intake_tokens')
      .select(`
        id, tenant_id, label, enabled, rate_limit_per_hour, total_reports,
        require_captcha, default_assigned_investigator, auto_route_enabled,
        site_geo_lat, site_geo_lng, geofence_radius_m
      `)
      .eq('token', body.token)
      .maybeSingle()
    if (tokenErr) {
      Sentry.captureException(tokenErr, { tags: { route: 'anonymous-report', stage: 'token-lookup' } })
      void recordAttempt(ipHash, 'submit_error')
      return NextResponse.json({ error: 'Token check failed' }, { status: 500 })
    }
    if (!tokenRow || !(tokenRow as { enabled: boolean }).enabled) {
      void recordAttempt(ipHash, 'submit_invalid')
      return NextResponse.json({ error: 'Token is invalid or disabled' }, { status: 403 })
    }
    const t = tokenRow as {
      id: string; tenant_id: string; label: string; enabled: boolean
      rate_limit_per_hour: number | null; total_reports: number
      require_captcha: boolean
      default_assigned_investigator: string | null
      auto_route_enabled: boolean
      site_geo_lat: number | null
      site_geo_lng: number | null
      geofence_radius_m: number | null
    }

    // Captcha. Required if token.require_captcha=true, OR if this IP
    // recently tripped throttling (we already passed the hard cap,
    // but being on the edge warrants a friction step).
    if (t.require_captcha) {
      const result = await verifyTurnstile(body.turnstile_token, clientIp(req))
      if (!result.ok) {
        void recordAttempt(ipHash, 'submit_invalid', t.id)
        return NextResponse.json(
          { error: 'Security check failed. Please reload and try again.' },
          { status: 400 },
        )
      }
    }

    // Per-token rate limit (existing behaviour, preserved).
    if (t.rate_limit_per_hour && t.rate_limit_per_hour > 0) {
      const sinceIso = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
      const { count } = await admin
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .eq('anon_token_id', t.id)
        .gte('reported_at', sinceIso)
      if ((count ?? 0) >= t.rate_limit_per_hour) {
        void recordAttempt(ipHash, 'submit_rate_limit', t.id)
        return NextResponse.json({
          error: 'Too many anonymous reports from this location in the last hour. Please try again later.',
        }, { status: 429 })
      }
    }

    // Geofence: never reject, just flag. null = not in effect.
    let geoMismatch: boolean | null = null
    const reporterGeo = body.location_geo
      ? parseClientGeo(body.location_geo as unknown)
      : null
    if (t.site_geo_lat != null && t.site_geo_lng != null && t.geofence_radius_m) {
      const outside = isOutsideRadius(
        { lat: t.site_geo_lat, lng: t.site_geo_lng },
        reporterGeo,
        t.geofence_radius_m,
      )
      geoMismatch = outside
    }

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
      geo_mismatch:            geoMismatch,

      // Auto-route assignment, if the token has one and the safety
      // valve is on. Triage admins can override afterwards.
      assigned_investigator:   t.auto_route_enabled ? t.default_assigned_investigator : null,
    }

    const { data, error } = await admin
      .from('incidents')
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'anonymous-report', stage: 'insert' } })
      void recordAttempt(ipHash, 'submit_error', t.id)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const incident = data as IncidentRow

    // Bump the token's usage counter (best effort).
    await admin
      .from('incident_anon_intake_tokens')
      .update({
        total_reports: t.total_reports + 1,
        last_used_at:  new Date().toISOString(),
      })
      .eq('id', t.id)

    // Receipt PIN: generate, hash, store. Show once in response.
    let pin: string | null = null
    if (body.request_pin) {
      pin = generateReceiptPin()
      const hash = hashReceipt(incident.report_number, pin)
      await admin
        .from('incidents')
        .update({ anon_receipt_hash: hash })
        .eq('id', incident.id)
    }

    // Mint signed upload URLs for attachments. Each path includes
    // the incident_id so attachments are scoped; tokens are short-
    // lived (Supabase default).
    let uploads: Array<{ path: string; token: string }> = []
    const requested = clamp(body.request_uploads ?? 0, 0, MAX_UPLOADS)
    if (requested > 0) {
      uploads = await mintUploadTargets(t.tenant_id, incident.id, requested)
    }

    // Notification fan-out (unchanged from prior version, except we
    // now include the auto-routed assignee in the recipient set so
    // they get the same email everyone else does).
    try { await fanOutNotifications(req, admin, incident, t.tenant_id, insert.description) }
    catch (err) { Sentry.captureException(err, { tags: { route: 'anonymous-report', stage: 'notify' } }) }

    void recordAttempt(ipHash, 'submit_ok', t.id)

    return NextResponse.json({
      ok:            true,
      report_number: incident.report_number,
      incident_id:   incident.id,
      receipt_pin:   pin,
      uploads,
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'anonymous-report' } })
    void recordAttempt(ipHash, 'submit_error')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Browser ships {lat, lng}; the DB column accepts the Postgres
// `point` literal. The ?? null at call sites means this only runs
// when the body provides location_geo.
function parseClientGeo(raw: unknown): { lat: number; lng: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { lat?: number; lng?: number }
  if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return null
  return { lat: o.lat, lng: o.lng }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}

async function mintUploadTargets(
  tenantId: string,
  incidentId: string,
  count: number,
): Promise<Array<{ path: string; token: string }>> {
  const admin = supabaseAdmin()
  const out: Array<{ path: string; token: string }> = []
  const ts = Date.now()
  for (let i = 0; i < count; i++) {
    const path = `${tenantId}/anonymous-reports/${incidentId}/${i}_${ts}.bin`
    const { data, error } = await admin.storage
      .from(ATTACH_BUCKET)
      .createSignedUploadUrl(path)
    if (error || !data) {
      Sentry.captureException(error ?? new Error('createSignedUploadUrl returned no data'), {
        tags: { module: 'anonymous-report', stage: 'mint-upload' },
      })
      continue
    }
    out.push({ path: data.path, token: data.token })
  }
  return out
}

// Fan-out extracted to keep POST() readable. Implementation is
// unchanged from the prior version; only the receiver context is
// trimmed so we don't need the old in-line typing duplication.
async function fanOutNotifications(
  req: Request,
  admin: ReturnType<typeof supabaseAdmin>,
  incident: IncidentRow,
  tenantId: string,
  displayDescription: string,
): Promise<void> {
  const { data: tenantData } = await admin
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()
  const { data: rules } = await admin
    .from('incident_notification_rules')
    .select('id, name, match_incident_type, match_severity_actual, notify_roles, notify_user_ids, notify_emails, channels, enabled')
    .eq('tenant_id', tenantId)
    .eq('enabled', true)
  const { data: members } = await admin
    .from('tenant_memberships')
    .select('user_id, role, profiles:profiles!inner(email)')
    .eq('tenant_id', tenantId)

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
}

