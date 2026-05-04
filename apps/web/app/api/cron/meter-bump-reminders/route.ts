import { NextResponse } from 'next/server'
import webpush from 'web-push'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { bumpStatus } from '@/lib/gasMeters'
import type { GasMeter } from '@/lib/types'

// Scheduled bump-test reminder dispatcher. Runs on a cron — Vercel Cron,
// Supabase pg_cron, or any external scheduler that can hit an HTTPS URL
// with a header. Recommended cadence is every 4 hours; the dedup table
// (loto_meter_alerts, migration 025) keeps the fan-out from
// re-firing more than once per ALERT_DEDUP_WINDOW_MS per instrument.
//
// Auth: same INTERNAL_PUSH_SECRET as /api/push/dispatch. The header is
// X-Internal-Secret. No other auth path — this endpoint only fires from
// the scheduler, never from a user.
//
// Vercel Cron config (vercel.json):
//   { "crons": [{ "path": "/api/cron/meter-bump-reminders", "schedule": "0 */4 * * *" }] }
// Vercel attaches an Authorization: Bearer <CRON_SECRET> header on
// scheduled invocations — set CRON_SECRET = INTERNAL_PUSH_SECRET (or
// adjust the auth check below). The simplest setup is to expose the
// secret as both env names.
//
// Supabase pg_cron alternative (call this URL via pg_net.http_post on
// a schedule). Either approach works; what matters is something hits
// the URL on an interval.

export const runtime = 'nodejs'

// Skip alerting an instrument again within this window. 12h means a
// reminder fires at most twice per day per meter, which is enough to
// catch a forgotten meter without becoming noise.
const ALERT_DEDUP_WINDOW_MS = 12 * 60 * 60 * 1000

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; we accept
// that path AND the X-Internal-Secret header used by the existing push
// trigger. Either secret env name works (CRON_SECRET or INTERNAL_PUSH_SECRET)
// so the operator can pick whichever convention fits their setup —
// Vercel's cron path uses CRON_SECRET by convention; non-Vercel
// schedulers tend to pre-existingly know INTERNAL_PUSH_SECRET.
function authorize(req: Request): boolean {
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (!cronSecret && !internalSecret) return false

  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) {
    const provided = auth.slice('Bearer '.length)
    if (cronSecret     && safeEqual(provided, cronSecret))     return true
    if (internalSecret && safeEqual(provided, internalSecret)) return true
  }

  const internal = req.headers.get('x-internal-secret') ?? ''
  if (internal && internalSecret && safeEqual(internal, internalSecret)) return true

  return false
}

function configureVapid(): { ok: true } | { ok: false; reason: string } {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subj = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subj) {
    return { ok: false, reason: 'VAPID keys not configured' }
  }
  webpush.setVapidDetails(subj, pub, priv)
  return { ok: true }
}

interface AlertedMeter {
  instrument_id: string
  alert_kind:    'overdue' | 'never'
  hours_since:   number | null
}

export async function GET(req: Request) { return runCron(req) }
export async function POST(req: Request) { return runCron(req) }

