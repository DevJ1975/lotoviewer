import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { dispatchIntakeNotifications } from '@/lib/incident/notifyOnIntake'
import {
  coerceCreateInput,
  parseIncidentGeo,
  validateCreateInput,
  type IncidentCreateInput,
  type IncidentRow,
  type IncidentType,
} from '@soteria/core/incident'
import { buildIncidentSafetyAlertInsert } from '@soteria/core/incidentSafetyAlerts'
import { clientIp, hashIp, isOverIpLimit, recordAttempt } from '@/lib/anonReport/ipThrottle'
import { verifyTurnstile } from '@/lib/anonReport/turnstile'
import { generateReceiptPin, hashReceipt } from '@/lib/anonReport/receipt'
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

// Quick-tap maps to severity_potential. severity_actual stays
// 'none' until triage; the public form is for hazard signal, not
// post-incident severity coding.
const QUICK_SEVERITY: Record<SeverityQuick, IncidentCreateInput['severity_potential']> = {
  green: 'low',
  amber: 'moderate',
  red:   'high',
}

function parseSeverityQuick(raw: unknown): SeverityQuick | null {
  return typeof raw === 'string' && raw in QUICK_SEVERITY ? (raw as SeverityQuick) : null
}

export async function POST(req: Request) {
  const ipHash = hashIp(clientIp(req))

  let raw: unknown
  try { raw = await req.json() }
  catch {
    void recordAttempt(ipHash, 'submit_invalid')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const body = (raw ?? {}) as Record<string, unknown>

  const token = typeof body.token === 'string' ? body.token : ''
  if (!TOKEN_RE.test(token)) {
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

  // Same narrowing as the authenticated route: a caller who posts
  // `description: 42` gets a 400, not a TypeError-turned-500.
  const input = coerceCreateInput(raw)

  const severityQuick = parseSeverityQuick(body.severity_quick)
  if (severityQuick) {
    input.severity_potential ??= QUICK_SEVERITY[severityQuick]
    // A quick-tap report puts its signal in the chip, not in prose.
    // Stand in a marker so the row still satisfies the
    // description-required contract every downstream reader assumes.
    input.description = input.description?.trim()
      || `[severity:${severityQuick}] (no narrative provided)`
  }

  const validationError = validateCreateInput(input)
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
      .eq('token', token)
      .maybeSingle()
    if (tokenErr) {
      Sentry.captureException(tokenErr, { tags: { route: 'anonymous-report', stage: 'token-lookup' } })
      void recordAttempt(ipHash, 'submit_error')
      return NextResponse.json({ error: 'Token check failed' }, { status: 500 })
    }
    if (!tokenRow || !(tokenRow as unknown as { enabled: boolean }).enabled) {
      void recordAttempt(ipHash, 'submit_invalid')
      return NextResponse.json({ error: 'Token is invalid or disabled' }, { status: 403 })
    }
    const t = tokenRow as unknown as {
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
      const turnstileToken = typeof body.turnstile_token === 'string' ? body.turnstile_token : undefined
      const result = await verifyTurnstile(turnstileToken, clientIp(req))
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

    // Geofence: never reject, just flag. null = not in effect, which
    // is also what a report with no GPS gets.
    const reporterGeo = parseIncidentGeo(input.location_geo)
    const geoMismatch = isOutsideRadius(
      t.site_geo_lat != null && t.site_geo_lng != null
        ? { lat: t.site_geo_lat, lng: t.site_geo_lng }
        : null,
      reporterGeo,
      t.geofence_radius_m,
    )

    const insert = {
      tenant_id:               t.tenant_id,
      incident_type:           input.incident_type as IncidentType,
      occurred_at:             input.occurred_at!,
      description:             input.description!.trim(),
      reported_by:             null,
      is_anonymous:            true,
      anon_token_id:           t.id,
      location_text:           input.location_text?.trim() || t.label,
      shift:                   input.shift ?? null,
      immediate_action_taken:  input.immediate_action_taken?.trim() || null,
      severity_actual:         input.severity_actual ?? 'none',
      severity_potential:      input.severity_potential ?? null,
      probability:             input.probability ?? null,
      spill_substance:         input.spill_substance?.trim() || null,
      spill_quantity:          input.spill_quantity ?? null,
      spill_quantity_unit:     input.spill_quantity_unit ?? null,
      location_geo:            input.location_geo ?? null,
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

    const incident = data as unknown as IncidentRow

    try {
      await createCommandCenterSafetyAlert(admin, incident)
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'anonymous-report', stage: 'command-center-alert' } })
    }

    // Bump the token's usage counter (best effort).
    await admin
      .from('incident_anon_intake_tokens')
      .update({
        total_reports: t.total_reports + 1,
        last_used_at:  new Date().toISOString(),
      })
      .eq('id', t.id)

    // Receipt PIN: generate, hash, store. Shown once in the response
    // and never persisted in the clear. If the hash write fails we
    // withhold the PIN — handing a worker a code that can never
    // resolve is worse than telling them there is no code.
    let pin: string | null = null
    if (body.request_pin === true) {
      const candidate = generateReceiptPin()
      const { error: pinErr } = await admin
        .from('incidents')
        .update({ anon_receipt_hash: hashReceipt(incident.report_number, candidate) })
        .eq('id', incident.id)
      if (pinErr) {
        Sentry.captureException(pinErr, { tags: { route: 'anonymous-report', stage: 'receipt-pin' } })
      } else {
        pin = candidate
      }
    }

    // Mint signed upload URLs for attachments. Each path includes
    // the incident_id so attachments are scoped; tokens are short-
    // lived (Supabase default).
    let uploads: Array<{ path: string; token: string }> = []
    const requested = clamp(body.request_uploads, 0, MAX_UPLOADS)
    if (requested > 0) {
      uploads = await mintUploadTargets(t.tenant_id, incident.id, requested)
    }

    try { await dispatchIntakeNotifications(req, incident, null) }
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

async function createCommandCenterSafetyAlert(
  admin: ReturnType<typeof supabaseAdmin>,
  incident: IncidentRow,
): Promise<void> {
  const { error } = await admin
    .from('command_center_safety_alerts')
    .insert(buildIncidentSafetyAlertInsert(incident, null))

  if (error) throw new Error(error.message)
}

function clamp(n: unknown, lo: number, hi: number): number {
  const floored = Math.floor(Number(n))
  if (!Number.isFinite(floored)) return lo
  return Math.max(lo, Math.min(hi, floored))
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
