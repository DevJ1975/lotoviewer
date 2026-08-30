import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendScorecardWeatherReport } from '@/lib/email/sendScorecardWeatherReport'
import { loadSuppressedEmails } from '@/lib/email/suppression'
import { buildUnsubscribe } from '@/lib/email/unsubscribe'
import { buildWeatherReportData, type WeatherReportData } from '@/lib/weatherReportData'

// Weekly EHS "weather report" cron — Mondays. For each tenant it compares
// this-week vs last-week on the key leading/lagging indicators, adds the
// year-to-date TRIR/DART + incident-risk score, and emails every owner/admin.
// The per-tenant numbers come from buildWeatherReportData (shared with the
// preview route). Vercel schedule: 30 14 * * 1.

export const runtime = 'nodejs'
// Per tenant: buildWeatherReportData computes a week-over-week metric set, then
// one email goes to every owner/admin. Both halves scale with tenant count.
export const maxDuration = 300

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

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)

  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    // One unsubscribe stream covers every weekly leadership email.
    const suppressed = await loadSuppressedEmails(admin, 'weekly_digest')

    const { data: tenants, error: tErr } = await admin
      .from('tenants')
      .select('id, name')
      .is('disabled_at', null)
    if (tErr) throw new Error(tErr.message)
    if (!tenants || tenants.length === 0) {
      return NextResponse.json({ ok: true, sent, skipped, failed, tenants: 0 })
    }

    type T = { id: string; name: string | null }
    type MRow = {
      user_id: string
      role: string
      profiles: { email: string | null; full_name: string | null }
              | { email: string | null; full_name: string | null }[]
              | null
    }
    for (const t of (tenants as T[])) {
      const { data: members, error: mErr } = await admin
        .from('tenant_memberships')
        .select('user_id, role, profiles:profiles!inner(email, full_name)')
        .eq('tenant_id', t.id)
        .in('role', ['owner', 'admin'])
      if (mErr) {
        Sentry.captureException(mErr, { tags: { route: 'cron/scorecard-weekly', tenant: t.id } })
        skipped++; continue
      }

      const recipients: Array<{ email: string; full_name: string | null }> = []
      for (const m of (members ?? []) as MRow[]) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.email && !suppressed.has(p.email.toLowerCase())) {
          recipients.push({ email: p.email, full_name: p.full_name ?? null })
        }
      }
      if (recipients.length === 0) { skipped++; continue }

      let data: WeatherReportData
      try {
        data = await buildWeatherReportData(admin, t.id)
      } catch (e) {
        Sentry.captureException(e, { tags: { route: 'cron/scorecard-weekly', tenant: t.id } })
        skipped++; continue
      }

      for (const r of recipients) {
        const { sent: ok } = await sendScorecardWeatherReport({
          to:             r.email,
          recipientName:  r.full_name,
          weekStart:      data.weekStart,
          rows:           data.rows,
          trir:           data.trir,
          dart:           data.dart,
          recordablesYtd: data.recordablesYtd,
          appUrl,
          tenantName:     t.name,
          tenantId:       t.id,
          risk:           data.risk,
          unsubscribeUrl: buildUnsubscribe(appUrl, r.email, 'weekly_digest')?.url ?? null,
        })
        if (ok) sent++; else failed++
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed, tenants: tenants.length })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/scorecard-weekly' } })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