async function runCron(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const nowMs = Date.now()

  // Fetch all live gas meters. The register is small (≤ a few dozen
  // per site) — no pagination needed.
  const { data: meterRows, error: meterErr } = await admin
    .from('loto_gas_meters')
    .select('*')
    .eq('decommissioned', false)
  if (meterErr) {
    Sentry.captureException(meterErr, { tags: { route: '/api/cron/meter-bump-reminders' } })
    return NextResponse.json({ error: meterErr.message }, { status: 500 })
  }
  const meters = (meterRows ?? []) as GasMeter[]

  // Identify candidates for an alert.
  const candidates: AlertedMeter[] = []
  for (const m of meters) {
    const status = bumpStatus(m, nowMs)
    if (status.kind === 'overdue') {
      candidates.push({ instrument_id: m.instrument_id, alert_kind: 'overdue', hours_since: status.hoursSince })
    } else if (status.kind === 'never') {
      candidates.push({ instrument_id: m.instrument_id, alert_kind: 'never', hours_since: null })
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ scanned: meters.length, candidates: 0, alerts_sent: 0 })
  }

  // Filter out instruments that already had a recent alert. One query
  // for the recent slice across all candidates — cheaper than per-meter
  // round-trips.
  const since = new Date(nowMs - ALERT_DEDUP_WINDOW_MS).toISOString()
  const { data: recentAlerts, error: alertErr } = await admin
    .from('loto_meter_alerts')
    .select('instrument_id, sent_at')
    .gte('sent_at', since)
    .in('instrument_id', candidates.map(c => c.instrument_id))
  if (alertErr) {
    Sentry.captureException(alertErr, { tags: { route: '/api/cron/meter-bump-reminders' } })
    return NextResponse.json({ error: alertErr.message }, { status: 500 })
  }
  const alreadyAlerted = new Set<string>((recentAlerts ?? []).map((r: { instrument_id: string }) => r.instrument_id))
  const toAlert = candidates.filter(c => !alreadyAlerted.has(c.instrument_id))

  if (toAlert.length === 0) {
    return NextResponse.json({
      scanned:     meters.length,
      candidates:  candidates.length,
      alerts_sent: 0,
      message:     'All overdue meters already alerted within the dedup window.',
    })
  }

  // Configure web-push and fan out one notification per candidate. We
  // group all subscriptions and send one push per meter so the user
  // sees per-meter notifications they can tap (each with its own tag
  // so OS notification stacking works).
  const vapid = configureVapid()
  if (!vapid.ok) {
    Sentry.captureException(new Error(vapid.reason), {
      tags: { route: '/api/cron/meter-bump-reminders' },
    })
    return NextResponse.json({ error: vapid.reason }, { status: 500 })
  }

  const { data: subs, error: subErr } = await admin
    .from('loto_push_subscriptions')
    .select('endpoint, p256dh, auth')
  if (subErr) {
    Sentry.captureException(subErr, { tags: { route: '/api/cron/meter-bump-reminders' } })
    return NextResponse.json({ error: subErr.message }, { status: 500 })
  }
  const subscriptions = subs ?? []

  let alertsSent = 0
  const stale: string[] = []
  for (const c of toAlert) {
    const title = c.alert_kind === 'never'
      ? `${c.instrument_id} has no bump test on record`
      : `${c.instrument_id} bump test ${c.hours_since}h old`
    const body = c.alert_kind === 'never'
      ? `Verify the meter has been bumped before next entry.`
      : `Daily bump test required (§(d)(5)(i)). Bump before next use.`
    const payload = JSON.stringify({
      title,
      body,
      tag:  `meter-bump:${c.instrument_id}`,
      // Deep-link to the configuration page where the gas-meter
      // register lives. Could be improved to a per-meter detail view
      // if/when that exists.
      url:  '/admin/configuration',
    })

    const results = await Promise.allSettled(
      subscriptions.map(s => webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      ).catch((err: { statusCode?: number; endpoint?: string }) => {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          stale.push(s.endpoint)
        }
        throw err
      })),
    )
    const ok = results.filter(r => r.status === 'fulfilled').length

    // Record the alert even if zero subscriptions received it — the
    // intent (dedup) is "we tried"; an admin can debug zero recipients
    // via the row count vs the subscription count separately.
    await admin.from('loto_meter_alerts').insert({
      instrument_id: c.instrument_id,
      alert_kind:    c.alert_kind,
      recipients:    ok,
    })

    alertsSent += 1
  }

  if (stale.length > 0) {
    // Same dead-subscription pruning as /api/push/dispatch.
    await admin.from('loto_push_subscriptions').delete().in('endpoint', stale)
  }

  return NextResponse.json({
    scanned:     meters.length,
    candidates:  candidates.length,
    alerts_sent: alertsSent,
    pruned:      stale.length,
  })
}
